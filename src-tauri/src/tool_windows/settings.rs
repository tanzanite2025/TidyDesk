use super::{
    bring_floating_window_to_front, hide_other_floating_windows,
    register_floating_module_lifecycle, should_toggle_hide_floating_window,
    sync_floating_module_closed,
};
use crate::shell::{
    ensure_window_in_available_monitors, settings_window_bounds, shell_snapshot,
    update_active_module, webview_url_for_mode, with_window_build_lock, ShellState,
};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindowBuilder};

const SETTINGS_WINDOW_LABEL: &str = "settings";
const SETTINGS_MODULE_ID: &str = "settings";

fn ensure_settings_window(app: &AppHandle) -> Result<(), String> {
    with_window_build_lock(app, || {
        if app.get_webview_window(SETTINGS_WINDOW_LABEL).is_some() {
            return Ok(());
        }

        let bounds = settings_window_bounds(app)?;
        let window = WebviewWindowBuilder::new(
            app,
            SETTINGS_WINDOW_LABEL,
            webview_url_for_mode(SETTINGS_MODULE_ID)?,
        )
        .title("TidyDesk 设置")
        .decorations(false)
        .transparent(true)
        .resizable(true)
        .min_inner_size(500.0, 580.0)
        .visible(false)
        .build()
        .map_err(|err| err.to_string())?;
        window
            .set_size(PhysicalSize::new(bounds.width, bounds.height))
            .map_err(|err| err.to_string())?;
        window
            .set_position(PhysicalPosition::new(bounds.x, bounds.y))
            .map_err(|err| err.to_string())?;
        register_floating_module_lifecycle(&window, app.clone(), SETTINGS_MODULE_ID);
        Ok(())
    })
}

pub fn show_or_toggle_settings_window_sync(
    app: &AppHandle,
    toggle_if_active: bool,
) -> Result<bool, String> {
    let shell = app.state::<ShellState>();
    let current = shell_snapshot(&shell)?;
    if toggle_if_active
        && current.active_module.as_deref() == Some(SETTINGS_MODULE_ID)
        && should_toggle_hide_floating_window(app, SETTINGS_WINDOW_LABEL)
    {
        if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
            window.hide().map_err(|err| err.to_string())?;
        }
        sync_floating_module_closed(app, SETTINGS_MODULE_ID)?;
        return Ok(false);
    }

    hide_other_floating_windows(app, SETTINGS_WINDOW_LABEL)?;
    ensure_settings_window(app)?;
    ensure_window_in_available_monitors(
        app,
        SETTINGS_WINDOW_LABEL,
        500,
        580,
        settings_window_bounds(app)?,
    )?;
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        bring_floating_window_to_front(&window)?;
    }
    update_active_module(app, &shell, Some(SETTINGS_MODULE_ID.to_string()))?;
    Ok(true)
}

pub async fn open_or_toggle_settings_window(
    app: &AppHandle,
    toggle_if_active: bool,
) -> Result<(), String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        show_or_toggle_settings_window_sync(&app_handle, toggle_if_active)
    })
    .await
    .map_err(|err| format!("open settings window task failed: {err}"))??;
    Ok(())
}

pub fn close_settings_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        window.hide().map_err(|err| err.to_string())?;
    }
    sync_floating_module_closed(app, SETTINGS_MODULE_ID)
}
