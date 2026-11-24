pub mod commands;
mod config;
mod scheduler;
mod snapshot;

pub use commands::{
    updates_cancel_download, updates_check, updates_download, updates_get_metadata,
    updates_get_state, updates_install, UpdaterSessionState,
};
pub use scheduler::start_update_auto_check;

pub(super) const UPDATE_EVENT_NAME: &str = "updates-state";
