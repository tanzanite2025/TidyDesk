use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

const QUICK_NOTES_FILE_NAME: &str = "quick-notes.json";
const QUICK_NOTE_FALLBACK_TITLE: &str = "Untitled Note";

#[derive(Debug, Default)]
pub struct QuickNotesStoreState(Mutex<()>);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNote {
    id: String,
    title: String,
    content: String,
    pinned: bool,
    favorite: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNotesState {
    notes: Vec<QuickNote>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateQuickNotePayload {
    title: Option<String>,
    content: Option<String>,
    pinned: Option<bool>,
    favorite: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateQuickNotePayload {
    id: String,
    title: Option<String>,
    content: Option<String>,
    pinned: Option<bool>,
    favorite: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawQuickNote {
    id: Option<String>,
    title: Option<String>,
    content: Option<String>,
    pinned: Option<bool>,
    favorite: Option<bool>,
    created_at: Option<String>,
    updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StoredQuickNotesFile {
    #[serde(default)]
    notes: Vec<RawQuickNote>,
}

pub(crate) fn with_quick_notes_store_lock<T>(
    app: &AppHandle,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<QuickNotesStoreState>();
    let _guard = state
        .0
        .lock()
        .map_err(|_| "failed to lock quick notes store".to_string())?;
    operation()
}

fn safe_quick_note_title(title: &str, content: &str, fallback: &str) -> String {
    let normalized = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let value = if normalized.is_empty() {
        content
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .unwrap_or(fallback)
    } else {
        normalized.as_str()
    };
    value.chars().take(80).collect()
}

static QUICK_NOTE_ID_SEQ: AtomicU64 = AtomicU64::new(0);

fn create_quick_note_id() -> String {
    let seq = QUICK_NOTE_ID_SEQ.fetch_add(1, Ordering::Relaxed);
    format!(
        "note-{}-{}-{}",
        crate::timestamp_string(),
        std::process::id(),
        seq
    )
}

fn sort_quick_notes(notes: &mut [QuickNote]) {
    notes.sort_by(|left, right| {
        right
            .pinned
            .cmp(&left.pinned)
            .then_with(|| right.favorite.cmp(&left.favorite))
            .then_with(|| right.updated_at.cmp(&left.updated_at))
            .then_with(|| right.created_at.cmp(&left.created_at))
    });
}

fn quick_notes_legacy_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::accounts::account_quick_notes_root(app)?.join(QUICK_NOTES_FILE_NAME))
}

pub(crate) fn quick_notes_backup_path(app: &AppHandle) -> Result<PathBuf, String> {
    quick_notes_legacy_path(app)
}

fn normalize_quick_note(note: RawQuickNote) -> Option<QuickNote> {
    let id = note.id?.trim().to_string();
    if id.is_empty() {
        return None;
    }

    let content = note.content.unwrap_or_default();
    let created_at = note
        .created_at
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(crate::timestamp_string);
    let updated_at = note
        .updated_at
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| created_at.clone());

    Some(QuickNote {
        id,
        title: safe_quick_note_title(
            note.title.as_deref().unwrap_or(""),
            &content,
            QUICK_NOTE_FALLBACK_TITLE,
        ),
        content,
        pinned: note.pinned.unwrap_or(false),
        favorite: note.favorite.unwrap_or(false),
        created_at,
        updated_at,
    })
}

pub(crate) fn migrate_quick_notes_json_if_needed(
    conn: &mut Connection,
    legacy_path: &Path,
) -> Result<(), String> {
    if crate::local_db::get_meta_flag(conn, "migrated_quick_notes")?.is_some() {
        return Ok(());
    }
    if !legacy_path.is_file() {
        crate::local_db::set_meta_flag(conn, "migrated_quick_notes", "none")?;
        return Ok(());
    }

    let raw = fs::read_to_string(legacy_path)
        .map_err(|err| format!("failed to read legacy quick notes: {err}"))?;
    let notes = match serde_json::from_str::<StoredQuickNotesFile>(&raw) {
        Ok(parsed) => parsed
            .notes
            .into_iter()
            .filter_map(normalize_quick_note)
            .collect::<Vec<_>>(),
        Err(_) => {
            crate::persistence::backup_corrupt_file(legacy_path, "quick notes")?;
            Vec::new()
        }
    };

    {
        let tx = conn
            .transaction()
            .map_err(|err| format!("开启 quick_notes 迁移事务失败: {err}"))?;
        let existing: i64 = tx
            .query_row("SELECT COUNT(*) FROM quick_notes", [], |r| r.get(0))
            .map_err(|err| format!("统计 quick_notes 行数失败: {err}"))?;
        if existing == 0 {
            for note in &notes {
                tx.execute(
                    "INSERT OR REPLACE INTO quick_notes
                     (id, title, content, pinned, favorite, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![
                        note.id,
                        note.title,
                        note.content,
                        if note.pinned { 1 } else { 0 },
                        if note.favorite { 1 } else { 0 },
                        note.created_at,
                        note.updated_at
                    ],
                )
                .map_err(|err| format!("迁移写入 quick_notes 失败: {err}"))?;
            }
        }
        tx.execute(
            "INSERT OR REPLACE INTO db_meta (key, value) VALUES ('migrated_quick_notes', ?1)",
            [crate::timestamp_string()],
        )
        .map_err(|err| format!("写入 migrated_quick_notes 标记失败: {err}"))?;
        tx.commit()
            .map_err(|err| format!("提交 quick_notes 迁移事务失败: {err}"))?;
    }

    crate::local_db::archive_legacy_file_once(legacy_path)?;
    Ok(())
}

fn open_migrated_quick_notes_conn(
    db_path: &Path,
    legacy_path: &Path,
) -> Result<Connection, String> {
    let mut conn = crate::local_db::open_workspace_db_at(db_path)?;
    migrate_quick_notes_json_if_needed(&mut conn, legacy_path)?;
    Ok(conn)
}

fn read_quick_notes_from_conn(conn: &Connection) -> Result<Vec<QuickNote>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, content, pinned, favorite, created_at, updated_at FROM quick_notes",
        )
        .map_err(|err| format!("查询 quick_notes 失败: {err}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(RawQuickNote {
                id: Some(row.get::<_, String>(0)?),
                title: Some(row.get::<_, String>(1)?),
                content: Some(row.get::<_, String>(2)?),
                pinned: Some(row.get::<_, i64>(3)? != 0),
                favorite: Some(row.get::<_, i64>(4)? != 0),
                created_at: Some(row.get::<_, String>(5)?),
                updated_at: Some(row.get::<_, String>(6)?),
            })
        })
        .map_err(|err| format!("读取 quick_notes 行失败: {err}"))?;

    let mut notes = Vec::new();
    for item in rows {
        let raw = item.map_err(|err| format!("解析 quick_notes 行失败: {err}"))?;
        if let Some(normalized) = normalize_quick_note(raw) {
            notes.push(normalized);
        }
    }
    sort_quick_notes(&mut notes);
    Ok(notes)
}

