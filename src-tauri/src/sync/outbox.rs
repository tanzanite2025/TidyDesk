use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const SYNC_OUTBOX_FILE: &str = "sync-outbox.json";
const MAX_OUTBOX_ENTRIES: usize = 2000;

#[derive(Debug, Default)]
pub struct SyncOutboxState(Mutex<()>);

pub(crate) fn with_outbox_lock<T>(
    app: &AppHandle,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<SyncOutboxState>();
    let _guard = state
        .0
        .lock()
        .map_err(|_| "failed to lock sync outbox state".to_string())?;
    operation()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OutboxEntityKind {
    Card,
    CardComment,
    Attachment,
    QuickNote,
    Board,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OutboxOperation {
    Upsert,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxEntry {
    pub entity_kind: OutboxEntityKind,
    pub entity_id: String,
    pub operation: OutboxOperation,
    pub payload: Value,
    pub actor_id: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct OutboxBatchItem {
    pub entity_kind: OutboxEntityKind,
    pub entity_id: String,
    pub operation: OutboxOperation,
    pub payload: Value,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoredOutboxFile {
    #[serde(default)]
    entries: Vec<OutboxEntry>,
}

fn outbox_kind_key(kind: &OutboxEntityKind) -> &'static str {
    match kind {
        OutboxEntityKind::Card => "card",
        OutboxEntityKind::CardComment => "cardComment",
        OutboxEntityKind::Attachment => "attachment",
        OutboxEntityKind::QuickNote => "quickNote",
        OutboxEntityKind::Board => "board",
    }
}

fn parse_outbox_kind(raw: &str) -> Result<OutboxEntityKind, String> {
    match raw {
        "card" => Ok(OutboxEntityKind::Card),
        "cardComment" => Ok(OutboxEntityKind::CardComment),
        "attachment" => Ok(OutboxEntityKind::Attachment),
        "quickNote" => Ok(OutboxEntityKind::QuickNote),
        "board" => Ok(OutboxEntityKind::Board),
        other => Err(format!("未知 sync_outbox entity_kind: {other}")),
    }
}

fn outbox_op_key(op: &OutboxOperation) -> &'static str {
    match op {
        OutboxOperation::Upsert => "upsert",
        OutboxOperation::Delete => "delete",
    }
}

fn parse_outbox_op(raw: &str) -> Result<OutboxOperation, String> {
    match raw {
        "upsert" => Ok(OutboxOperation::Upsert),
        "delete" => Ok(OutboxOperation::Delete),
        other => Err(format!("未知 sync_outbox operation: {other}")),
    }
}

fn outbox_db_and_legacy_paths(app: &AppHandle) -> Result<Option<(PathBuf, PathBuf)>, String> {
    let Some(root) = crate::accounts::account_sync_root(app)? else {
        return Ok(None);
    };
    let db_path = crate::local_db::workspace_db_path(app)?;
    Ok(Some((db_path, root.join(SYNC_OUTBOX_FILE))))
}

pub(crate) fn outbox_backup_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    Ok(crate::accounts::account_sync_root(app)?.map(|root| root.join(SYNC_OUTBOX_FILE)))
}

fn read_legacy_outbox_json(path: &Path) -> Result<Vec<OutboxEntry>, String> {
    match fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<StoredOutboxFile>(&raw) {
            Ok(parsed) => Ok(parsed.entries),
            Err(_) => {
                crate::persistence::backup_corrupt_file(path, "sync outbox")?;
                Ok(Vec::new())
            }
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(err) => Err(format!("failed to read sync outbox: {err}")),
    }
}

pub(crate) fn migrate_outbox_json_if_needed(
    conn: &mut Connection,
    legacy_path: &Path,
) -> Result<(), String> {
    if crate::local_db::get_meta_flag(conn, "migrated_outbox")?.is_some() {
        return Ok(());
    }
    if !legacy_path.is_file() {
        crate::local_db::set_meta_flag(conn, "migrated_outbox", "none")?;
        return Ok(());
    }

    let entries = read_legacy_outbox_json(legacy_path)?;
    {
        let tx = conn
            .transaction()
            .map_err(|err| format!("开启 sync_outbox 迁移事务失败: {err}"))?;
        let existing_count: i64 = tx
            .query_row("SELECT COUNT(*) FROM sync_outbox", [], |r| r.get(0))
            .map_err(|err| format!("统计 sync_outbox 行数失败: {err}"))?;
        if existing_count == 0 {
            for (idx, entry) in entries.iter().enumerate() {
                let payload_json = serde_json::to_string(&entry.payload)
                    .map_err(|err| format!("序列化 outbox payload 失败: {err}"))?;
                let seq = i64::try_from(idx + 1).unwrap_or(i64::MAX);
                tx.execute(
                    "INSERT OR REPLACE INTO sync_outbox
                     (entity_kind, entity_id, operation, payload_json, actor_id, updated_at, seq)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![
                        outbox_kind_key(&entry.entity_kind),
                        entry.entity_id,
                        outbox_op_key(&entry.operation),
                        payload_json,
                        entry.actor_id,
                        entry.updated_at,
                        seq
                    ],
                )
                .map_err(|err| format!("迁移写入 sync_outbox 失败: {err}"))?;
            }
        }
        tx.execute(
            "INSERT OR REPLACE INTO db_meta (key, value) VALUES ('migrated_outbox', ?1)",
            [crate::timestamp_string()],
        )
        .map_err(|err| format!("写入 migrated_outbox 标记失败: {err}"))?;
        tx.commit()
            .map_err(|err| format!("提交 sync_outbox 迁移事务失败: {err}"))?;
    }

    crate::local_db::archive_legacy_file_once(legacy_path)?;
    Ok(())
}

fn open_migrated_outbox_conn(db_path: &Path, legacy_path: &Path) -> Result<Connection, String> {
    let mut conn = crate::local_db::open_workspace_db_at(db_path)?;
    migrate_outbox_json_if_needed(&mut conn, legacy_path)?;
    Ok(conn)
}

fn read_outbox_from_conn(conn: &Connection) -> Result<Vec<OutboxEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT entity_kind, entity_id, operation, payload_json, actor_id, updated_at
             FROM sync_outbox
             ORDER BY seq ASC",
        )
        .map_err(|err| format!("查询 sync_outbox 失败: {err}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|err| format!("读取 sync_outbox 行失败: {err}"))?;

    let mut out = Vec::new();
    for item in rows {
        let (kind_raw, entity_id, op_raw, payload_raw, actor_id, updated_at) =
            item.map_err(|err| format!("解析 sync_outbox 行失败: {err}"))?;
        let payload: Value = serde_json::from_str(&payload_raw)
            .map_err(|err| format!("反序列化 outbox payload 失败: {err}"))?;
        out.push(OutboxEntry {
            entity_kind: parse_outbox_kind(&kind_raw)?,
            entity_id,
            operation: parse_outbox_op(&op_raw)?,
            payload,
            actor_id,
            updated_at,
        });
    }
    Ok(out)
}

fn enqueue_outbox_batch_in_conn(
    conn: &mut Connection,
    actor_id: &str,
    updated_at: &str,
    items: &[OutboxBatchItem],
) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|err| format!("开启 sync_outbox 写入事务失败: {err}"))?;
    let mut current_count: usize = usize::try_from(
        tx.query_row("SELECT COUNT(*) FROM sync_outbox", [], |r| {
            r.get::<_, i64>(0)
        })
        .map_err(|err| format!("统计 sync_outbox 数量失败: {err}"))?
        .max(0),
    )
    .unwrap_or(0);
    let mut next_seq: i64 = tx
        .query_row("SELECT COALESCE(MAX(seq), 0) FROM sync_outbox", [], |r| {
            r.get(0)
        })
        .map_err(|err| format!("查询 sync_outbox 最大序号失败: {err}"))?;

    for item in items {
        let kind_str = outbox_kind_key(&item.entity_kind);
        let op_str = outbox_op_key(&item.operation);
        let payload_json = serde_json::to_string(&item.payload)
            .map_err(|err| format!("序列化 outbox payload 失败: {err}"))?;

        let existing_seq: Option<i64> = match tx.query_row(
            "SELECT seq FROM sync_outbox WHERE entity_kind = ?1 AND entity_id = ?2",
            rusqlite::params![kind_str, item.entity_id],
            |r| r.get(0),
        ) {
            Ok(seq) => Some(seq),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(err) => return Err(format!("检查 sync_outbox 重复项失败: {err}")),
        };

        if existing_seq.is_some() {
            tx.execute(
                "UPDATE sync_outbox
                 SET operation = ?1, payload_json = ?2, actor_id = ?3, updated_at = ?4
                 WHERE entity_kind = ?5 AND entity_id = ?6",
                rusqlite::params![
                    op_str,
                    payload_json,
                    actor_id,
                    updated_at,
                    kind_str,
                    item.entity_id
                ],
            )
            .map_err(|err| format!("合并更新 sync_outbox 失败: {err}"))?;
        } else {
            if current_count >= MAX_OUTBOX_ENTRIES {
                return Err(format!(
                    "本地待同步队列已满（上限 {MAX_OUTBOX_ENTRIES} 条），请先连接同步服务推送或手动清理队列"
                ));
            }
            next_seq += 1;
            current_count += 1;
            tx.execute(
                "INSERT INTO sync_outbox
                 (entity_kind, entity_id, operation, payload_json, actor_id, updated_at, seq)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    kind_str,
                    item.entity_id,
                    op_str,
                    payload_json,
                    actor_id,
                    updated_at,
                    next_seq
                ],
            )
            .map_err(|err| format!("插入 sync_outbox 失败: {err}"))?;
        }
    }

    tx.commit()
        .map_err(|err| format!("提交 sync_outbox 写入事务失败: {err}"))?;
    Ok(())
}

