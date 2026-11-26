use super::attachments::{card_attachments_dir, enrich_attachment_view, todo_attachments_root};
use super::model::{
    create_default_todo_index, is_card_deleted, is_subtask_deleted, normalize_stored_priority,
    normalize_todo_index, summarize_card_text, todo_board_id,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const TODOS_MIGRATION_META_KEY: &str = "migrated_todos";

#[derive(Debug, Default)]
pub struct TodoStoreState {
    pub lock: Mutex<()>,
    pub content_cache: Mutex<HashMap<String, String>>,
}

pub fn with_todo_store_lock<T>(
    app: &AppHandle,
    operation: impl FnOnce(&TodoStoreState) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<TodoStoreState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "failed to lock todo store".to_string())?;
    operation(&state)
}

pub fn clear_todo_content_cache(store: &TodoStoreState) {
    if let Ok(mut cache) = store.content_cache.lock() {
        cache.clear();
    }
}

fn todo_root(app: &AppHandle) -> Result<PathBuf, String> {
    crate::accounts::account_todos_root(app)
}

pub(crate) fn todo_backup_root(app: &AppHandle) -> Result<PathBuf, String> {
    todo_root(app)
}

pub fn todo_index_path_in_root(root: &Path) -> PathBuf {
    root.join("boards.json")
}

fn legacy_card_md_path(cards_dir: &Path, card_id: &str) -> Result<PathBuf, String> {
    let safe_name: String = card_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let path = cards_dir.join(format!("{safe_name}.md"));
    if !crate::is_path_inside(&path, cards_dir) {
        return Err("Unsafe todo card path".to_string());
    }
    Ok(path)
}

fn upsert_board_row_in_tx(
    tx: &rusqlite::Transaction<'_>,
    board: &Value,
    active_board_id: &str,
) -> Result<(), String> {
    let board_id = board["id"]
        .as_str()
        .ok_or_else(|| "[CRITICAL] Todo board missing id".to_string())?;
    let is_active = if board_id == active_board_id {
        1i64
    } else {
        0i64
    };
    let updated_at = board["updatedAt"].as_str().unwrap_or("");
    let payload_json =
        serde_json::to_string(board).map_err(|err| format!("序列化待办看板失败: {err}"))?;
    tx.execute(
        "INSERT INTO todo_boards (id, active, payload_json, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
           active = excluded.active,
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at",
        params![board_id, is_active, payload_json, updated_at],
    )
    .map_err(|err| format!("写入待办看板失败: {err}"))?;
    Ok(())
}

fn upsert_card_row_in_tx(
    tx: &rusqlite::Transaction<'_>,
    card: &Value,
    active_board_id: &str,
) -> Result<(), String> {
    let card_id = card["id"]
        .as_str()
        .ok_or_else(|| "[CRITICAL] Todo card missing id".to_string())?;
    let board_id = card["boardId"].as_str().unwrap_or(active_board_id);
    let column_id = card["columnId"].as_str().unwrap_or("todo");
    let position = card["position"].as_str().unwrap_or("");
    let updated_at = card["updatedAt"].as_str().unwrap_or("");
    let deleted_at = card["deletedAt"].as_str();
    let metadata_json =
        serde_json::to_string(card).map_err(|err| format!("序列化待办卡片元数据失败: {err}"))?;
    tx.execute(
        "INSERT INTO todo_cards
           (id, board_id, column_id, position, updated_at, deleted_at, metadata_json, content_md)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '')
         ON CONFLICT(id) DO UPDATE SET
           board_id = excluded.board_id,
           column_id = excluded.column_id,
           position = excluded.position,
           updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at,
           metadata_json = excluded.metadata_json",
        params![
            card_id,
            board_id,
            column_id,
            position,
            updated_at,
            deleted_at,
            metadata_json
        ],
    )
    .map_err(|err| format!("写入待办卡片元数据失败 ({card_id}): {err}"))?;
    Ok(())
}

fn sync_active_board_in_tx(tx: &rusqlite::Transaction<'_>, index: &Value) -> Result<(), String> {
    let active_board_id = index["activeBoardId"].as_str().unwrap_or("default-board");
    if let Some(board) = index["boards"].as_array().and_then(|boards| boards.first()) {
        upsert_board_row_in_tx(tx, board, active_board_id)?;
    }
    Ok(())
}

fn insert_todo_card_in_conn(
    conn: &mut Connection,
    index: &Value,
    card: &Value,
    content: &str,
) -> Result<(), String> {
    let active_board_id = index["activeBoardId"].as_str().unwrap_or("default-board");
    let card_id = card["id"]
        .as_str()
        .ok_or_else(|| "[CRITICAL] Todo card missing id".to_string())?;
    let tx = conn
        .transaction()
        .map_err(|err| format!("开启新增待办 SQLite 事务失败: {err}"))?;
    sync_active_board_in_tx(&tx, index)?;
    upsert_card_row_in_tx(&tx, card, active_board_id)?;
    tx.execute(
        "UPDATE todo_cards SET content_md = ?2 WHERE id = ?1",
        params![card_id, content],
    )
    .map_err(|err| format!("写入新增待办正文失败 ({card_id}): {err}"))?;
    tx.commit()
        .map_err(|err| format!("提交新增待办事务失败: {err}"))
}

fn update_todo_card_in_conn(
    conn: &mut Connection,
    index: &Value,
    card: &Value,
    content_update: Option<&str>,
) -> Result<(), String> {
    let active_board_id = index["activeBoardId"].as_str().unwrap_or("default-board");
    let card_id = card["id"]
        .as_str()
        .ok_or_else(|| "[CRITICAL] Todo card missing id".to_string())?;
    let tx = conn
        .transaction()
        .map_err(|err| format!("开启更新待办 SQLite 事务失败: {err}"))?;
    sync_active_board_in_tx(&tx, index)?;
    upsert_card_row_in_tx(&tx, card, active_board_id)?;
    if let Some(content) = content_update {
        tx.execute(
            "UPDATE todo_cards SET content_md = ?2 WHERE id = ?1",
            params![card_id, content],
        )
        .map_err(|err| format!("更新待办卡片正文失败 ({card_id}): {err}"))?;
    }
    tx.commit()
        .map_err(|err| format!("提交更新待办事务失败: {err}"))
}

