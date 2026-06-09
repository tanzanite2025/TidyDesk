use crate::shell::{
    apply_window_bounds, handle_window_bounds, hide_drawer_window_now, set_handle_always_on_top,
    shell_snapshot, update_active_module, update_shell_state, webview_url_for_mode, ShellState,
};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent};

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

fn register_app_picker_window_lifecycle(window: &WebviewWindow, app: AppHandle) {
    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            let _ = crate::shell::recover_shell_windows(&app);
        }
    });
}

pub fn open_app_picker_window(
    app: AppHandle,
    state: tauri::State<'_, crate::apps::AppPickerTargetState>,
    payload: Option<crate::apps::OpenAppPickerPayload>,
) -> Result<(), String> {
    let target_folder = if let Some(target_folder) = payload
        .and_then(|value| value.target_folder)
        .map(|value| crate::files::safe_drawer_name(&value))
        .filter(|value| !value.is_empty())
    {
        let mut current = state
            .0
            .lock()
            .map_err(|_| "failed to lock app picker target".to_string())?;
        *current = target_folder;
        current.clone()
    } else {
        state
            .0
            .lock()
            .map_err(|_| "failed to lock app picker target".to_string())?
            .clone()
    };

    if let Some(window) = app.get_webview_window("app-picker-poc") {
        window.show().map_err(|err| err.to_string())?;
        window.set_focus().map_err(|err| err.to_string())?;
        window
            .emit("set-target-folder", target_folder)
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        &app,
        "app-picker-poc",
        crate::shell::webview_url_for_mode("app-picker")?,
    )
    .title("TidyDesk AppPicker Tauri PoC")
    .inner_size(920.0, 720.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|err| err.to_string())?;
    register_app_picker_window_lifecycle(&window, app.clone());
    window.show().map_err(|err| err.to_string())?;
    window
        .emit("set-target-folder", target_folder)
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub fn close_app_picker_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("app-picker-poc") {
        window
            .destroy()
            .or_else(|_| window.close())
            .map_err(|err| err.to_string())?;
    }
    crate::shell::recover_shell_windows(&app)?;
    Ok(())
}

// stickers windows logic
pub fn open_snip_window(app: &AppHandle) -> Result<(), String> {
    if crate::stickers::is_snip_capture_in_flight(app) {
        return Ok(());
    }

    let monitor = crate::stickers_rules::snip_open_monitor(app)?;
    if let Some(window) = app.get_webview_window(crate::stickers_rules::SNIP_WINDOW_LABEL) {
        prepare_snip_window(&window, &monitor)?;
        window
            .emit(crate::stickers_rules::SNIP_RESET_EVENT, json!({ "reason": "reopen" }))
            .map_err(|err| err.to_string())?;
        window.show().map_err(|err| err.to_string())?;
        window.set_focus().map_err(|err| err.to_string())?;
        return Ok(());
    }

    let window =
        WebviewWindowBuilder::new(app, crate::stickers_rules::SNIP_WINDOW_LABEL, crate::shell::webview_url_for_mode("snip")?)
            .title("TidyDesk Snip")
            .inner_size(monitor.width as f64, monitor.height as f64)
            .resizable(false)
            .decorations(false)
            .transparent(true)
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

fn prepare_snip_window(window: &WebviewWindow, monitor: &crate::stickers_rules::MonitorSnapshot) -> Result<(), String> {
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
        .set_size(tauri::PhysicalSize::new(monitor.width, monitor.height))
        .map_err(|err| err.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(monitor.x, monitor.y))
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub fn dispose_snip_window(window: &WebviewWindow) {
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

pub fn ensure_sticker_window(app: &AppHandle, sticker: &crate::stickers_rules::StickerRecord) -> Result<(), String> {
    if !std::path::Path::new(&sticker.image_path).exists() {
        return Ok(());
    }

    let label = crate::stickers_rules::sticker_window_label(&sticker.id);
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|err| err.to_string())?;
        window
            .set_always_on_top(sticker.always_on_top)
            .map_err(|err| err.to_string())?;
        window
            .set_size(tauri::PhysicalSize::new(
                sticker.bounds.width,
                sticker.bounds.height,
            ))
            .map_err(|err| err.to_string())?;
        window
            .set_position(tauri::PhysicalPosition::new(sticker.bounds.x, sticker.bounds.y))
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(app, &label, crate::stickers_rules::sticker_webview_url(&sticker.id)?)
        .title("TidyDesk Sticker")
        .inner_size(sticker.bounds.width as f64, sticker.bounds.height as f64)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .always_on_top(sticker.always_on_top)
        .skip_taskbar(true)
        .build()
        .map_err(|err| err.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(
            sticker.bounds.width,
            sticker.bounds.height,
        ))
        .map_err(|err| err.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(sticker.bounds.x, sticker.bounds.y))
        .map_err(|err| err.to_string())?;
    register_sticker_window_lifecycle(&window, app.clone(), sticker.id.clone());
    Ok(())
}

fn register_sticker_window_lifecycle(window: &WebviewWindow, app: AppHandle, sticker_id: String) {
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            let _ = persist_sticker_window_bounds(&app, &sticker_id);
        }
        _ => {}
    });
}

fn persist_sticker_window_bounds(app: &AppHandle, sticker_id: &str) -> Result<(), String> {
    let label = crate::stickers_rules::sticker_window_label(sticker_id);
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(());
    };
    let position = window.outer_position().map_err(|err| err.to_string())?;
    let size = window.outer_size().map_err(|err| err.to_string())?;

    crate::stickers_rules::mutate_sticker_state(app, |state| {
        if let Some(sticker) = state.stickers.iter_mut().find(|item| item.id == sticker_id) {
            sticker.bounds = crate::stickers_rules::StickerWindowBounds {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            };
        }
        Ok(())
    })?;
    Ok(())
}