fn write_quick_notes_in_conn(conn: &mut Connection, notes: &[QuickNote]) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|err| format!("开启 quick_notes 写入事务失败: {err}"))?;
    tx.execute("DELETE FROM quick_notes", [])
        .map_err(|err| format!("清理 quick_notes 表失败: {err}"))?;
    for note in notes {
        tx.execute(
            "INSERT INTO quick_notes (id, title, content, pinned, favorite, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                note.id,
                note.title,
                note.content,
                if note.pinned { 1 } else { 0 },
                if note.favorite { 1 } else { 0 },
                note.created_at,
                note.updated_at
            ],
        )
        .map_err(|err| format!("写入 quick_notes 行失败: {err}"))?;
    }
    tx.commit()
        .map_err(|err| format!("提交 quick_notes 事务失败: {err}"))?;
    Ok(())
}

fn read_quick_notes_unlocked(app: &AppHandle) -> Result<Vec<QuickNote>, String> {
    let db_path = crate::local_db::workspace_db_path(app)?;
    let legacy_path = quick_notes_legacy_path(app)?;
    let conn = open_migrated_quick_notes_conn(&db_path, &legacy_path)?;
    read_quick_notes_from_conn(&conn)
}

fn write_quick_notes_unlocked(app: &AppHandle, notes: &[QuickNote]) -> Result<(), String> {
    let db_path = crate::local_db::workspace_db_path(app)?;
    let legacy_path = quick_notes_legacy_path(app)?;
    let mut conn = open_migrated_quick_notes_conn(&db_path, &legacy_path)?;
    write_quick_notes_in_conn(&mut conn, notes)
}

fn quick_notes_state(app: &AppHandle) -> Result<QuickNotesState, String> {
    with_quick_notes_store_lock(app, || {
        Ok(QuickNotesState {
            notes: read_quick_notes_unlocked(app)?,
        })
    })
}

