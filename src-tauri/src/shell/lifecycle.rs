use super::bounds::{apply_window_bounds, handle_window_bounds, save_handle_bounds, ShellBounds};
use super::state::{
    bump_handle_bounds_generation, is_current_handle_bounds_generation, shell_snapshot,
    update_shell_state, with_window_build_lock, ShellState,
};
use super::HANDLE_WINDOW_LABEL;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use url::Url;

const HANDLE_BOUNDS_PERSIST_DEBOUNCE_MS: u64 = 300;

const FLOATING_MODULE_LABELS: [&str; 3] = ["todos", "capture", "settings"];

/// Disable or re-enable DWM window show/hide transitions on Windows so instant snip captures don't ghost fading frames.
pub fn set_window_dwm_transitions_disabled(
    window: &WebviewWindow,
    disabled: bool,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::core::BOOL;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED,
        };

        let raw = window.hwnd().map_err(|err| err.to_string())?;
        let hwnd = HWND(raw.0);
        let value = BOOL::from(disabled);
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_TRANSITIONS_FORCEDISABLED,
                (&value as *const BOOL).cast::<std::ffi::c_void>(),
                std::mem::size_of::<BOOL>() as u32,
            );
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, disabled);
    }
    Ok(())
}

/// Flush pending DWM composition frames so hidden windows disappear cleanly before GDI capture.
pub fn flush_dwm_compositor() {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Graphics::Dwm::DwmFlush;
        unsafe {
            let _ = DwmFlush();
            let _ = DwmFlush();
        }
    }
}

/// Temporarily hide visible shell & tool windows before capturing a desktop snip without mutating `ShellState`,
/// allowing `recover_shell_windows` to restore the exact prior layout when snip completes or cancels.
pub fn hide_shell_windows_for_snip(app: &AppHandle) -> Result<(), String> {
    let mut hid_any = false;
    for label in [HANDLE_WINDOW_LABEL, "todos", "capture", "settings"] {
        if let Some(window) = app.get_webview_window(label) {
            if window.is_visible().unwrap_or(true) {
                set_window_dwm_transitions_disabled(&window, true)?;
                window.hide().map_err(|err| err.to_string())?;
                hid_any = true;
            }
        }
    }
    if hid_any {
        flush_dwm_compositor();
    }
    Ok(())
}

pub fn set_handle_always_on_top(app: &AppHandle, always_on_top: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
        window
            .set_always_on_top(always_on_top)
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

pub fn close_active_module(
    app: &AppHandle,
    shell: &tauri::State<'_, ShellState>,
) -> Result<(), String> {
    let current = shell_snapshot(shell)?;
    if let Some(module) = current.active_module {
        if let Some(window) = app.get_webview_window(&module) {
            window.hide().map_err(|err| err.to_string())?;
        }
    }
    apply_window_bounds(app, HANDLE_WINDOW_LABEL, handle_window_bounds(app)?)?;
    if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
        window.show().map_err(|err| err.to_string())?;
    }
    set_handle_always_on_top(app, true)?;
    update_shell_state(app, shell, false, None)
}

pub fn recover_shell_windows(app: &AppHandle) -> Result<(), String> {
    let shell = app.state::<ShellState>();
    let mut snapshot = shell_snapshot(&shell)?;
    for floating_label in FLOATING_MODULE_LABELS {
        if snapshot.active_module.as_deref() == Some(floating_label)
            && app.get_webview_window(floating_label).is_none()
        {
            update_shell_state(app, &shell, false, None)?;
            snapshot = shell_snapshot(&shell)?;
        }
        if snapshot.active_module.as_deref() != Some(floating_label) {
            if let Some(window) = app.get_webview_window(floating_label) {
                let _ = window.hide();
            }
        }
    }

    apply_window_bounds(app, HANDLE_WINDOW_LABEL, handle_window_bounds(app)?)?;
    if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
        window.show().map_err(|err| err.to_string())?;
        let _ = set_window_dwm_transitions_disabled(&window, false);
    }
    // Keep the minimalist edge handle permanently on top across all apps.
    set_handle_always_on_top(app, true)?;

    for floating_label in FLOATING_MODULE_LABELS {
        if snapshot.active_module.as_deref() == Some(floating_label) {
            if let Some(window) = app.get_webview_window(floating_label) {
                window.show().map_err(|err| err.to_string())?;
                let _ = window.set_always_on_top(true);
                window.set_focus().map_err(|err| err.to_string())?;
                let _ = window.set_always_on_top(false);
                let _ = set_window_dwm_transitions_disabled(&window, false);
            }
        }
    }

    Ok(())
}

pub fn webview_url_for_mode(mode: &str) -> Result<WebviewUrl, String> {
    if cfg!(debug_assertions) {
        let url = Url::parse(&format!("http://127.0.0.1:3000/?mode={mode}"))
            .map_err(|err| err.to_string())?;
        Ok(WebviewUrl::External(url))
    } else {
        Ok(WebviewUrl::App(format!("index.html?mode={mode}").into()))
    }
}

fn register_handle_window_lifecycle(app: &AppHandle, window: &WebviewWindow) {
    let state = app.state::<ShellState>();
    if state.handle_events_registered.swap(true, Ordering::AcqRel) {
        return;
    }

    let app_handle = app.clone();
    let window_clone = window.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Moved(_)) {
            if window_clone.is_minimized().unwrap_or(false) {
                return;
            }
            let Ok(pos) = window_clone.outer_position() else {
                return;
            };
            let Ok(size) = window_clone.outer_size() else {
                return;
            };
            if pos.x <= -30_000 || pos.y <= -30_000 || size.width < 40 || size.height < 40 {
                return;
            }
            let next_bounds = ShellBounds {
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
            };
            let generation = bump_handle_bounds_generation(&app_handle, next_bounds);
            let app_persist = app_handle.clone();
            tauri::async_runtime::spawn_blocking(move || {
                std::thread::sleep(Duration::from_millis(HANDLE_BOUNDS_PERSIST_DEBOUNCE_MS));
                if !is_current_handle_bounds_generation(&app_persist, generation) {
                    return;
                }
                if let Err(err) = save_handle_bounds(&app_persist, next_bounds) {
                    eprintln!("[TIDYDESK] Failed to save handle bounds: {err}");
                }
            });
        }
    });
}

pub fn ensure_handle_window(app: &AppHandle) -> Result<(), String> {
    with_window_build_lock(app, || {
        if let Some(existing) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
            register_handle_window_lifecycle(app, &existing);
            return Ok(());
        }
        let bounds = handle_window_bounds(app)?;
        let window =
            WebviewWindowBuilder::new(app, HANDLE_WINDOW_LABEL, webview_url_for_mode("handle")?)
                .title("TidyDesk Handle")
                .inner_size(bounds.width as f64, bounds.height as f64)
                .resizable(false)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .build()
                .map_err(|err| err.to_string())?;
        window
            .set_size(PhysicalSize::new(bounds.width, bounds.height))
            .map_err(|err| err.to_string())?;
        window
            .set_position(PhysicalPosition::new(bounds.x, bounds.y))
            .map_err(|err| err.to_string())?;
        register_handle_window_lifecycle(app, &window);
        Ok(())
    })
}