/// Coalesce a new mutation entry into the per-account outbox by `(entity_kind, entity_id)`,
/// failing loudly if adding a brand-new entity would exceed capacity instead of dropping data.
#[cfg(test)]
pub fn coalesce_outbox_entries(
    entries: &mut Vec<OutboxEntry>,
    next: OutboxEntry,
) -> Result<(), String> {
    if let Some(existing) = entries
        .iter_mut()
        .find(|item| item.entity_kind == next.entity_kind && item.entity_id == next.entity_id)
    {
        *existing = next;
        return Ok(());
    }
    if entries.len() >= MAX_OUTBOX_ENTRIES {
        return Err(format!(
            "本地待同步队列已满（上限 {MAX_OUTBOX_ENTRIES} 条），请先连接同步服务推送或手动清理队列"
        ));
    }
    entries.push(next);
    Ok(())
}

/// Enqueue multiple outbox items in a single SQLite transaction (no-op in pure local workspaces).
pub fn enqueue_outbox_batch(app: &AppHandle, items: Vec<OutboxBatchItem>) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }
    let Some((db_path, legacy_path)) = outbox_db_and_legacy_paths(app)? else {
        return Ok(());
    };
    let actor_id = crate::accounts::current_actor_id(app);
    let now = crate::timestamp_string();
    let state = app.state::<SyncOutboxState>();
    let _guard = state
        .0
        .lock()
        .map_err(|_| "failed to lock sync outbox state".to_string())?;

    let mut conn = open_migrated_outbox_conn(&db_path, &legacy_path)?;
    enqueue_outbox_batch_in_conn(&mut conn, &actor_id, &now, &items)?;
    drop(_guard);
    crate::sync::realtime::schedule_realtime_push_if_active(app);
    Ok(())
}

