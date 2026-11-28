use super::{
    bring_floating_window_to_front, hide_other_floating_windows,
    register_floating_module_lifecycle, should_toggle_hide_floating_window,
    sync_floating_module_closed,
};
use crate::shell::{
    ensure_window_in_available_monitors, flush_dwm_compositor, set_window_dwm_transitions_disabled,
    shell_snapshot, todo_window_bounds, update_active_module, webview_url_for_mode,
    with_window_build_lock, ShellState,
};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
    WebviewWindowBuilder,
};

const TODO_WINDOW_LABEL: &str = "todos";
const TODO_MODULE_ID: &str = "todos";

#[derive(Default)]
pub struct TodoFocusCardState(pub Mutex<Option<String>>);

fn sync_todo_window_closed(app: &AppHandle) -> Result<(), String> {
    sync_floating_module_closed(app, TODO_MODULE_ID)
}

fn bring_todo_window_to_front(window: &WebviewWindow) -> Result<(), String> {
    bring_floating_window_to_front(window)
}

fn ensure_todo_window(app: &AppHandle) -> Result<(), String> {
    with_window_build_lock(app, || {
        if app.get_webview_window(TODO_WINDOW_LABEL).is_some() {
            return Ok(());
        }

        let bounds = todo_window_bounds(app)?;
        let window =
            WebviewWindowBuilder::new(app, TODO_WINDOW_LABEL, webview_url_for_mode("todos")?)
                .title("TidyDesk Todos")
                .min_inner_size(760.0, 560.0)
                .resizable(true)
                .visible(false)
                .build()
                .map_err(|err| err.to_string())?;
        window
            .set_size(PhysicalSize::new(bounds.width, bounds.height))
            .map_err(|err| err.to_string())?;
        window
            .set_position(PhysicalPosition::new(bounds.x, bounds.y))
            .map_err(|err| err.to_string())?;
        register_floating_module_lifecycle(&window, app.clone(), TODO_MODULE_ID);
        Ok(())
    })
}

fn show_todo_window(app: &AppHandle, target_card_id: Option<&str>) -> Result<(), String> {
    let shell = app.state::<ShellState>();
    let current = shell_snapshot(&shell)?;
    let normalized_card_id = target_card_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);

    if normalized_card_id.is_none()
        && current.active_module.as_deref() == Some(TODO_MODULE_ID)
        && should_toggle_hide_floating_window(app, TODO_WINDOW_LABEL)
    {
        close_todo_window_internal(app)?;
        return Ok(());
    }

    if let Some(ref card_id) = normalized_card_id {
        if let Ok(mut pending) = app.state::<TodoFocusCardState>().0.lock() {
            *pending = Some(card_id.clone());
        }
    }

    hide_other_floating_windows(app, TODO_MODULE_ID)?;
    ensure_todo_window(app)?;
    ensure_window_in_available_monitors(
        app,
        TODO_WINDOW_LABEL,
        760,
        560,
        todo_window_bounds(app)?,
    )?;
    if let Some(window) = app.get_webview_window(TODO_WINDOW_LABEL) {
        bring_todo_window_to_front(&window)?;
    }
    update_active_module(app, &shell, Some(TODO_MODULE_ID.to_string()))?;

    if let Some(card_id) = normalized_card_id {
        app.emit("todo-focus-card", json!({ "cardId": card_id }))
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn close_todo_window_internal(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(TODO_WINDOW_LABEL) {
        window.hide().map_err(|err| err.to_string())?;
    }
    sync_todo_window_closed(app)
}

pub fn hide_todo_window_for_snip(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(TODO_WINDOW_LABEL) {
        set_window_dwm_transitions_disabled(&window, true)?;
        window.hide().map_err(|err| err.to_string())?;
        flush_dwm_compositor();
    }
    Ok(())
}

pub fn show_todo_window_after_snip(app: &AppHandle) -> Result<(), String> {
    let shell = app.state::<ShellState>();
    ensure_todo_window(app)?;
    ensure_window_in_available_monitors(
        app,
        TODO_WINDOW_LABEL,
        760,
        560,
        todo_window_bounds(app)?,
    )?;
    if let Some(window) = app.get_webview_window(TODO_WINDOW_LABEL) {
        bring_todo_window_to_front(&window)?;
        let _ = set_window_dwm_transitions_disabled(&window, false);
    }
    update_active_module(app, &shell, Some(TODO_MODULE_ID.to_string()))
}

#[tauri::command]
pub async fn open_todo_window(app: AppHandle, card_id: Option<String>) -> Result<Value, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || show_todo_window(&app_handle, card_id.as_deref()))
        .await
        .map_err(|err| err.to_string())??;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub fn todos_consume_pending_focus_card(app: AppHandle) -> Result<Option<String>, String> {
    let state = app.state::<TodoFocusCardState>();
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "failed to lock todo focus card state".to_string())?;
    Ok(guard.take())
}

#[tauri::command]
pub async fn close_todo_window(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || close_todo_window_internal(&app))
        .await
        .map_err(|err| format!("close todo window task failed: {err}"))??;
    Ok(json!({ "success": true }))
}
