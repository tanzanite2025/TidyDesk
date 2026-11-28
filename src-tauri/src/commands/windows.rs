use crate::capture::open_snip_window;
use crate::shell::{close_active_module, shell_snapshot, update_shell_state, ShellState};
use crate::tool_windows::{
    close_capture_window, close_settings_window, open_or_toggle_capture_window,
    open_or_toggle_settings_window, open_todo_window,
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
        "activeModule": snapshot.active_module,
    }))
}

#[tauri::command]
pub async fn windows_control(
    app: AppHandle,
    payload: WindowControlPayload,
) -> Result<Value, String> {
    match payload.action.as_str() {
        "close" => {
            tauri::async_runtime::spawn_blocking(move || {
                let shell = app.state::<ShellState>();
                close_active_module(&app, &shell)
            })
            .await
            .map_err(|err| format!("close shell window task failed: {err}"))??;
        }
        "minimize" => {
            tauri::async_runtime::spawn_blocking(move || {
                let shell = app.state::<ShellState>();
                let current = shell_snapshot(&shell)?;
                if let Some(module) = current.active_module {
                    if let Some(window) = app.get_webview_window(&module) {
                        window.minimize().map_err(|err| err.to_string())?;
                    }
                    update_shell_state(&app, &shell, false, None)?;
                }
                Ok::<(), String>(())
            })
            .await
            .map_err(|err| format!("minimize shell window task failed: {err}"))??;
        }
        "open-todos" => {
            open_todo_window(app, None).await?;
        }
        "open-capture" => {
            open_or_toggle_capture_window(&app, true).await?;
        }
        "close-capture" => {
            tauri::async_runtime::spawn_blocking(move || close_capture_window(&app))
                .await
                .map_err(|err| format!("close capture task failed: {err}"))??;
        }
        "open-settings" => {
            open_or_toggle_settings_window(&app, true).await?;
        }
        "close-settings" => {
            tauri::async_runtime::spawn_blocking(move || close_settings_window(&app))
                .await
                .map_err(|err| format!("close settings task failed: {err}"))??;
        }
        "close-panel" => {
            tauri::async_runtime::spawn_blocking(move || {
                let shell = app.state::<ShellState>();
                if shell_snapshot(&shell)?.active_module.as_deref() == Some("todos") {
                    return Err("Todo window lifecycle is managed by close_todo_window".to_string());
                }
                close_active_module(&app, &shell)
            })
            .await
            .map_err(|err| format!("close panel task failed: {err}"))??;
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
