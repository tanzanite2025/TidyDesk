pub mod commands;
#[cfg(test)]
mod e2e_server_test;
pub mod engine;
pub mod http_transport;
pub mod merge;
pub mod outbox;
pub mod realtime;

pub use commands::{
    sync_clear_outbox, sync_get_status, sync_list_outbox, sync_run_once, sync_set_realtime_enabled,
};
pub use engine::try_lazy_fetch_todo_attachment;
pub use outbox::{
    enqueue_outbox_batch, enqueue_outbox_event, OutboxBatchItem, OutboxEntityKind, OutboxOperation,
    SyncOutboxState,
};
pub use realtime::{stop_realtime_sync, SyncRealtimeState};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusSnapshot {
    pub auth_mode: String,
    pub active_user_id: Option<String>,
    pub sync_enabled: bool,
    pub server_endpoint: Option<String>,
    pub pending_count: usize,
    pub last_sync_cursor: Option<String>,
    pub last_sync_at: Option<String>,
    pub realtime_active: bool,
    pub status_message: String,
}