pub fn enqueue_outbox_event(
    app: &AppHandle,
    entity_kind: OutboxEntityKind,
    entity_id: &str,
    operation: OutboxOperation,
    payload: Value,
) -> Result<(), String> {
    enqueue_outbox_batch(
        app,
        vec![OutboxBatchItem {
            entity_kind,
            entity_id: entity_id.to_string(),
            operation,
            payload,
        }],
    )
}

pub fn read_outbox_entries(app: &AppHandle) -> Result<Vec<OutboxEntry>, String> {
    let Some((db_path, legacy_path)) = outbox_db_and_legacy_paths(app)? else {
        return Ok(Vec::new());
    };
    let state = app.state::<SyncOutboxState>();
    let _guard = state
        .0
        .lock()
        .map_err(|_| "failed to lock sync outbox state".to_string())?;
    let conn = open_migrated_outbox_conn(&db_path, &legacy_path)?;
    read_outbox_from_conn(&conn)
}

pub fn clear_outbox_entries(app: &AppHandle) -> Result<(), String> {
    let Some((db_path, legacy_path)) = outbox_db_and_legacy_paths(app)? else {
        return Ok(());
    };
    let state = app.state::<SyncOutboxState>();
    let _guard = state
        .0
        .lock()
        .map_err(|_| "failed to lock sync outbox state".to_string())?;
    let conn = open_migrated_outbox_conn(&db_path, &legacy_path)?;
    conn.execute("DELETE FROM sync_outbox", [])
        .map_err(|err| format!("清空 sync_outbox 失败: {err}"))?;
    Ok(())
}

