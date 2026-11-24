mod bounds;
mod lifecycle;
mod state;

pub use bounds::{
    apply_window_bounds, available_work_areas, capture_window_bounds,
    clamp_physical_bounds_to_monitors, default_cascade_bounds_for_monitor, drawer_window_bounds,
    ensure_window_in_available_monitors, handle_window_bounds, is_valid_runtime_window_bounds,
    scaled_px, todo_window_bounds, ShellBounds, WorkAreaMonitor,
};
pub use lifecycle::{
    apply_drawer_state, close_active_module, ensure_drawer_window, ensure_handle_window,
    hide_drawer_window_now, recover_shell_windows, set_handle_always_on_top, webview_url_for_mode,
};
pub use state::{shell_snapshot, update_active_module, update_shell_state, ShellState};

pub(super) const DRAWER_WINDOW_LABEL: &str = "main";
pub(super) const HANDLE_WINDOW_LABEL: &str = "handle";
