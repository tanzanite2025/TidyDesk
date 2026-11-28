mod capture;
mod settings;
mod snip;
mod todo;

pub use capture::{close_capture_window, open_or_toggle_capture_window};
pub use settings::{
    close_settings_window, open_or_toggle_settings_window, show_or_toggle_settings_window_sync,
};
pub use snip::{close_snip_window, open_snip_window};
pub use todo::{
    close_todo_window, hide_todo_window_for_snip, open_todo_window, show_todo_window_after_snip,
    todos_consume_pending_focus_card, TodoFocusCardState,
};

use crate::shell::{
    apply_window_bounds, handle_window_bounds, set_handle_always_on_top, shell_snapshot,
    update_active_module, update_shell_state, ShellState,
};
use tauri::{AppHandle, Manager, WebviewWindow, WindowEvent};

pub(super) fn hide_other_floating_windows(
    app: &AppHandle,
    active_label: &str,
) -> Result<(), String> {
    for label in ["todos", "capture", "settings"] {
        if label == active_label {
            continue;
        }
        if let Some(window) = app.get_webview_window(label) {
            window.hide().map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

pub(super) fn register_floating_module_lifecycle(
    window: &WebviewWindow,
    app: AppHandle,
    module_id: &'static str,
) {
    window.on_window_event(move |event| match event {
        WindowEvent::Destroyed => {
            let app_handle = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let _ = sync_floating_module_closed(&app_handle, module_id);
            });
        }
        WindowEvent::Focused(true) => {
            let app_handle = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let shell = app_handle.state::<ShellState>();
                let _ = update_active_module(&app_handle, &shell, Some(module_id.to_string()));
            });
        }
        _ => {}
    });
}

pub(super) fn sync_floating_module_closed(app: &AppHandle, module_id: &str) -> Result<(), String> {
    let shell = app.state::<ShellState>();
    let current = shell_snapshot(&shell)?;
    let next_module = if current.active_module.as_deref() == Some(module_id) {
        None
    } else {
        current.active_module
    };

    apply_window_bounds(app, "handle", handle_window_bounds(app)?)?;
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

pub(super) fn rects_overlap_meaningfully(a: (i32, i32, i32, i32), b: (i32, i32, i32, i32)) -> bool {
    const MIN_OVERLAP_PX: i32 = 8;
    let overlap_w = a.2.min(b.2) - a.0.max(b.0);
    let overlap_h = a.3.min(b.3) - a.1.max(b.1);
    overlap_w >= MIN_OVERLAP_PX && overlap_h >= MIN_OVERLAP_PX
}

#[cfg(target_os = "windows")]
fn is_window_occluded_by_other_apps(window: &WebviewWindow) -> bool {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindow, GetWindowLongW, GetWindowRect, IsWindowVisible, GWL_EXSTYLE, GW_HWNDPREV,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
    };

    let Ok(raw) = window.hwnd() else {
        return false;
    };
    let target = HWND(raw.0);
    let mut target_rect = RECT::default();
    unsafe {
        if GetWindowRect(target, &mut target_rect).is_err() {
            return false;
        }
    }
    let target_box = (
        target_rect.left,
        target_rect.top,
        target_rect.right,
        target_rect.bottom,
    );

    let mut cursor = target;
    // Cap traversal to prevent pathological loops in exotic shell states.
    for _ in 0..512 {
        let Ok(prev) = (unsafe { GetWindow(cursor, GW_HWNDPREV) }) else {
            break;
        };
        if prev.0.is_null() {
            break;
        }
        cursor = prev;

        unsafe {
            if !IsWindowVisible(prev).as_bool() {
                continue;
            }
            let ex_style = GetWindowLongW(prev, GWL_EXSTYLE) as u32;
            let skip_styles =
                WS_EX_TOPMOST.0 | WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0 | WS_EX_TRANSPARENT.0;
            if (ex_style & skip_styles) != 0 {
                continue;
            }
            let mut cloaked: u32 = 0;
            if DwmGetWindowAttribute(
                prev,
                DWMWA_CLOAKED,
                (&mut cloaked as *mut u32).cast::<std::ffi::c_void>(),
                std::mem::size_of::<u32>() as u32,
            )
            .is_ok()
                && cloaked != 0
            {
                continue;
            }
            let mut rect = RECT::default();
            if GetWindowRect(prev, &mut rect).is_err() {
                continue;
            }
            if rects_overlap_meaningfully(
                target_box,
                (rect.left, rect.top, rect.right, rect.bottom),
            ) {
                return true;
            }
        }
    }
    false
}

#[cfg(not(target_os = "windows"))]
fn is_window_occluded_by_other_apps(_window: &WebviewWindow) -> bool {
    false
}

/// Only toggle-hide an active floating tool window when it is visible, unminimized, and not buried
/// behind other apps; otherwise clicking the permanent edge handle raises it to the front in one click.
pub(super) fn should_toggle_hide_floating_window(app: &AppHandle, label: &str) -> bool {
    let Some(window) = app.get_webview_window(label) else {
        return false;
    };
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return false;
    }
    !is_window_occluded_by_other_apps(&window)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rects_overlap_ignores_hairline_edges_and_detects_real_occlusion() {
        assert!(!rects_overlap_meaningfully(
            (100, 100, 500, 500),
            (500, 100, 900, 500)
        ));
        assert!(!rects_overlap_meaningfully(
            (100, 100, 500, 500),
            (496, 100, 900, 500)
        ));
        assert!(rects_overlap_meaningfully(
            (100, 100, 500, 500),
            (400, 200, 900, 600)
        ));
    }
}