pub(crate) fn existing_quick_note_titles(
    app: &AppHandle,
) -> Result<std::collections::HashMap<String, String>, String> {
    with_quick_notes_store_lock(app, || {
        let notes = read_quick_notes_unlocked(app)?;
        Ok(notes
            .into_iter()
            .map(|note| (note.id, note.title))
            .collect())
    })
}

fn emit_quick_notes_updated(app: &AppHandle, state: &QuickNotesState) {
    let _ = app.emit("quick-notes-updated", state);
}

pub(crate) fn refresh_and_emit_active_quick_notes_state(app: &AppHandle) -> Result<(), String> {
    let state = quick_notes_state(app)?;
    emit_quick_notes_updated(app, &state);
    Ok(())
}

#[tauri::command]
pub async fn quick_notes_read_state(app: AppHandle) -> Result<QuickNotesState, String> {
    tauri::async_runtime::spawn_blocking(move || quick_notes_state(&app))
        .await
        .map_err(|err| format!("quick notes read task failed: {err}"))?
}

pub(crate) fn create_quick_note_sync(
    app: &AppHandle,
    payload: CreateQuickNotePayload,
) -> Result<(QuickNotesState, String), String> {
    let mut created_id_out = String::new();
    let next_state = with_quick_notes_store_lock(app, || {
        let mut notes = read_quick_notes_unlocked(app)?;
        let content = payload.content.unwrap_or_default();
        let now = crate::timestamp_string();

        let created_note = QuickNote {
            id: create_quick_note_id(),
            title: safe_quick_note_title(
                payload.title.as_deref().unwrap_or(""),
                &content,
                QUICK_NOTE_FALLBACK_TITLE,
            ),
            content,
            pinned: payload.pinned.unwrap_or(false),
            favorite: payload.favorite.unwrap_or(false),
            created_at: now.clone(),
            updated_at: now,
        };
        created_id_out = created_note.id.clone();
        let created_payload = serde_json::to_value(&created_note).unwrap_or_default();
        notes.insert(0, created_note);

        sort_quick_notes(&mut notes);
        write_quick_notes_unlocked(app, &notes)?;
        crate::sync::enqueue_outbox_event(
            app,
            crate::sync::OutboxEntityKind::QuickNote,
            &created_id_out,
            crate::sync::OutboxOperation::Upsert,
            created_payload,
        )?;
        Ok(QuickNotesState { notes })
    })?;
    emit_quick_notes_updated(app, &next_state);
    Ok((next_state, created_id_out))
}

pub(crate) fn create_blank_sticky_note(app: &AppHandle) -> Result<String, String> {
    let (_, note_id) = create_quick_note_sync(
        app,
        CreateQuickNotePayload {
            title: Some("新建便签".to_string()),
            content: Some(String::new()),
            pinned: Some(false),
            favorite: Some(false),
        },
    )?;
    Ok(note_id)
}

#[tauri::command]
pub async fn quick_notes_create_note(
    app: AppHandle,
    payload: CreateQuickNotePayload,
) -> Result<QuickNotesState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (next_state, _) = create_quick_note_sync(&app, payload)?;
        Ok(next_state)
    })
    .await
    .map_err(|err| format!("quick notes create task failed: {err}"))?
}

#[tauri::command]
pub async fn quick_notes_update_note(
    app: AppHandle,
    payload: UpdateQuickNotePayload,
) -> Result<QuickNotesState, String> {
    if payload.id.trim().is_empty() {
        return Err("Missing quick note id".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let next_state = with_quick_notes_store_lock(&app, || {
            let mut notes = read_quick_notes_unlocked(&app)?;
            let note = notes
                .iter_mut()
                .find(|note| note.id == payload.id)
                .ok_or_else(|| "Quick note not found".to_string())?;

            if let Some(content) = payload.content {
                note.content = content;
            }
            if let Some(title) = payload.title {
                note.title =
                    safe_quick_note_title(&title, &note.content, QUICK_NOTE_FALLBACK_TITLE);
            }
            if let Some(pinned) = payload.pinned {
                note.pinned = pinned;
            }
            if let Some(favorite) = payload.favorite {
                note.favorite = favorite;
            }

            note.updated_at = crate::timestamp_string();
            let updated_id = note.id.clone();
            let updated_payload = serde_json::to_value(&*note).unwrap_or_default();
            sort_quick_notes(&mut notes);
            write_quick_notes_unlocked(&app, &notes)?;
            crate::sync::enqueue_outbox_event(
                &app,
                crate::sync::OutboxEntityKind::QuickNote,
                &updated_id,
                crate::sync::OutboxOperation::Upsert,
                updated_payload,
            )?;
            Ok(QuickNotesState { notes })
        })?;
        emit_quick_notes_updated(&app, &next_state);
        Ok(next_state)
    })
    .await
    .map_err(|err| format!("quick notes update task failed: {err}"))?
}

