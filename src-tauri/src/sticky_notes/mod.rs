mod model;
mod store;
mod window;

pub use store::{sticky_notes_path, with_sticky_notes_store_lock, StickyNotesStoreState};
pub use window::{
    handle_quick_notes_deleted, mark_app_exiting, open_sticky_note_sync,
    reload_sticky_notes_for_active_account, schedule_restore_sticky_notes, sticky_notes_list,
    sticky_notes_open, sticky_notes_unpin, sticky_notes_update_options, StickyRuntimeState,
};
