use super::{bring_floating_window_to_front, sync_floating_module_closed};
use crate::shell::{
    capture_window_bounds, ensure_window_in_available_monitors, hide_drawer_window_now,
    shell_snapshot, update_active_module, webview_url_for_mode, ShellState,
};
use serde_json::json;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

const CAPTURE_WINDOW_LABEL: &str = "capture";
const CAPTURE_MODULE_ID: &str = "capture";

fn register_capture_window_lifecycle(window: &WebviewWindow, app: AppHandle) {
    window.on_window_event(move |event| match event {
        WindowEvent::Destroyed => {
            let _ = sync_floating_module_closed(&app, CAPTURE_MODULE_ID);
        }
        WindowEvent::Focused(focused) if *focused => {
            let shell = app.state::<ShellState>();
            let _ = update_active_module(&app, &shell, Some(CAPTURE_MODULE_ID.to_string()));
        }
        _ => {}
    });
}

fn ensure_capture_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(CAPTURE_WINDOW_LABEL).is_some() {
        return Ok(());
    }

    let bounds = capture_window_bounds(app)?;
    let window = WebviewWindowBuilder::new(
        app,
        CAPTURE_WINDOW_LABEL,
        webview_url_for_mode(CAPTURE_MODULE_ID)?,
    )
    .title("TidyDesk 快捷记录")
    .decorations(false)
    .transparent(true)
    .resizable(true)
    .min_inner_size(560.0, 520.0)
    .visible(false)
    .build()
    .map_err(|err| err.to_string())?;
    window
        .set_size(PhysicalSize::new(bounds.width, bounds.height))
        .map_err(|err| err.to_string())?;
    window
        .set_position(PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|err| err.to_string())?;
    register_capture_window_lifecycle(&window, app.clone());
    Ok(())
}

fn show_or_toggle_capture_window_sync(
    app: &AppHandle,
    toggle_if_active: bool,
) -> Result<bool, String> {
    let shell = app.state::<ShellState>();
    let current = shell_snapshot(&shell)?;
    if toggle_if_active && current.active_module.as_deref() == Some(CAPTURE_MODULE_ID) {
        let should_restore = app
            .get_webview_window(CAPTURE_WINDOW_LABEL)
            .map(|window| {
                !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false)
            })
            .unwrap_or(true);
        if !should_restore {
            if let Some(window) = app.get_webview_window(CAPTURE_WINDOW_LABEL) {
                window.hide().map_err(|err| err.to_string())?;
            }
            sync_floating_module_closed(app, CAPTURE_MODULE_ID)?;
            return Ok(false);
        }
    }

    hide_drawer_window_now(app, &shell)?;
    if let Some(window) = app.get_webview_window("todos") {
        window.hide().map_err(|err| err.to_string())?;
    }
    ensure_capture_window(app)?;
    ensure_window_in_available_monitors(
        app,
        CAPTURE_WINDOW_LABEL,
        560,
        520,
        capture_window_bounds(app)?,
    )?;
    if let Some(window) = app.get_webview_window(CAPTURE_WINDOW_LABEL) {
        bring_floating_window_to_front(&window)?;
    }
    update_active_module(app, &shell, Some(CAPTURE_MODULE_ID.to_string()))?;
    Ok(true)
}

async fn emit_capture_opened(app: &AppHandle) -> Result<(), String> {
    let clipboard_text = tauri::async_runtime::spawn_blocking(|| match arboard::Clipboard::new() {
        Ok(mut cb) => cb.get_text().unwrap_or_default(),
        Err(_) => String::new(),
    })
    .await
    .unwrap_or_default();
    if let Some(window) = app.get_webview_window(CAPTURE_WINDOW_LABEL) {
        window
            .emit("capture-opened", json!({ "clipboardText": clipboard_text }))
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

pub async fn open_or_toggle_capture_window(
    app: &AppHandle,
    toggle_if_active: bool,
) -> Result<(), String> {
    let opened = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || show_or_toggle_capture_window_sync(&app, toggle_if_active)
    })
    .await
    .map_err(|err| err.to_string())??;
    if opened {
        emit_capture_opened(app).await?;
    }
    Ok(())
}

pub fn close_capture_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(CAPTURE_WINDOW_LABEL) {
        window.hide().map_err(|err| err.to_string())?;
    }
    sync_floating_module_closed(app, CAPTURE_MODULE_ID)
}
