pub mod monitor;
pub mod screen_gdi;
pub mod snip;

pub use monitor::{snip_open_monitor, MonitorSnapshot};
pub use snip::{
    clear_pending_sticker_cache, handle_snip_window_aborted, is_snip_capture_in_flight,
    open_snip_window, open_snip_window_for_todo_card, paste_pending_sticker, snip_cancel,
    snip_complete_selection, snip_get_background_image, SnipCaptureState,
};

pub const SNIP_WINDOW_LABEL: &str = "snip";
pub const SNIP_RESET_EVENT: &str = "snip-reset";