/// Remove acknowledged outbox entries only when their `updated_at` matches what was sent,
/// so concurrent local edits performed while HTTP was in flight are safely preserved.
pub fn remove_acked_outbox_entries(
    app: &AppHandle,
    acked_keys: &[(OutboxEntityKind, String, String)],
) -> Result<usize, String> {
    if acked_keys.is_empty() {
        return Ok(read_outbox_entries(app)?.len());
    }
    let Some((db_path, legacy_path)) = outbox_db_and_legacy_paths(app)? else {
        return Ok(0);
    };
    let state = app.state::<SyncOutboxState>();
    let _guard = state
        .0
        .lock()
        .map_err(|_| "failed to lock sync outbox state".to_string())?;
    let mut conn = open_migrated_outbox_conn(&db_path, &legacy_path)?;
    let tx = conn
        .transaction()
        .map_err(|err| format!("开启 sync_outbox 确认清理事务失败: {err}"))?;
    for (kind, id, sent_at) in acked_keys {
        tx.execute(
            "DELETE FROM sync_outbox WHERE entity_kind = ?1 AND entity_id = ?2 AND updated_at = ?3",
            rusqlite::params![outbox_kind_key(kind), id, sent_at],
        )
        .map_err(|err| format!("清理已确认 sync_outbox 项失败: {err}"))?;
    }
    let remaining: usize = usize::try_from(
        tx.query_row("SELECT COUNT(*) FROM sync_outbox", [], |r| {
            r.get::<_, i64>(0)
        })
        .map_err(|err| format!("统计剩余 sync_outbox 数量失败: {err}"))?
        .max(0),
    )
    .unwrap_or(0);
    tx.commit()
        .map_err(|err| format!("提交 sync_outbox 清理事务失败: {err}"))?;
    Ok(remaining)
}

