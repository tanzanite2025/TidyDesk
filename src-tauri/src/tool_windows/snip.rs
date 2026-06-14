use serde_json::json;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
    WebviewWindowBuilder,
};

pub fn open_snip_window(app: &AppHandle) -> Result<(), String> {
    if crate::stickers::is_snip_capture_in_flight(app) {
        return Ok(());
    }

    let monitor = crate::stickers_rules::snip_open_monitor(app)?;
    if let Some(window) = app.get_webview_window(crate::stickers_rules::SNIP_WINDOW_LABEL) {
        prepare_snip_window(&window, &monitor)?;
        window
            .emit(
                crate::stickers_rules::SNIP_RESET_EVENT,
                json!({ "reason": "reopen" }),
            )
            .map_err(|err| err.to_string())?;
        window.show().map_err(|err| err.to_string())?;
        window.set_focus().map_err(|err| err.to_string())?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        app,
        crate::stickers_rules::SNIP_WINDOW_LABEL,
        crate::shell::webview_url_for_mode("snip")?,
    )
    .title("TidyDesk Snip")
    .inner_size(monitor.width as f64, monitor.height as f64)
    .resizable(false)
    .decorations(false)
    .transparent(false)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .build()
    .map_err(|err| err.to_string())?;
    prepare_snip_window(&window, &monitor)?;
    window.show().map_err(|err| err.to_string())?;
    window.set_focus().map_err(|err| err.to_string())?;
    Ok(())
}

fn prepare_snip_window(
    window: &WebviewWindow,
    monitor: &crate::stickers_rules::MonitorSnapshot,
) -> Result<(), String> {
    window
        .set_ignore_cursor_events(false)
        .map_err(|err| err.to_string())?;
    window.set_focusable(true).map_err(|err| err.to_string())?;
    window
        .set_always_on_top(true)
        .map_err(|err| err.to_string())?;
    window
        .set_skip_taskbar(true)
        .map_err(|err| err.to_string())?;
    window
        .set_size(PhysicalSize::new(monitor.width, monitor.height))
        .map_err(|err| err.to_string())?;
    window
        .set_position(PhysicalPosition::new(monitor.x, monitor.y))
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn dispose_snip_window(window: &WebviewWindow) {
    let _ = window.set_ignore_cursor_events(true);
    let _ = window.set_focusable(false);
    let _ = window.set_always_on_top(false);
    let _ = window.hide();
    let _ = window.destroy().or_else(|_| window.close());
}

pub fn close_snip_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(crate::stickers_rules::SNIP_WINDOW_LABEL) {
        dispose_snip_window(&window);
    }
    Ok(())
}