fn delete_todo_card_in_conn(
    conn: &mut Connection,
    index: &Value,
    card_id: &str,
    tombstone_card: Option<&Value>,
) -> Result<(), String> {
    let active_board_id = index["activeBoardId"].as_str().unwrap_or("default-board");
    let tx = conn
        .transaction()
        .map_err(|err| format!("开启删除待办 SQLite 事务失败: {err}"))?;
    sync_active_board_in_tx(&tx, index)?;
    if let Some(tombstone) = tombstone_card {
        upsert_card_row_in_tx(&tx, tombstone, active_board_id)?;
        tx.execute(
            "UPDATE todo_cards SET content_md = '' WHERE id = ?1",
            params![card_id],
        )
        .map_err(|err| format!("清空已删除待办正文失败 ({card_id}): {err}"))?;
    } else {
        tx.execute(
            "DELETE FROM card_comment_reads WHERE card_id = ?1",
            params![card_id],
        )
        .map_err(|err| format!("删除待办已读游标失败 ({card_id}): {err}"))?;
        tx.execute(
            "DELETE FROM card_comments WHERE card_id = ?1",
            params![card_id],
        )
        .map_err(|err| format!("删除待办关联评论失败 ({card_id}): {err}"))?;
        tx.execute("DELETE FROM todo_cards WHERE id = ?1", params![card_id])
            .map_err(|err| format!("删除待办卡片行失败 ({card_id}): {err}"))?;
    }
    tx.commit()
        .map_err(|err| format!("提交删除待办事务失败: {err}"))
}

