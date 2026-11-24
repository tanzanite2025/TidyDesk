use crate::capture::open_snip_window;
use crate::shell::{
    apply_drawer_state, close_active_module, shell_snapshot, update_active_module, ShellState,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowControlPayload {
    action: String,
}

#[tauri::command]
pub fn windows_get_shell_state(shell: tauri::State<'_, ShellState>) -> Result<Value, String> {
    let snapshot = shell_snapshot(&shell)?;
    Ok(json!({
        "expanded": snapshot.expanded,
        "activeModule": snapshot.active_module
    }))
}

#[tauri::command]
pub fn windows_drawer_ready(app: AppHandle) -> Result<(), String> {
    crate::shell::notify_drawer_ready(&app);
    Ok(())
}

#[tauri::command]
pub async fn windows_control(
    app: AppHandle,
    shell: tauri::State<'_, ShellState>,
    payload: WindowControlPayload,
) -> Result<Value, String> {
    match payload.action.as_str() {
        "close" => {
            for label in ["capture", "todos", "app-picker", "main"] {
                if let Some(window) = app.get_webview_window(label) {
                    let _ = window.close();
                }
            }
        }
        "minimize" => {
            let current = shell_snapshot(&shell)?;
            if let Some(label) = current.active_module.as_deref() {
                if matches!(label, "todos" | "capture") {
                    if let Some(window) = app.get_webview_window(label) {
                        window.minimize().map_err(|err| err.to_string())?;
                    }
                } else if let Some(window) = app.get_webview_window("main") {
                    window.minimize().map_err(|err| err.to_string())?;
                }
            } else if let Some(window) = app.get_webview_window("main") {
                window.minimize().map_err(|err| err.to_string())?;
            }
        }
        "open-files" => {
            let current = shell_snapshot(&shell)?;
            if current.expanded && current.active_module.as_deref() == Some("files") {
                apply_drawer_state(&app, &shell, false)?;
            } else if current.expanded {
                update_active_module(&app, &shell, Some("files".to_string()))?;
            } else {
                apply_drawer_state(&app, &shell, true)?;
                update_active_module(&app, &shell, Some("files".to_string()))?;
            }
        }
        "open-capture" => {
            crate::tool_windows::open_or_toggle_capture_window(&app, true).await?;
        }
        "close-capture" => {
            crate::tool_windows::close_capture_window(&app)?;
        }
        "close-panel" => {
            if shell_snapshot(&shell)?.active_module.as_deref() == Some("todos") {
                return Err("Todo window lifecycle is managed by close_todo_window".to_string());
            }
            close_active_module(&app, &shell)?;
        }
        "expand-drawer" => {
            apply_drawer_state(&app, &shell, true)?;
        }
        "collapse-drawer" => {
            apply_drawer_state(&app, &shell, false)?;
        }
        "toggle-drawer" => {
            let expanded = !shell_snapshot(&shell)?.expanded;
            apply_drawer_state(&app, &shell, expanded)?;
        }
        "start-screenshot" => {
            let app_handle = app.clone();
            tauri::async_runtime::spawn_blocking(move || open_snip_window(&app_handle))
                .await
                .map_err(|err| format!("start screenshot task failed: {err}"))??;
        }
        _ => return Err(format!("Unsupported window action: {}", payload.action)),
    }

    Ok(json!({ "success": true }))
}