pub fn has_pending_outbox_for_workspace(
    app: &AppHandle,
    user_id: &str,
    workspace_id: &str,
) -> Result<bool, String> {
    let dir = crate::accounts::session::workspace_data_dir(app, user_id, workspace_id)?;
    let legacy_path = dir.join(SYNC_OUTBOX_FILE);
    let db_path = crate::local_db::workspace_db_path_for(app, user_id, workspace_id)?;
    let state = app.state::<SyncOutboxState>();
    let _guard = state
        .0
        .lock()
        .map_err(|_| "failed to lock sync outbox state".to_string())?;
    if !db_path.exists() && !legacy_path.exists() {
        return Ok(false);
    }
    let conn = open_migrated_outbox_conn(&db_path, &legacy_path)?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM sync_outbox", [], |r| r.get(0))
        .map_err(|err| format!("检查待上传队列失败: {err}"))?;
    Ok(count > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn coalesce_outbox_entries_deduplicates_same_entity() {
        let mut entries = Vec::new();
        coalesce_outbox_entries(
            &mut entries,
            OutboxEntry {
                entity_kind: OutboxEntityKind::Card,
                entity_id: "card-1".to_string(),
                operation: OutboxOperation::Upsert,
                payload: json!({ "revision": 1 }),
                actor_id: "u1".to_string(),
                updated_at: "100".to_string(),
            },
        )
        .unwrap();
        coalesce_outbox_entries(
            &mut entries,
            OutboxEntry {
                entity_kind: OutboxEntityKind::Card,
                entity_id: "card-1".to_string(),
                operation: OutboxOperation::Delete,
                payload: json!({ "revision": 2 }),
                actor_id: "u1".to_string(),
                updated_at: "200".to_string(),
            },
        )
        .unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].operation, OutboxOperation::Delete);
        assert_eq!(entries[0].payload["revision"], json!(2));
    }

    #[test]
    fn coalesce_outbox_entries_fails_loudly_when_capacity_exceeded() {
        let mut entries: Vec<OutboxEntry> = (0..MAX_OUTBOX_ENTRIES)
            .map(|i| OutboxEntry {
                entity_kind: OutboxEntityKind::Card,
                entity_id: format!("card-{i}"),
                operation: OutboxOperation::Upsert,
                payload: json!({ "revision": 1 }),
                actor_id: "u1".to_string(),
                updated_at: "100".to_string(),
            })
            .collect();

        // Coalescing existing item still succeeds even when full
        coalesce_outbox_entries(
            &mut entries,
            OutboxEntry {
                entity_kind: OutboxEntityKind::Card,
                entity_id: "card-0".to_string(),
                operation: OutboxOperation::Upsert,
                payload: json!({ "revision": 2 }),
                actor_id: "u1".to_string(),
                updated_at: "101".to_string(),
            },
        )
        .unwrap();
        assert_eq!(entries[0].payload["revision"], json!(2));

        // Adding a new distinct entity must fail loudly instead of dropping head
        let err = coalesce_outbox_entries(
            &mut entries,
            OutboxEntry {
                entity_kind: OutboxEntityKind::Attachment,
                entity_id: "att-overflow".to_string(),
                operation: OutboxOperation::Upsert,
                payload: json!({}),
                actor_id: "u1".to_string(),
                updated_at: "102".to_string(),
            },
        )
        .unwrap_err();
        assert!(err.contains("已满（上限"));
        assert_eq!(entries.len(), MAX_OUTBOX_ENTRIES);
    }

    #[test]
    fn sqlite_outbox_migrates_legacy_json_coalesces_and_enforces_capacity() {
        let dir = std::env::temp_dir().join(format!("tidydesk-outbox-sql-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let legacy_path = dir.join("sync-outbox.json");
        fs::write(
            &legacy_path,
            r#"{"version":1,"entries":[{"entityKind":"card","entityId":"c1","operation":"upsert","payload":{"title":"旧队列"},"actorId":"alice","updatedAt":"10"}]}"#,
        )
        .unwrap();

        let db_path = dir.join("tidydesk-workspace.db");
        let mut conn = open_migrated_outbox_conn(&db_path, &legacy_path).unwrap();
        assert!(!legacy_path.exists());
        assert!(dir.join("sync-outbox.json.pre-sqlite.bak").is_file());

        enqueue_outbox_batch_in_conn(
            &mut conn,
            "alice",
            "20",
            &[
                OutboxBatchItem {
                    entity_kind: OutboxEntityKind::Card,
                    entity_id: "c1".to_string(),
                    operation: OutboxOperation::Upsert,
                    payload: json!({ "title": "合并后" }),
                },
                OutboxBatchItem {
                    entity_kind: OutboxEntityKind::QuickNote,
                    entity_id: "n1".to_string(),
                    operation: OutboxOperation::Delete,
                    payload: json!({ "id": "n1" }),
                },
            ],
        )
        .unwrap();

        let rows = read_outbox_from_conn(&conn).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].entity_id, "c1");
        assert_eq!(rows[0].payload["title"], json!("合并后"));
        assert_eq!(rows[1].entity_id, "n1");
        assert_eq!(rows[1].operation, OutboxOperation::Delete);

        drop(conn);
        let _ = fs::remove_dir_all(&dir);
    }
}