fn write_todo_index_and_contents_in_conn_with_meta(
    conn: &mut Connection,
    index: &Value,
    content_updates: &[(&str, &str)],
    meta_flag: Option<(&str, &str)>,
) -> Result<Value, String> {
    let normalized = normalize_todo_index(index.clone());
    let active_board_id = normalized["activeBoardId"]
        .as_str()
        .unwrap_or("default-board")
        .to_string();

    let tx = conn
        .transaction()
        .map_err(|err| format!("开启待办 SQLite 事务失败: {err}"))?;

    tx.execute("DELETE FROM todo_boards", [])
        .map_err(|err| format!("清理旧看板数据失败: {err}"))?;

    if let Some(boards) = normalized["boards"].as_array() {
        for board in boards {
            upsert_board_row_in_tx(&tx, board, &active_board_id)?;
        }
    }

    let cards = normalized["cards"].as_array().cloned().unwrap_or_default();
    let target_ids: HashSet<&str> = cards
        .iter()
        .filter_map(|card| card["id"].as_str())
        .collect();

    let existing_ids: Vec<String> = {
        let mut stmt = tx
            .prepare("SELECT id FROM todo_cards")
            .map_err(|err| format!("查询已有待办卡片 ID 失败: {err}"))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|err| format!("读取已有待办卡片 ID 失败: {err}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|err| format!("解析待办卡片 ID 失败: {err}"))?);
        }
        out
    };

    for existing_id in existing_ids {
        if !target_ids.contains(existing_id.as_str()) {
            tx.execute("DELETE FROM todo_cards WHERE id = ?1", params![existing_id])
                .map_err(|err| format!("删除过期待办卡片行失败: {err}"))?;
        }
    }

    for card in &cards {
        upsert_card_row_in_tx(&tx, card, &active_board_id)?;
    }

    if !content_updates.is_empty() {
        let mut content_stmt = tx
            .prepare("UPDATE todo_cards SET content_md = ?2 WHERE id = ?1")
            .map_err(|err| format!("预编译待办正文更新失败: {err}"))?;
        for (card_id, content) in content_updates {
            content_stmt
                .execute(params![card_id, content])
                .map_err(|err| format!("更新待办卡片正文失败 ({card_id}): {err}"))?;
        }
    }

    if let Some((key, value)) = meta_flag {
        tx.execute(
            "INSERT INTO db_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|err| format!("更新待办迁移标记失败: {err}"))?;
    }

    tx.commit()
        .map_err(|err| format!("提交待办 SQLite 事务失败: {err}"))?;

    Ok(normalized)
}

fn read_todo_index_from_conn(conn: &mut Connection) -> Result<Value, String> {
    let mut boards = Vec::new();
    let mut active_board_id: Option<String> = None;
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, active, payload_json FROM todo_boards ORDER BY active DESC, rowid ASC",
            )
            .map_err(|err| format!("查询待办看板失败: {err}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|err| format!("读取待办看板失败: {err}"))?;
        for row in rows {
            let (board_id, active, payload_json) =
                row.map_err(|err| format!("解析待办看板行失败: {err}"))?;
            let board_val: Value = serde_json::from_str(&payload_json)
                .map_err(|err| format!("[CRITICAL] 待办看板 JSON 损坏 ({board_id}): {err}"))?;
            if active != 0 && active_board_id.is_none() {
                active_board_id = Some(board_id);
            }
            boards.push(board_val);
        }
    }

    let mut cards = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, metadata_json FROM todo_cards ORDER BY position ASC, id ASC")
            .map_err(|err| format!("查询待办卡片失败: {err}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|err| format!("读取待办卡片失败: {err}"))?;
        for row in rows {
            let (card_id, metadata_json) =
                row.map_err(|err| format!("解析待办卡片行失败: {err}"))?;
            let card_val: Value = serde_json::from_str(&metadata_json)
                .map_err(|err| format!("[CRITICAL] 待办卡片 JSON 损坏 ({card_id}): {err}"))?;
            cards.push(card_val);
        }
    }

    if boards.is_empty() && cards.is_empty() {
        let default_index = create_default_todo_index();
        return write_todo_index_and_contents_in_conn_with_meta(conn, &default_index, &[], None);
    }

    let resolved_active = active_board_id
        .or_else(|| {
            boards
                .first()
                .and_then(|board| board["id"].as_str().map(str::to_string))
        })
        .unwrap_or_else(|| "default-board".to_string());

    let raw_index = json!({
        "version": 2,
        "activeBoardId": resolved_active,
        "boards": boards,
        "cards": cards,
    });
    let normalized = normalize_todo_index(raw_index.clone());
    if normalized != raw_index {
        return write_todo_index_and_contents_in_conn_with_meta(conn, &normalized, &[], None);
    }
    Ok(normalized)
}

fn read_all_card_contents_from_conn(conn: &Connection) -> Result<HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare("SELECT id, content_md FROM todo_cards")
        .map_err(|err| format!("查询待办卡片正文失败: {err}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|err| format!("读取待办卡片正文失败: {err}"))?;
    let mut out = HashMap::new();
    for row in rows {
        let (card_id, content) = row.map_err(|err| format!("解析待办卡片正文失败: {err}"))?;
        out.insert(card_id, content);
    }
    Ok(out)
}

fn migrate_todos_json_if_needed_at(conn: &mut Connection, todos_root: &Path) -> Result<(), String> {
    if crate::local_db::get_meta_flag(conn, TODOS_MIGRATION_META_KEY)?.is_some() {
        return Ok(());
    }

    let existing_boards: i64 = conn
        .query_row("SELECT COUNT(1) FROM todo_boards", [], |row| row.get(0))
        .map_err(|err| format!("检查待办看板状态失败: {err}"))?;
    let existing_cards: i64 = conn
        .query_row("SELECT COUNT(1) FROM todo_cards", [], |row| row.get(0))
        .map_err(|err| format!("检查待办卡片状态失败: {err}"))?;
    if existing_boards > 0 || existing_cards > 0 {
        crate::local_db::set_meta_flag(conn, TODOS_MIGRATION_META_KEY, "1")?;
        return Ok(());
    }

    let index_path = todo_index_path_in_root(todos_root);
    let cards_dir = todos_root.join("cards");
    if index_path.is_file() {
        let raw = fs::read_to_string(&index_path)
            .map_err(|err| format!("读取旧 boards.json 失败 {}: {err}", index_path.display()))?;
        let parsed = match serde_json::from_str::<Value>(&raw) {
            Ok(value) => value,
            Err(_) => {
                crate::persistence::backup_corrupt_file(&index_path, "todo index")?;
                create_default_todo_index()
            }
        };
        let normalized = normalize_todo_index(parsed);
        let mut owned_contents: Vec<(String, String)> = Vec::new();
        if let Some(cards) = normalized["cards"].as_array() {
            for card in cards {
                if is_card_deleted(card) {
                    continue;
                }
                let Some(card_id) = card["id"].as_str().filter(|v| !v.is_empty()) else {
                    continue;
                };
                let md_path = legacy_card_md_path(&cards_dir, card_id)?;
                let content = match fs::read_to_string(&md_path) {
                    Ok(text) => text,
                    Err(err) if err.kind() == std::io::ErrorKind::NotFound => String::new(),
                    Err(err) => {
                        return Err(format!(
                            "读取旧待办卡片正文失败 {}: {err}",
                            md_path.display()
                        ));
                    }
                };
                owned_contents.push((card_id.to_string(), content));
            }
        }
        let content_refs: Vec<(&str, &str)> = owned_contents
            .iter()
            .map(|(id, text)| (id.as_str(), text.as_str()))
            .collect();
        write_todo_index_and_contents_in_conn_with_meta(
            conn,
            &normalized,
            &content_refs,
            Some((TODOS_MIGRATION_META_KEY, "1")),
        )?;
        crate::local_db::archive_legacy_file_once(&index_path)?;
        crate::local_db::archive_legacy_dir_once(&cards_dir)?;
    } else {
        let default_index = create_default_todo_index();
        write_todo_index_and_contents_in_conn_with_meta(
            conn,
            &default_index,
            &[],
            Some((TODOS_MIGRATION_META_KEY, "1")),
        )?;
    }

    Ok(())
}

fn open_todos_db_and_migrate(app: &AppHandle) -> Result<Connection, String> {
    fs::create_dir_all(todo_attachments_root(app)?)
        .map_err(|err| format!("failed to create todo storage: {err}"))?;
    let mut conn = crate::local_db::open_workspace_db(app)?;
    migrate_todos_json_if_needed_at(&mut conn, &todo_root(app)?)?;
    Ok(conn)
}

pub fn read_todo_index_unlocked(app: &AppHandle) -> Result<Value, String> {
    let mut conn = open_todos_db_and_migrate(app)?;
    read_todo_index_from_conn(&mut conn)
}

pub(crate) fn insert_todo_card_in_db(
    app: &AppHandle,
    index: &Value,
    card: &Value,
    content: &str,
) -> Result<(), String> {
    let mut conn = open_todos_db_and_migrate(app)?;
    insert_todo_card_in_conn(&mut conn, index, card, content)
}

pub(crate) fn update_todo_card_in_db(
    app: &AppHandle,
    index: &Value,
    card: &Value,
    content_update: Option<&str>,
) -> Result<(), String> {
    let mut conn = open_todos_db_and_migrate(app)?;
    update_todo_card_in_conn(&mut conn, index, card, content_update)
}

pub(crate) fn delete_todo_card_in_db(
    app: &AppHandle,
    index: &Value,
    card_id: &str,
    tombstone_card: Option<&Value>,
) -> Result<(), String> {
    let mut conn = open_todos_db_and_migrate(app)?;
    delete_todo_card_in_conn(&mut conn, index, card_id, tombstone_card)
}

pub(crate) fn save_todo_index_with_contents_unlocked(
    app: &AppHandle,
    index: &Value,
    content_updates: &[(&str, &str)],
) -> Result<(), String> {
    let mut conn = open_todos_db_and_migrate(app)?;
    write_todo_index_and_contents_in_conn_with_meta(&mut conn, index, content_updates, None)?;
    Ok(())
}

pub(crate) fn read_todo_card_content_unlocked(
    app: &AppHandle,
    card_id: &str,
) -> Result<String, String> {
    let conn = open_todos_db_and_migrate(app)?;
    let content = conn
        .query_row(
            "SELECT content_md FROM todo_cards WHERE id = ?1",
            params![card_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|err| format!("读取待办卡片正文失败 ({card_id}): {err}"))?;
    Ok(content.unwrap_or_default())
}

pub(crate) fn clear_todos_tables_in_db(db_path: &Path) -> Result<(), String> {
    if !db_path.is_file() {
        return Ok(());
    }
    let mut conn = crate::local_db::open_workspace_db_at(db_path)?;
    let tx = conn
        .transaction()
        .map_err(|err| format!("开启工作区清理事务失败: {err}"))?;
    tx.execute("DELETE FROM todo_boards", [])
        .map_err(|err| format!("清理工作区看板表失败: {err}"))?;
    tx.execute("DELETE FROM todo_cards", [])
        .map_err(|err| format!("清理工作区卡片表失败: {err}"))?;
    tx.execute("DELETE FROM card_comments", [])
        .map_err(|err| format!("清理工作区评论表失败: {err}"))?;
    tx.execute("DELETE FROM card_comment_reads", [])
        .map_err(|err| format!("清理工作区评论已读表失败: {err}"))?;
    tx.execute(
        "DELETE FROM db_meta WHERE key = ?1",
        params![TODOS_MIGRATION_META_KEY],
    )
    .map_err(|err| format!("清理工作区待办迁移标记失败: {err}"))?;
    tx.commit()
        .map_err(|err| format!("提交工作区清理事务失败: {err}"))
}

pub(crate) struct ImportedTodosSnapshot {
    pub index: Value,
    pub contents: HashMap<String, String>,
    pub comments: Vec<super::TodoCardComment>,
}

pub(crate) fn load_local_todos_snapshot_for_import(
    app: &AppHandle,
) -> Result<Option<ImportedTodosSnapshot>, String> {
    let local_db_path = crate::local_db::local_workspace_db_path(app)?;
    let legacy_root = crate::accounts::session::legacy_local_todos_root(app)?;
    let legacy_index_path = todo_index_path_in_root(&legacy_root);
    if !local_db_path.is_file() && !legacy_index_path.is_file() {
        return Ok(None);
    }
    let mut conn = crate::local_db::open_workspace_db_at(&local_db_path)?;
    migrate_todos_json_if_needed_at(&mut conn, &legacy_root)?;
    let index = read_todo_index_from_conn(&mut conn)?;
    let contents = read_all_card_contents_from_conn(&conn)?;
    let comments = super::read_all_active_comments_from_conn(&conn)?;
    Ok(Some(ImportedTodosSnapshot {
        index,
        contents,
        comments,
    }))
}

const CARD_PREVIEW_ATTACHMENT_LIMIT: usize = 2;

fn project_preview_item(attachment: &Value) -> Value {
    json!({
        "id": attachment["id"],
        "kind": attachment["kind"],
        "originalName": attachment["originalName"],
        "width": attachment["width"],
        "height": attachment["height"],
        "aspectRatio": attachment["aspectRatio"],
        "orientation": attachment["orientation"],
        "focalPoint": attachment["focalPoint"],
        "previewMode": attachment["previewMode"],
        "thumbUrl": attachment["thumbUrl"],
    })
}

pub(super) fn select_preview_attachments(
    attachments: &[Value],
    cover_id: Option<&str>,
) -> (Vec<Value>, usize) {
    let mut selected = Vec::with_capacity(CARD_PREVIEW_ATTACHMENT_LIMIT);
    let mut cover_index = None;

    if let Some(cid) = cover_id.filter(|v| !v.trim().is_empty()) {
        if let Some(pos) = attachments
            .iter()
            .position(|att| att["id"].as_str() == Some(cid))
        {
            selected.push(project_preview_item(&attachments[pos]));
            cover_index = Some(pos);
        }
    }

    for (idx, att) in attachments.iter().enumerate() {
        if selected.len() >= CARD_PREVIEW_ATTACHMENT_LIMIT {
            break;
        }
        if Some(idx) == cover_index {
            continue;
        }
        selected.push(project_preview_item(att));
    }

    let extra_count = attachments.len().saturating_sub(selected.len());
    (selected, extra_count)
}

fn build_card_projection_base(card: &Value, content: &str) -> (Value, Vec<Value>, Vec<Value>) {
    let card_id = card["id"].as_str().unwrap_or_default().to_string();
    let raw_attachments = card["attachments"].as_array().cloned().unwrap_or_default();
    let card_attachments: Vec<Value> = raw_attachments
        .iter()
        .map(|att| enrich_attachment_view(&card_id, att))
        .collect();

    let raw_subtasks = card["subtasks"].as_array().cloned().unwrap_or_default();
    let mut subtasks = Vec::with_capacity(raw_subtasks.len());
    let mut all_attachments = card_attachments.clone();

    for subtask in raw_subtasks {
        if is_subtask_deleted(&subtask) {
            continue;
        }
        let mut next_subtask = subtask.clone();
        let sub_attachments: Vec<Value> = subtask["attachments"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .map(|att| enrich_attachment_view(&card_id, att))
                    .collect()
            })
            .unwrap_or_default();
        all_attachments.extend(sub_attachments.iter().cloned());
        next_subtask["attachmentCount"] = json!(sub_attachments.len());
        next_subtask["attachments"] = Value::Array(sub_attachments);
        subtasks.push(next_subtask);
    }

    let cover_id = card["coverAttachmentId"].as_str().map(str::to_string);
    let (preview_attachments, extra_attachment_count) =
        select_preview_attachments(&all_attachments, cover_id.as_deref());

    let subtask_total = subtasks.len();
    let subtask_completed = subtasks
        .iter()
        .filter(|item| item["completed"].as_bool().unwrap_or(false))
        .count();
    let summary_text = summarize_card_text(content);

    let summary = json!({
        "id": card["id"],
        "boardId": card["boardId"],
        "columnId": card["columnId"],
        "title": card["title"],
        "priority": normalize_stored_priority(card["priority"].as_str()),
        "summaryText": summary_text,
        "tags": card["tags"],
        "archived": card["archived"],
        "position": card["position"],
        "revision": card["revision"],
        "updatedBy": card["updatedBy"],
        "deletedAt": card["deletedAt"],
        "createdAt": card["createdAt"],
        "updatedAt": card["updatedAt"],
        "subtaskTotal": subtask_total,
        "subtaskCompleted": subtask_completed,
        "coverAttachmentId": card["coverAttachmentId"],
        "previewAttachments": preview_attachments,
        "attachmentCount": all_attachments.len(),
        "extraAttachmentCount": extra_attachment_count,
    });
    (summary, subtasks, card_attachments)
}

/// Lightweight board-list summary projection (omits full Markdown body, full subtasks, and bloated attachment metadata).
pub(super) fn enrich_card_summary_view(
    card: &Value,
    content: &str,
    metrics: &super::comment_commands::CardCommentBadgeMetrics,
) -> Value {
    let (mut summary, _, _) = build_card_projection_base(card, content);
    summary["commentCount"] = json!(metrics.total_count);
    summary["unreadCommentCount"] = json!(metrics.unread_count);
    summary["unreadMentionCount"] = json!(metrics.unread_mention_count);
    summary
}

/// Full card detail projection used when opening or editing a single card modal.
pub(super) fn enrich_card_detail_view(
    card: &Value,
    content: String,
    metrics: &super::comment_commands::CardCommentBadgeMetrics,
) -> Value {
    let (mut detail, subtasks, attachments) = build_card_projection_base(card, &content);
    detail["content"] = json!(content);
    detail["subtasks"] = Value::Array(subtasks);
    detail["attachments"] = Value::Array(attachments);
    detail["commentCount"] = json!(metrics.total_count);
    detail["unreadCommentCount"] = json!(metrics.unread_count);
    detail["unreadMentionCount"] = json!(metrics.unread_mention_count);
    detail
}

fn read_all_todo_card_contents_unlocked(
    app: &AppHandle,
) -> Result<HashMap<String, String>, String> {
    let conn = open_todos_db_and_migrate(app)?;
    read_all_card_contents_from_conn(&conn)
}

pub fn todo_state_from_index_unlocked(
    app: &AppHandle,
    store: &TodoStoreState,
    index: &Value,
    counts: Value,
) -> Result<Value, String> {
    let db_contents = read_all_todo_card_contents_unlocked(app)?;
    let comment_metrics = super::comment_commands::read_card_comment_metrics_unlocked(app)?;
    let default_metrics = super::comment_commands::CardCommentBadgeMetrics::default();
    let mut cache = store
        .content_cache
        .lock()
        .map_err(|_| "failed to lock todo content cache".to_string())?;
    cache.clear();
    let cards = index["cards"]
        .as_array()
        .map(|cards| {
            cards
                .iter()
                .filter(|card| !is_card_deleted(card))
                .map(|card| {
                    let card_id = card["id"].as_str().unwrap_or_default().to_string();
                    let content = db_contents.get(&card_id).cloned().unwrap_or_default();
                    let metrics = comment_metrics.get(&card_id).unwrap_or(&default_metrics);
                    let view = enrich_card_summary_view(card, &content, metrics);
                    cache.insert(card_id, content);
                    Ok(view)
                })
                .collect::<Result<Vec<_>, String>>()
        })
        .unwrap_or_else(|| Ok(Vec::new()))?;
    Ok(json!({
        "activeBoardId": index["activeBoardId"],
        "boards": index["boards"],
        "cards": cards,
        "counts": counts,
    }))
}

pub(super) fn todo_state_from_cache_or_disk(
    app: &AppHandle,
    store: &TodoStoreState,
    index: &Value,
    counts: Value,
) -> Result<Value, String> {
    let mut lazy_db_contents: Option<HashMap<String, String>> = None;
    let comment_metrics = super::comment_commands::read_card_comment_metrics_unlocked(app)?;
    let default_metrics = super::comment_commands::CardCommentBadgeMetrics::default();
    let mut cache = store
        .content_cache
        .lock()
        .map_err(|_| "failed to lock todo content cache".to_string())?;
    let cards = index["cards"]
        .as_array()
        .map(|cards| {
            cards
                .iter()
                .filter(|card| !is_card_deleted(card))
                .map(|card| {
                    let card_id = card["id"].as_str().unwrap_or_default().to_string();
                    let content = if let Some(cached) = cache.get(&card_id) {
                        cached.clone()
                    } else {
                        if lazy_db_contents.is_none() {
                            lazy_db_contents = Some(read_all_todo_card_contents_unlocked(app)?);
                        }
                        let loaded = lazy_db_contents
                            .as_ref()
                            .and_then(|map| map.get(&card_id))
                            .cloned()
                            .unwrap_or_default();
                        cache.insert(card_id.clone(), loaded.clone());
                        loaded
                    };
                    let metrics = comment_metrics.get(&card_id).unwrap_or(&default_metrics);
                    Ok(enrich_card_summary_view(card, &content, metrics))
                })
                .collect::<Result<Vec<_>, String>>()
        })
        .unwrap_or_else(|| Ok(Vec::new()))?;
    Ok(json!({
        "activeBoardId": index["activeBoardId"],
        "boards": index["boards"],
        "cards": cards,
        "counts": counts,
    }))
}

#[derive(Debug, Clone)]
pub(crate) struct MissingThumbTarget {
    pub card_id: String,
    pub thumb_file_name: String,
    pub remote_thumb_key: String,
}

fn mark_attachment_slice_synced(
    items: &mut [Value],
    uploaded_blobs: &HashMap<String, (String, String)>,
) {
    for att in items {
        let Some(att_id) = att["id"].as_str() else {
            continue;
        };
        if let Some((thumb_key, orig_key)) = uploaded_blobs.get(att_id) {
            att["syncState"] = json!("synced");
            att["remoteThumbKey"] = json!(thumb_key);
            att["remoteOriginalKey"] = json!(orig_key);
        } else if att
            .get("remoteOriginalKey")
            .and_then(Value::as_str)
            .is_some()
        {
            att["syncState"] = json!("synced");
        }
    }
}

fn cleanup_card_local_assets(app: &AppHandle, store: &TodoStoreState, card_id: &str) {
    if let Ok(dir) = card_attachments_dir(app, card_id) {
        let _ = fs::remove_dir_all(dir);
    }
    if let Ok(mut cache) = store.content_cache.lock() {
        cache.remove(card_id);
    }
}

/// Apply synced upload keys, pulled/merged remote cards, tombstones, and prune expired tombstones.
/// Returns list of thumbnails missing on local disk so the sync engine can pre-fetch them off-lock.
pub(crate) fn apply_synced_todo_changes(
    app: &AppHandle,
    merged_cards: &[Value],
    removed_ids: &[String],
    uploaded_blobs: &HashMap<String, (String, String)>,
    unsynced_card_ids: &HashSet<String>,
) -> Result<Vec<MissingThumbTarget>, String> {
    const TOMBSTONE_RETENTION_MS: u128 = 30 * 24 * 60 * 60 * 1000;

    with_todo_store_lock(app, |store| {
        let mut index = read_todo_index_unlocked(app)?;
        let board_id = todo_board_id(&index);
        let now_str = crate::timestamp_string();
        let now_ms = now_str.parse::<u128>().unwrap_or(0);
        let existing_contents = read_all_todo_card_contents_unlocked(app)?;
        let mut pending_content_updates: Vec<(String, String)> = Vec::new();
        let mut cache_inserts: Vec<(String, String)> = Vec::new();

        if let Some(cards) = index["cards"].as_array_mut() {
            if !uploaded_blobs.is_empty() {
                for card in cards.iter_mut() {
                    if let Some(atts) = card["attachments"].as_array_mut() {
                        mark_attachment_slice_synced(atts, uploaded_blobs);
                    }
                    if let Some(subtasks) = card["subtasks"].as_array_mut() {
                        for sub in subtasks {
                            if let Some(atts) = sub["attachments"].as_array_mut() {
                                mark_attachment_slice_synced(atts, uploaded_blobs);
                            }
                        }
                    }
                }
            }

            for remote_card in merged_cards {
                let Some(card_id) = remote_card["id"].as_str().filter(|v| !v.is_empty()) else {
                    continue;
                };
                let existing_pos = cards.iter().position(|c| c["id"].as_str() == Some(card_id));
                let local_card = existing_pos.map(|pos| cards[pos].clone());
                let local_content = if existing_pos.is_some() {
                    existing_contents.get(card_id).cloned().unwrap_or_default()
                } else {
                    String::new()
                };
                let (mut next_card, next_content) =
                    crate::sync::merge::merge_remote_card_into_local(
                        local_card.as_ref(),
                        &local_content,
                        remote_card,
                        unsynced_card_ids.contains(card_id),
                    );
                next_card["boardId"] = json!(board_id);
                if let Some(atts) = next_card["attachments"].as_array_mut() {
                    mark_attachment_slice_synced(atts, uploaded_blobs);
                }
                if let Some(subtasks) = next_card["subtasks"].as_array_mut() {
                    for sub in subtasks {
                        if let Some(atts) = sub["attachments"].as_array_mut() {
                            mark_attachment_slice_synced(atts, uploaded_blobs);
                        }
                    }
                }

                if is_card_deleted(&next_card) {
                    cleanup_card_local_assets(app, store, card_id);
                    pending_content_updates.push((card_id.to_string(), String::new()));
                } else {
                    pending_content_updates.push((card_id.to_string(), next_content.clone()));
                    cache_inserts.push((card_id.to_string(), next_content));
                }

                if let Some(pos) = existing_pos {
                    cards[pos] = next_card;
                } else {
                    cards.push(next_card);
                }
            }

            for removed_id in removed_ids {
                if let Some(card) = cards
                    .iter_mut()
                    .find(|c| c["id"].as_str() == Some(removed_id.as_str()))
                {
                    if card["deletedAt"].is_null() {
                        card["deletedAt"] = json!(now_str);
                        card["updatedAt"] = json!(now_str);
                        card["attachments"] = json!([]);
                        card["subtasks"] = json!([]);
                        card["coverAttachmentId"] = Value::Null;
                    }
                    cleanup_card_local_assets(app, store, removed_id);
                    pending_content_updates.push((removed_id.clone(), String::new()));
                }
            }
        }

        if now_ms > TOMBSTONE_RETENTION_MS {
            crate::sync::merge::prune_synced_tombstones(
                &mut index,
                now_ms - TOMBSTONE_RETENTION_MS,
            );
        }
        let content_refs: Vec<(&str, &str)> = pending_content_updates
            .iter()
            .map(|(id, body)| (id.as_str(), body.as_str()))
            .collect();
        save_todo_index_with_contents_unlocked(app, &index, &content_refs)?;
        if !cache_inserts.is_empty() {
            if let Ok(mut cache) = store.content_cache.lock() {
                for (card_id, body) in cache_inserts {
                    cache.insert(card_id, body);
                }
            }
        }

        let mut missing_thumbs = Vec::new();
        let normalized = read_todo_index_unlocked(app)?;
        if let Some(cards) = normalized["cards"].as_array() {
            for card in cards {
                if is_card_deleted(card) {
                    continue;
                }
                let Some(card_id) = card["id"].as_str() else {
                    continue;
                };
                let Ok(dir) = card_attachments_dir(app, card_id) else {
                    continue;
                };
                let mut check_att = |att: &Value| {
                    let Some(thumb_name) = att["thumbFileName"].as_str().filter(|v| !v.is_empty())
                    else {
                        return;
                    };
                    let Some(remote_key) = att["remoteThumbKey"].as_str().filter(|v| !v.is_empty())
                    else {
                        return;
                    };
                    if !dir.join(thumb_name).is_file() {
                        missing_thumbs.push(MissingThumbTarget {
                            card_id: card_id.to_string(),
                            thumb_file_name: thumb_name.to_string(),
                            remote_thumb_key: remote_key.to_string(),
                        });
                    }
                };
                for att in card["attachments"].as_array().into_iter().flatten() {
                    check_att(att);
                }
                for sub in card["subtasks"].as_array().into_iter().flatten() {
                    if is_subtask_deleted(sub) {
                        continue;
                    }
                    for att in sub["attachments"].as_array().into_iter().flatten() {
                        check_att(att);
                    }
                }
            }
        }
        Ok(missing_thumbs)
    })
}

/// Resolve remote blob kind and object key for an attachment missing from local disk cache.
pub(crate) fn find_remote_attachment_blob(
    app: &AppHandle,
    card_id: &str,
    file_name: &str,
) -> Result<Option<(&'static str, String, PathBuf)>, String> {
    with_todo_store_lock(app, |_| {
        let index = read_todo_index_unlocked(app)?;
        let Some(card) = index["cards"]
            .as_array()
            .and_then(|cards| cards.iter().find(|c| c["id"].as_str() == Some(card_id)))
        else {
            return Ok(None);
        };
        if is_card_deleted(card) {
            return Ok(None);
        }

        let target_dir = todo_attachments_root(app)?.join(card_id);
        let target_path = target_dir.join(file_name);
        if !crate::is_path_inside(&target_path, &target_dir) {
            return Ok(None);
        }

        let match_att = |att: &Value| -> Option<(&'static str, String, PathBuf)> {
            if att["thumbFileName"].as_str() == Some(file_name) {
                let key = att["remoteThumbKey"].as_str()?.trim();
                if !key.is_empty() {
                    return Some(("thumb", key.to_string(), target_path.clone()));
                }
            }
            if att["fileName"].as_str() == Some(file_name) {
                let key = att["remoteOriginalKey"].as_str()?.trim();
                if !key.is_empty() {
                    return Some(("original", key.to_string(), target_path.clone()));
                }
            }
            None
        };

        for att in card["attachments"].as_array().into_iter().flatten() {
            if let Some(found) = match_att(att) {
                return Ok(Some(found));
            }
        }
        for sub in card["subtasks"].as_array().into_iter().flatten() {
            if is_subtask_deleted(sub) {
                continue;
            }
            for att in sub["attachments"].as_array().into_iter().flatten() {
                if let Some(found) = match_att(att) {
                    return Ok(Some(found));
                }
            }
        }
        Ok(None)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn select_preview_attachments_limits_to_two_and_prioritizes_cover() {
        let empty = select_preview_attachments(&[], None);
        assert_eq!(empty.0.len(), 0);
        assert_eq!(empty.1, 0);

        let single = vec![json!({ "id": "a1", "kind": "image" })];
        let (one_preview, one_extra) = select_preview_attachments(&single, None);
        assert_eq!(one_preview.len(), 1);
        assert_eq!(one_extra, 0);

        let five = vec![
            json!({ "id": "a1" }),
            json!({ "id": "a2" }),
            json!({ "id": "a3" }),
            json!({ "id": "a4" }),
            json!({ "id": "a5" }),
        ];
        let (two_preview, two_extra) = select_preview_attachments(&five, Some("a4"));
        assert_eq!(two_preview.len(), 2);
        assert_eq!(two_preview[0]["id"], json!("a4"));
        assert_eq!(two_preview[1]["id"], json!("a1"));
        assert_eq!(two_extra, 3);
    }

    #[test]
    fn summary_view_omits_heavy_body_and_full_arrays() {
        let card = json!({
            "id": "c1",
            "boardId": "default-board",
            "columnId": "todo",
            "title": "巡检",
            "priority": "high",
            "tags": [],
            "archived": false,
            "subtasks": [
                { "id": "s1", "title": "一步", "completed": true },
                { "id": "s2", "title": "二步", "completed": false }
            ],
            "attachments": [
                { "id": "a1", "kind": "image", "fileName": "a1.png", "thumbFileName": "thumb_a1.png", "sha256": "abc" },
                { "id": "a2", "kind": "image", "fileName": "a2.png", "thumbFileName": "thumb_a2.png" },
                { "id": "a3", "kind": "image", "fileName": "a3.png", "thumbFileName": "thumb_a3.png" }
            ],
            "coverAttachmentId": "a2"
        });

        let metrics = super::super::comment_commands::CardCommentBadgeMetrics {
            total_count: 4,
            unread_count: 2,
            unread_mention_count: 1,
        };
        let summary = enrich_card_summary_view(&card, "# 标题\n这是详细长正文\n第二行", &metrics);
        assert!(summary.get("content").is_none());
        assert!(summary.get("subtasks").is_none());
        assert!(summary.get("attachments").is_none());
        assert_eq!(summary["summaryText"], json!("标题"));
        assert_eq!(summary["priority"], json!("high"));
        assert_eq!(summary["commentCount"], json!(4));
        assert_eq!(summary["unreadCommentCount"], json!(2));
        assert_eq!(summary["unreadMentionCount"], json!(1));
        assert_eq!(summary["subtaskTotal"], json!(2));
        assert_eq!(summary["subtaskCompleted"], json!(1));
        assert_eq!(summary["attachmentCount"], json!(3));
        assert_eq!(summary["extraAttachmentCount"], json!(1));
        assert_eq!(
            summary["previewAttachments"].as_array().map(Vec::len),
            Some(2)
        );
        assert_eq!(summary["previewAttachments"][0]["id"], json!("a2"));

        let detail = enrich_card_detail_view(&card, "完整正文".to_string(), &metrics);
        assert_eq!(detail["content"], json!("完整正文"));
        assert_eq!(detail["commentCount"], json!(4));
        assert_eq!(detail["unreadCommentCount"], json!(2));
        assert_eq!(detail["unreadMentionCount"], json!(1));
        assert_eq!(detail["subtasks"].as_array().map(Vec::len), Some(2));
        assert_eq!(detail["attachments"].as_array().map(Vec::len), Some(3));
    }

    #[test]
    fn summary_view_aggregates_subtask_attachments_and_subtask_cover() {
        let card = json!({
            "id": "c-sub",
            "boardId": "default-board",
            "columnId": "todo",
            "title": "子任务带图",
            "tags": [],
            "archived": false,
            "attachments": [],
            "subtasks": [
                {
                    "id": "s1",
                    "title": "拍照核对",
                    "completed": false,
                    "attachments": [
                        { "id": "sa1", "kind": "image", "fileName": "sa1.png", "thumbFileName": "thumb_sa1.png" },
                        { "id": "sa2", "kind": "image", "fileName": "sa2.png", "thumbFileName": "thumb_sa2.png" },
                        { "id": "sa3", "kind": "image", "fileName": "sa3.png", "thumbFileName": "thumb_sa3.png" }
                    ]
                }
            ],
            "coverAttachmentId": "sa2"
        });

        let zero_metrics = super::super::comment_commands::CardCommentBadgeMetrics::default();
        let summary = enrich_card_summary_view(&card, "", &zero_metrics);
        assert_eq!(summary["attachmentCount"], json!(3));
        assert_eq!(summary["extraAttachmentCount"], json!(1));
        assert_eq!(
            summary["previewAttachments"].as_array().map(Vec::len),
            Some(2)
        );
        assert_eq!(summary["previewAttachments"][0]["id"], json!("sa2"));
        assert_eq!(summary["previewAttachments"][1]["id"], json!("sa1"));

        let detail = enrich_card_detail_view(&card, String::new(), &zero_metrics);
        assert_eq!(detail["subtasks"][0]["attachmentCount"], json!(3));
        assert!(detail["subtasks"][0]["attachments"][0]["thumbUrl"]
            .as_str()
            .unwrap_or("")
            .contains("c-sub/thumb_sa1.png"));
    }

    #[test]
    fn todos_sqlite_migrates_legacy_boards_and_cards_preserving_attachments() {
        let root = std::env::temp_dir().join(format!(
            "tidydesk-todos-sqlite-test-{}-{}",
            std::process::id(),
            crate::timestamp_string()
        ));
        let _ = fs::remove_dir_all(&root);
        let todos_root = root.join("todos");
        let cards_dir = todos_root.join("cards");
        let att_dir = todos_root.join("attachments").join("card-1");
        fs::create_dir_all(&cards_dir).unwrap();
        fs::create_dir_all(&att_dir).unwrap();
        fs::write(att_dir.join("photo.png"), b"png-bytes").unwrap();
        fs::write(cards_dir.join("card-1.md"), "# 巡检正文\n第二行").unwrap();
        fs::write(
            todo_index_path_in_root(&todos_root),
            serde_json::to_string_pretty(&json!({
                "version": 2,
                "activeBoardId": "default-board",
                "boards": [{
                    "id": "default-board",
                    "title": "我的看板",
                    "columns": [
                        { "id": "todo", "title": "待做" },
                        { "id": "done", "title": "已完成" }
                    ],
                    "cardOrder": { "todo": ["card-1"], "done": [] },
                    "updatedAt": "100"
                }],
                "cards": [{
                    "id": "card-1",
                    "boardId": "default-board",
                    "columnId": "todo",
                    "title": "老卡片",
                    "tags": ["ops"],
                    "archived": false,
                    "subtasks": [],
                    "attachments": [],
                    "position": "a0",
                    "revision": 2,
                    "updatedBy": "local",
                    "deletedAt": null,
                    "createdAt": "100",
                    "updatedAt": "100"
                }]
            }))
            .unwrap(),
        )
        .unwrap();

        let db_path = root.join("tidydesk-local.db");
        let mut conn = crate::local_db::open_workspace_db_at(&db_path).unwrap();
        migrate_todos_json_if_needed_at(&mut conn, &todos_root).unwrap();

        // Legacy index and cards folder archived; attachment binaries untouched
        assert!(!todo_index_path_in_root(&todos_root).exists());
        assert!(todos_root.join("boards.json.pre-sqlite.bak").is_file());
        assert!(!cards_dir.exists());
        assert!(todos_root.join("cards.pre-sqlite.bak").is_dir());
        assert_eq!(fs::read(att_dir.join("photo.png")).unwrap(), b"png-bytes");

        // Idempotent second run
        migrate_todos_json_if_needed_at(&mut conn, &todos_root).unwrap();

        let loaded = read_todo_index_from_conn(&mut conn).unwrap();
        assert_eq!(loaded["cards"].as_array().map(Vec::len), Some(1));
        assert_eq!(loaded["cards"][0]["title"], json!("老卡片"));
        let contents = read_all_card_contents_from_conn(&conn).unwrap();
        assert_eq!(
            contents.get("card-1").map(String::as_str),
            Some("# 巡检正文\n第二行")
        );

        // Metadata-only index rewrite preserves existing content_md
        let mut updated_index = loaded;
        updated_index["cards"][0]["title"] = json!("已重命名");
        write_todo_index_and_contents_in_conn_with_meta(&mut conn, &updated_index, &[], None)
            .unwrap();
        let contents_after_meta_update = read_all_card_contents_from_conn(&conn).unwrap();
        assert_eq!(
            contents_after_meta_update.get("card-1").map(String::as_str),
            Some("# 巡检正文\n第二行")
        );

        // Removing card from index cleans todo_cards row
        updated_index["cards"] = json!([]);
        updated_index["boards"][0]["cardOrder"]["todo"] = json!([]);
        write_todo_index_and_contents_in_conn_with_meta(&mut conn, &updated_index, &[], None)
            .unwrap();
        assert!(read_all_card_contents_from_conn(&conn).unwrap().is_empty());

        drop(conn);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn todos_sqlite_incremental_card_crud_preserves_other_cards() {
        let root = std::env::temp_dir().join(format!(
            "tidydesk-todos-inc-test-{}-{}",
            std::process::id(),
            crate::timestamp_string()
        ));
        let _ = fs::remove_dir_all(&root);
        let db_path = root.join("tidydesk-local.db");
        let mut conn = crate::local_db::open_workspace_db_at(&db_path).unwrap();

        let mut index = create_default_todo_index();
        let card1 = json!({
            "id": "card-a",
            "boardId": "default-board",
            "columnId": "todo",
            "title": "卡片 A",
            "priority": "urgent",
            "tags": [],
            "archived": false,
            "subtasks": [],
            "attachments": [],
            "position": "a0",
            "revision": 1,
            "updatedBy": "local",
            "deletedAt": Value::Null,
            "createdAt": "100",
            "updatedAt": "100"
        });
        let card2 = json!({
            "id": "card-b",
            "boardId": "default-board",
            "columnId": "doing",
            "title": "卡片 B",
            "priority": "normal",
            "tags": [],
            "archived": false,
            "subtasks": [],
            "attachments": [],
            "position": "a0",
            "revision": 1,
            "updatedBy": "local",
            "deletedAt": Value::Null,
            "createdAt": "100",
            "updatedAt": "100"
        });

        index["cards"].as_array_mut().unwrap().push(card1.clone());
        index["boards"][0]["cardOrder"]["todo"] = json!(["card-a"]);
        insert_todo_card_in_conn(&mut conn, &index, &card1, "正文 A").unwrap();

        index["cards"].as_array_mut().unwrap().push(card2.clone());
        index["boards"][0]["cardOrder"]["doing"] = json!(["card-b"]);
        insert_todo_card_in_conn(&mut conn, &index, &card2, "正文 B").unwrap();

        // Update only card1 metadata without passing content; card2 and card1 body remain intact
        let mut card1_updated = card1;
        card1_updated["title"] = json!("卡片 A 已更新");
        index["cards"][0] = card1_updated.clone();
        update_todo_card_in_conn(&mut conn, &index, &card1_updated, None).unwrap();

        let contents = read_all_card_contents_from_conn(&conn).unwrap();
        assert_eq!(contents.get("card-a").map(String::as_str), Some("正文 A"));
        assert_eq!(contents.get("card-b").map(String::as_str), Some("正文 B"));

        // Soft-delete card1 clears card1 content while preserving card2
        let mut tombstone = card1_updated;
        tombstone["deletedAt"] = json!("200");
        delete_todo_card_in_db_test_helper(&mut conn, &index, "card-a", Some(&tombstone));
        let contents_after_soft = read_all_card_contents_from_conn(&conn).unwrap();
        assert_eq!(
            contents_after_soft.get("card-a").map(String::as_str),
            Some("")
        );
        assert_eq!(
            contents_after_soft.get("card-b").map(String::as_str),
            Some("正文 B")
        );

        // Hard-delete card2 removes card2 row cleanly
        delete_todo_card_in_conn(&mut conn, &index, "card-b", None).unwrap();
        let contents_after_hard = read_all_card_contents_from_conn(&conn).unwrap();
        assert!(!contents_after_hard.contains_key("card-b"));

        drop(conn);
        let _ = fs::remove_dir_all(&root);
    }

    fn delete_todo_card_in_db_test_helper(
        conn: &mut Connection,
        index: &Value,
        card_id: &str,
        tombstone: Option<&Value>,
    ) {
        delete_todo_card_in_conn(conn, index, card_id, tombstone).unwrap();
    }
}
