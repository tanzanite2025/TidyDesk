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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoredOutboxFile {
    #[serde(default = "default_outbox_version")]
    version: u8,
    #[serde(default)]
    entries: Vec<OutboxEntry>,
}

fn default_outbox_version() -> u8 {
    1
}

fn outbox_file_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let Some(root) = crate::accounts::account_sync_root(app)? else {
        return Ok(None);
    };
    Ok(Some(root.join(SYNC_OUTBOX_FILE)))
}

fn read_outbox_unlocked(path: &Path) -> Result<Vec<OutboxEntry>, String> {
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

fn write_outbox_unlocked(path: &Path, entries: &[OutboxEntry]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create sync outbox dir: {err}"))?;
    }
    let payload = StoredOutboxFile {
        version: 1,
        entries: entries.to_vec(),
    };
    crate::persistence::atomic_write_json_fast(path, &payload, "sync outbox")
}

/// Coalesce a new mutation entry into the per-account outbox by `(entity_kind, entity_id)`,
/// failing loudly if adding a brand-new entity would exceed capacity instead of dropping data.
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

/// Enqueue multiple outbox items in a single atomic file write (no-op in pure local workspaces).
pub fn enqueue_outbox_batch(app: &AppHandle, items: Vec<OutboxBatchItem>) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }
    let Some(path) = outbox_file_path(app)? else {
        return Ok(());
    };
    let actor_id = crate::accounts::current_actor_id(app);
    let now = crate::timestamp_string();
    let state = app.state::<SyncOutboxState>();
    let _guard = state
        .0
        .lock()
        .map_err(|_| "failed to lock sync outbox state".to_string())?;

    let mut entries = read_outbox_unlocked(&path)?;
    for item in items {
        coalesce_outbox_entries(
            &mut entries,
            OutboxEntry {
                entity_kind: item.entity_kind,
                entity_id: item.entity_id,
                operation: item.operation,
                payload: item.payload,
                actor_id: actor_id.clone(),
                updated_at: now.clone(),
            },
        )?;
    }
    write_outbox_unlocked(&path, &entries)?;
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
    let Some(path) = outbox_file_path(app)? else {
        return Ok(Vec::new());
    };
    let state = app.state::<SyncOutboxState>();
    let _guard = state
        .0
        .lock()
        .map_err(|_| "failed to lock sync outbox state".to_string())?;
    read_outbox_unlocked(&path)
}

pub fn clear_outbox_entries(app: &AppHandle) -> Result<(), String> {
    let Some(path) = outbox_file_path(app)? else {
        return Ok(());
    };
    let state = app.state::<SyncOutboxState>();
    let _guard = state
        .0
        .lock()
        .map_err(|_| "failed to lock sync outbox state".to_string())?;
    write_outbox_unlocked(&path, &[])
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
    let Some(path) = outbox_file_path(app)? else {
        return Ok(0);
    };
    let state = app.state::<SyncOutboxState>();
    let _guard = state
        .0
        .lock()
        .map_err(|_| "failed to lock sync outbox state".to_string())?;
    let mut entries = read_outbox_unlocked(&path)?;
    entries.retain(|entry| {
        !acked_keys.iter().any(|(kind, id, sent_at)| {
            &entry.entity_kind == kind && &entry.entity_id == id && &entry.updated_at == sent_at
        })
    });
    let remaining = entries.len();
    write_outbox_unlocked(&path, &entries)?;
    Ok(remaining)
}

pub fn has_pending_outbox_for_workspace(
    app: &AppHandle,
    user_id: &str,
    workspace_id: &str,
) -> Result<bool, String> {
    let dir = crate::accounts::session::workspace_data_dir(app, user_id, workspace_id)?;
    let path = dir.join(SYNC_OUTBOX_FILE);
    let state = app.state::<SyncOutboxState>();
    let _guard = state
        .0
        .lock()
        .map_err(|_| "failed to lock sync outbox state".to_string())?;
    Ok(!read_outbox_unlocked(&path)?.is_empty())
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
}
