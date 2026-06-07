use crate::shell::{
    apply_window_bounds, handle_window_bounds, hide_drawer_window_now, set_handle_always_on_top,
    shell_snapshot, update_active_module, update_shell_state, webview_url_for_mode, ShellState,
};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const TODO_WINDOW_LABEL: &str = "todos";
const TODO_MODULE_ID: &str = "todos";

fn sync_todo_window_closed(app: &AppHandle) -> Result<(), String> {
    let shell = app.state::<ShellState>();
    let current = shell_snapshot(&shell)?;
    let next_module = if current.active_module.as_deref() == Some(TODO_MODULE_ID) {
        None
    } else {
        current.active_module
    };

    apply_window_bounds(app, "handle", handle_window_bounds(app, false)?)?;
    if let Some(window) = app.get_webview_window("handle") {
        window.show().map_err(|err| err.to_string())?;
    }
    set_handle_always_on_top(app, true)?;
    update_shell_state(app, &shell, false, next_module)
}

fn register_todo_window_lifecycle(window: &WebviewWindow, app: AppHandle) {
    window.on_window_event(move |event| match event {
        WindowEvent::Destroyed => {
            let _ = sync_todo_window_closed(&app);
        }
        WindowEvent::Focused(focused) if *focused => {
            let shell = app.state::<ShellState>();
            let _ = update_active_module(&app, &shell, Some(TODO_MODULE_ID.to_string()));
        }
        _ => {}
    });
}

fn ensure_todo_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(TODO_WINDOW_LABEL).is_some() {
        return Ok(());
    }

    let window =
        WebviewWindowBuilder::new(app, TODO_WINDOW_LABEL, webview_url_for_mode("tauri-todos")?)
            .title("TidyDesk Todos")
            .inner_size(980.0, 680.0)
            .resizable(true)
            .center()
            .build()
            .map_err(|err| err.to_string())?;
    register_todo_window_lifecycle(&window, app.clone());
    Ok(())
}

fn show_todo_window(app: &AppHandle) -> Result<(), String> {
    let shell = app.state::<ShellState>();
    let current = shell_snapshot(&shell)?;
    if current.active_module.as_deref() == Some(TODO_MODULE_ID) {
        close_todo_window_internal(app)?;
        return Ok(());
    }

    hide_drawer_window_now(app, &shell)?;
    if let Some(window) = app.get_webview_window("capture") {
        window.hide().map_err(|err| err.to_string())?;
    }
    ensure_todo_window(app)?;
    if let Some(window) = app.get_webview_window(TODO_WINDOW_LABEL) {
        window.show().map_err(|err| err.to_string())?;
    }
    update_active_module(app, &shell, Some(TODO_MODULE_ID.to_string()))
}

fn close_todo_window_internal(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(TODO_WINDOW_LABEL) {
        window.hide().map_err(|err| err.to_string())?;
    }
    sync_todo_window_closed(app)
}

#[tauri::command]
pub async fn open_todo_window(app: AppHandle) -> Result<Value, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || show_todo_window(&app_handle))
        .await
        .map_err(|err| err.to_string())??;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub fn close_todo_window(app: AppHandle) -> Result<Value, String> {
    close_todo_window_internal(&app)?;
    Ok(json!({ "success": true }))
}