#[tauri::command]
pub async fn quick_notes_delete_note(
    app: AppHandle,
    note_id: String,
) -> Result<QuickNotesState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let removed_id = note_id.clone();
        let next_state = with_quick_notes_store_lock(&app, || {
            let mut notes = read_quick_notes_unlocked(&app)?;
            notes.retain(|note| note.id != note_id);
            write_quick_notes_unlocked(&app, &notes)?;
            crate::sync::enqueue_outbox_event(
                &app,
                crate::sync::OutboxEntityKind::QuickNote,
                &note_id,
                crate::sync::OutboxOperation::Delete,
                serde_json::json!({ "id": note_id }),
            )?;
            Ok(QuickNotesState { notes })
        })?;
        crate::sticky_notes::handle_quick_notes_deleted(&app, &[removed_id]);
        emit_quick_notes_updated(&app, &next_state);
        Ok(next_state)
    })
    .await
    .map_err(|err| format!("quick notes delete task failed: {err}"))?
}

/// Apply remote QuickNote upserts and deletions pulled from the cloud sync server.
pub(crate) fn apply_pulled_quick_notes(
    app: &AppHandle,
    upserts: &[serde_json::Value],
    removed_ids: &[String],
) -> Result<(), String> {
    if upserts.is_empty() && removed_ids.is_empty() {
        return Ok(());
    }
    let next_state = with_quick_notes_store_lock(app, || {
        let mut notes = read_quick_notes_unlocked(app)?;
        for rid in removed_ids {
            notes.retain(|note| &note.id != rid);
        }
        for raw in upserts {
            let Ok(remote) = serde_json::from_value::<QuickNote>(raw.clone()) else {
                continue;
            };
            if let Some(existing) = notes.iter_mut().find(|n| n.id == remote.id) {
                if remote.updated_at >= existing.updated_at {
                    *existing = remote;
                }
            } else {
                notes.push(remote);
            }
        }
        sort_quick_notes(&mut notes);
        write_quick_notes_unlocked(app, &notes)?;
        Ok(QuickNotesState { notes })
    })?;
    if !removed_ids.is_empty() {
        crate::sticky_notes::handle_quick_notes_deleted(app, removed_ids);
    }
    emit_quick_notes_updated(app, &next_state);
    Ok(())
}

fn read_local_quick_notes_snapshot(app: &AppHandle) -> Result<Vec<QuickNote>, String> {
    let local_db = crate::local_db::local_workspace_db_path(app)?;
    if local_db.is_file() {
        let conn = crate::local_db::open_workspace_db_at(&local_db)?;
        return read_quick_notes_from_conn(&conn);
    }
    let legacy_path = crate::paths::legacy_local_storage_root(app)?.join(QUICK_NOTES_FILE_NAME);
    if !legacy_path.is_file() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&legacy_path)
        .map_err(|err| format!("failed to read local quick notes: {err}"))?;
    match serde_json::from_str::<StoredQuickNotesFile>(&raw) {
        Ok(parsed) => {
            let mut notes: Vec<QuickNote> = parsed
                .notes
                .into_iter()
                .filter_map(normalize_quick_note)
                .collect();
            sort_quick_notes(&mut notes);
            Ok(notes)
        }
        Err(_) => Ok(Vec::new()),
    }
}

