use crate::apps::close_app_picker;
use crate::shell::{
    apply_drawer_state, recover_shell_windows, shell_snapshot, update_active_module,
    update_shell_state, ShellState,
};
use crate::stickers::{open_snip_window, snip_cancel};
use crate::tool_windows::{close_todo_window, APP_PICKER_WINDOW_LABEL};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn tests_open_files_drawer(
    app: AppHandle,
    shell: tauri::State<'_, ShellState>,
) -> Result<Value, String> {
    if !shell_snapshot(&shell)?.expanded {
        apply_drawer_state(&app, &shell, true)?;
    }
    update_active_module(&app, &shell, Some("files".to_string()))?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub fn tests_collapse_drawer(
    app: AppHandle,
    shell: tauri::State<'_, ShellState>,
) -> Result<Value, String> {
    apply_drawer_state(&app, &shell, false)?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub fn tests_start_snip(app: AppHandle) -> Result<Value, String> {
    open_snip_window(&app)?;
    Ok(json!({ "success": true }))
}

fn window_debug_snapshot(app: &AppHandle, label: &str) -> Value {
    if let Some(window) = app.get_webview_window(label) {
        let visible = window.is_visible().unwrap_or(false);
        let url = window.url().ok().map(|value| value.to_string());
        let title = window.title().ok();
        json!({
            "label": label,
            "exists": true,
            "visible": visible,
            "url": url,
            "title": title,
        })
    } else {
        json!({
            "label": label,
            "exists": false,
            "visible": false,
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
            "main": window_debug_snapshot(&app, "main"),
            "todos": window_debug_snapshot(&app, "todos"),
            "snip": window_debug_snapshot(&app, "snip"),
            "appPicker": window_debug_snapshot(&app, APP_PICKER_WINDOW_LABEL),
        }
    }))
}

#[tauri::command]
pub fn tests_reset_window_state(
    app: AppHandle,
    shell: tauri::State<'_, ShellState>,
) -> Result<Value, String> {
    let _ = close_app_picker(app.clone());
    let _ = snip_cancel(app.clone());
    let _ = close_todo_window(app.clone());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }

    update_shell_state(&app, &shell, false, None)?;
    recover_shell_windows(&app)?;
    tests_get_window_snapshot(app, shell)
}
