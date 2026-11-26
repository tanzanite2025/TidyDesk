mod app_picker;
mod capture;
mod snip;
mod todo;

pub use app_picker::{close_app_picker_window, open_app_picker_window, APP_PICKER_WINDOW_LABEL};
pub use capture::{close_capture_window, open_or_toggle_capture_window};
pub use snip::{close_snip_window, open_snip_window};
pub use todo::{
    close_todo_window, hide_todo_window_for_snip, open_todo_window, show_todo_window_after_snip,
    todos_consume_pending_focus_card, TodoFocusCardState,
};

use crate::shell::{
    apply_window_bounds, handle_window_bounds, set_handle_always_on_top, shell_snapshot,
    update_shell_state, ShellState,
};
use tauri::{AppHandle, Manager, WebviewWindow};

pub(super) fn sync_floating_module_closed(app: &AppHandle, module_id: &str) -> Result<(), String> {
    let shell = app.state::<ShellState>();
    let current = shell_snapshot(&shell)?;
    let next_module = if current.active_module.as_deref() == Some(module_id) {
        None
    } else {
        current.active_module
    };

    apply_window_bounds(app, "handle", handle_window_bounds(app, false)?)?;
    if let Some(window) = app.get_webview_window("handle") {
        window.show().map_err(|err| err.to_string())?;
    }
    set_handle_always_on_top(app, true)?;
    update_shell_state(app, &shell, false, next_module)
}

pub(super) fn bring_floating_window_to_front(window: &WebviewWindow) -> Result<(), String> {
    if window.is_minimized().unwrap_or(false) {
        window.unminimize().map_err(|err| err.to_string())?;
    }
    window.show().map_err(|err| err.to_string())?;
    let _ = window.set_always_on_top(true);
    let focus_res = window.set_focus();
    let _ = window.set_always_on_top(false);
    focus_res.map_err(|err| err.to_string())
}
