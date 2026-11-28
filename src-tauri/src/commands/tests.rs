use crate::capture::{open_snip_window, snip_cancel};
use crate::shell::{recover_shell_windows, shell_snapshot, update_shell_state, ShellState};
use crate::tool_windows::{
    close_capture_window, close_settings_window, close_todo_window, open_or_toggle_settings_window,
};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn tests_open_settings_window(app: AppHandle) -> Result<Value, String> {
    open_or_toggle_settings_window(&app, false).await?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn tests_start_snip(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || open_snip_window(&app))
        .await
        .map_err(|err| format!("test start snip failed: {err}"))??;
    Ok(json!({ "success": true }))
}

fn window_debug_snapshot(app: &AppHandle, label: &str) -> Value {
    if let Some(window) = app.get_webview_window(label) {
        let visible = window.is_visible().unwrap_or(false);
        let always_on_top = window.is_always_on_top().unwrap_or(false);
        let url = window.url().ok().map(|value| value.to_string());
        let title = window.title().ok();
        json!({
            "label": label,
            "exists": true,
            "visible": visible,
            "alwaysOnTop": always_on_top,
            "url": url,
            "title": title,
        })
    } else {
        json!({
            "label": label,
            "exists": false,
            "visible": false,
            "alwaysOnTop": false,
            "url": Value::Null,
            "title": Value::Null,
        })
    }
}

#[tauri::command]
pub fn tests_get_window_snapshot(
    app: AppHandle,
    shell: tauri::State<'_, ShellState>,
) -> Result<Value, String> {
    let snapshot = shell_snapshot(&shell)?;
    Ok(json!({
        "success": true,
        "shell": {
            "expanded": snapshot.expanded,
            "activeModule": snapshot.active_module,
        },
        "windows": {
            "handle": window_debug_snapshot(&app, "handle"),
            "todos": window_debug_snapshot(&app, "todos"),
            "capture": window_debug_snapshot(&app, "capture"),
            "settings": window_debug_snapshot(&app, "settings"),
            "snip": window_debug_snapshot(&app, "snip"),
        }
    }))
}

#[tauri::command]
pub async fn tests_reset_window_state(app: AppHandle) -> Result<Value, String> {
    let _ = snip_cancel(app.clone()).await;
    let _ = close_todo_window(app.clone()).await;

    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = close_capture_window(&app_handle);
        let _ = close_settings_window(&app_handle);
        let shell = app_handle.state::<ShellState>();
        update_shell_state(&app_handle, &shell, false, None)?;
        recover_shell_windows(&app_handle)?;
        tests_get_window_snapshot(app_handle.clone(), shell)
    })
    .await
    .map_err(|err| format!("test reset window state failed: {err}"))?
}