/// Non-destructively copy quick notes from the pure local store into the active account workspace.
pub(crate) fn import_local_quick_notes_into_active_scope(app: &AppHandle) -> Result<usize, String> {
    if crate::accounts::account_sync_root(app)?.is_none() {
        return Ok(0);
    }
    let local_notes = read_local_quick_notes_snapshot(app)?;
    if local_notes.is_empty() {
        return Ok(0);
    }

    let imported = with_quick_notes_store_lock(app, || {
        let mut current = read_quick_notes_unlocked(app)?;
        let existing_ids: std::collections::HashSet<String> =
            current.iter().map(|n| n.id.clone()).collect();
        let mut added = Vec::new();
        for note in local_notes {
            if !existing_ids.contains(&note.id) {
                added.push(note.clone());
                current.push(note);
            }
        }
        if added.is_empty() {
            return Ok(0);
        }
        sort_quick_notes(&mut current);
        write_quick_notes_unlocked(app, &current)?;

        let mut batch = Vec::with_capacity(added.len());
        for note in &added {
            let payload =
                serde_json::to_value(note).map_err(|err| format!("序列化导入速记失败: {err}"))?;
            batch.push(crate::sync::OutboxBatchItem {
                entity_kind: crate::sync::OutboxEntityKind::QuickNote,
                entity_id: note.id.clone(),
                operation: crate::sync::OutboxOperation::Upsert,
                payload,
            });
        }
        crate::sync::enqueue_outbox_batch(app, batch)?;
        Ok(added.len())
    })?;

    if imported > 0 {
        let _ = refresh_and_emit_active_quick_notes_state(app);
    }
    Ok(imported)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_notes_contract_preserves_normalization_and_sort_precedence() {
        let missing_id = normalize_quick_note(RawQuickNote {
            id: Some("   ".to_string()),
            title: Some("skip".to_string()),
            content: None,
            pinned: None,
            favorite: None,
            created_at: None,
            updated_at: None,
        });
        assert!(missing_id.is_none());

        let derived_title = normalize_quick_note(RawQuickNote {
            id: Some("n1".to_string()),
            title: Some("   ".to_string()),
            content: Some("\n   第一行核心速记   \n第二行正文".to_string()),
            pinned: None,
            favorite: Some(true),
            created_at: Some("100".to_string()),
            updated_at: Some("200".to_string()),
        })
        .unwrap();
        assert_eq!(derived_title.title, "第一行核心速记");
        assert!(!derived_title.pinned);
        assert!(derived_title.favorite);

        let fallback_title = normalize_quick_note(RawQuickNote {
            id: Some("n2".to_string()),
            title: None,
            content: Some("   ".to_string()),
            pinned: Some(true),
            favorite: Some(false),
            created_at: Some("50".to_string()),
            updated_at: Some("50".to_string()),
        })
        .unwrap();
        assert_eq!(fallback_title.title, QUICK_NOTE_FALLBACK_TITLE);

        let newer_plain = normalize_quick_note(RawQuickNote {
            id: Some("n3".to_string()),
            title: Some("普通最新".to_string()),
            content: Some("body".to_string()),
            pinned: Some(false),
            favorite: Some(false),
            created_at: Some("999".to_string()),
            updated_at: Some("999".to_string()),
        })
        .unwrap();

        let mut list = vec![newer_plain, derived_title, fallback_title];
        sort_quick_notes(&mut list);
        // Precedence: pinned > favorite > updated_at descending
        assert_eq!(list[0].id, "n2");
        assert_eq!(list[1].id, "n1");
        assert_eq!(list[2].id, "n3");
    }

    #[test]
    fn quick_notes_sqlite_migrates_legacy_json_and_preserves_backup() {
        let root =
            std::env::temp_dir().join(format!("tidydesk-quicknotes-sql-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();

        let legacy_path = root.join("quick-notes.json");
        fs::write(
            &legacy_path,
            r#"{"version":2,"notes":[{"id":"qn1","title":"旧速记","content":"body","pinned":true,"favorite":false,"createdAt":"10","updatedAt":"20"}]}"#,
        )
        .unwrap();

        let db_path = root.join("tidydesk-local.db");
        let mut conn = open_migrated_quick_notes_conn(&db_path, &legacy_path).unwrap();
        assert!(!legacy_path.exists());
        assert!(root.join("quick-notes.json.pre-sqlite.bak").is_file());

        let mut loaded = read_quick_notes_from_conn(&conn).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].title, "旧速记");
        assert!(loaded[0].pinned);

        loaded.push(QuickNote {
            id: "qn2".to_string(),
            title: "新SQLite速记".to_string(),
            content: "new".to_string(),
            pinned: false,
            favorite: true,
            created_at: "30".to_string(),
            updated_at: "40".to_string(),
        });
        write_quick_notes_in_conn(&mut conn, &loaded).unwrap();
        let reloaded = read_quick_notes_from_conn(&conn).unwrap();
        assert_eq!(reloaded.len(), 2);
        assert_eq!(reloaded[0].id, "qn1");
        assert_eq!(reloaded[1].id, "qn2");

        drop(conn);
        let _ = fs::remove_dir_all(&root);
    }
}
