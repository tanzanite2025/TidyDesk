use crate::capture::open_snip_window;
use crate::shell::{
    apply_drawer_state, close_active_module, shell_snapshot, update_active_module, ShellState,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowControlPayload {
    action: String,
}

#[tauri::command]
pub async fn windows_control(
    app: AppHandle,
    shell: tauri::State<'_, ShellState>,
    payload: WindowControlPayload,
) -> Result<Value, String> {
    match payload.action.as_str() {
        "close" => {
            for label in ["capture", "todos", "drawer", "main"] {
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
            let current = shell_snapshot(&shell)?;
            if current.expanded && current.active_module.as_deref() == Some("capture") {
                apply_drawer_state(&app, &shell, false)?;
            } else {
                if let Some(window) = app.get_webview_window("todos") {
                    window.hide().map_err(|err| err.to_string())?;
                }
                apply_drawer_state(&app, &shell, true)?;
                update_active_module(&app, &shell, Some("capture".to_string()))?;
                emit_capture_opened(&app).await?;
            }
        }
        "show-files-tab" => {
            let current = shell_snapshot(&shell)?;
            if !current.expanded {
                apply_drawer_state(&app, &shell, true)?;
            }
            update_active_module(&app, &shell, Some("files".to_string()))?;
        }
        "show-capture-tab" => {
            let current = shell_snapshot(&shell)?;
            if !current.expanded {
                apply_drawer_state(&app, &shell, true)?;
            }
            update_active_module(&app, &shell, Some("capture".to_string()))?;
            emit_capture_opened(&app).await?;
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

async fn emit_capture_opened(app: &AppHandle) -> Result<(), String> {
    let clipboard_text = tauri::async_runtime::spawn_blocking(|| match arboard::Clipboard::new() {
        Ok(mut cb) => cb.get_text().unwrap_or_default(),
        Err(_) => String::new(),
    })
    .await
    .unwrap_or_default();
    let payload = json!({ "clipboardText": clipboard_text });
    for label in ["capture", "main"] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .emit("capture-opened", payload.clone())
                .map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}
