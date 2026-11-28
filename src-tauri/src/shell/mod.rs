mod bounds;
mod lifecycle;
mod state;

pub use bounds::{
    apply_window_bounds, available_work_areas, capture_window_bounds,
    clamp_physical_bounds_to_monitors, default_cascade_bounds_for_monitor,
    ensure_window_in_available_monitors, handle_window_bounds, is_valid_runtime_window_bounds,
    scaled_px, settings_window_bounds, todo_window_bounds, ShellBounds, WorkAreaMonitor,
};
pub use lifecycle::{
    close_active_module, ensure_handle_window, flush_dwm_compositor, hide_shell_windows_for_snip,
    recover_shell_windows, set_handle_always_on_top, set_window_dwm_transitions_disabled,
    webview_url_for_mode,
};
pub use state::{
    shell_snapshot, update_active_module, update_shell_state, with_window_build_lock, ShellState,
};

pub(super) const HANDLE_WINDOW_LABEL: &str = "handle";
