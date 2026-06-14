#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

mod apps;
mod apps_classifier;
mod sidecar_client;
mod files;
mod files_rules;
mod icons;
mod quick_notes;
mod shell;
mod shortcuts;
mod stickers;
mod stickers_rules;
mod todos;
mod todos_rules;
mod tool_windows;
mod updates;

pub use crate::files_rules::{resolve_shortcut_target, write_shortcut_link};

use apps::{
    apps_add_to_drawer, apps_get_picker_target, apps_scan_installed, apps_scan_metadata,
    close_app_picker_poc, open_app_picker_poc, probe_go_sidecar, AppPickerTargetState,
    SidecarState, TrustedShortcutState,
};
use files::{
    drawers_create, drawers_delete_item, drawers_rename_item, files_import_external_files,
    files_open, files_read_desktop_files, files_restore_to_desktop,
};
use icons::extract_icon_data_url;
use quick_notes::{
    quick_notes_create_note, quick_notes_delete_note, quick_notes_read_state,
    quick_notes_update_note, QuickNotesStoreState,
};
use shell::{
    apply_drawer_state, apply_window_bounds, close_active_module, ensure_handle_window,
    handle_window_bounds, recover_shell_windows, shell_snapshot, update_active_module,
    update_shell_state, ShellState,
};
use shortcuts::{shortcuts_repair, shortcuts_validate_all, start_shortcut_background_services};
use stickers::{
    open_snip_window, restore_stickers, snip_cancel, snip_complete_selection,
    snip_get_background_image, sticker_close, sticker_copy, sticker_get, sticker_save_as,
    sticker_toggle_pin, SnipCaptureState, StickerStoreState,
};
use todos::{
    todos_create_card, todos_delete_card, todos_get_counts, todos_move_card, todos_read_state,
    todos_update_card, TodoStoreState,
};
use tool_windows::{close_todo_window, open_todo_window};
use updates::{
    updates_check, updates_download, updates_get_metadata, updates_get_state, updates_install,
    UpdaterSessionState,
};

#[tauri::command]
fn events_send(
    state: tauri::State<'_, UserInteractionState>,
    payload: SendEventPayload,
) -> Result<Value, String> {
    match payload.channel.as_str() {
        "user-first-interaction" | "drawer-opened" | "file-dropped" => {}
        _ => return Err(format!("Unsupported send channel: {}", payload.channel)),
    }

    let mut seen = state
        .0
        .lock()
        .map_err(|_| "failed to lock user interaction state".to_string())?;
    let first_time = seen.insert(payload.channel.clone());
    Ok(json!({
        "success": true,
        "channel": payload.channel,
        "firstTime": first_time,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowControlPayload {
    action: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendEventPayload {
    channel: String,
}

#[derive(Debug, Default)]
struct UserInteractionState(Mutex<HashSet<String>>);

#[tauri::command]
fn windows_control(
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
                emit_capture_opened(&app)?;
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
            emit_capture_opened(&app)?;
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
            open_snip_window(&app)?;
        }
        _ => return Err(format!("Unsupported window action: {}", payload.action)),
    }

    Ok(json!({ "success": true }))
}

fn require_command_window(
    window: &WebviewWindow,
    allowed_labels: &[&str],
    command: &str,
) -> Result<(), String> {
    let label = window.label();
    if allowed_labels.iter().any(|allowed| *allowed == label) {
        Ok(())
    } else {
        Err(format!("{command} is not available from window `{label}`"))
    }
}

#[tauri::command]
fn clipboard_read_text(window: WebviewWindow) -> Result<String, String> {
    require_command_window(&window, &["main", "capture"], "clipboard_read_text")?;
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|err| format!("failed to access system clipboard: {err}"))?;
    match clipboard.get_text() {
        Ok(text) => Ok(text),
        Err(_) => Ok(String::new()),
    }
}

#[cfg(any(debug_assertions, feature = "e2e-tests"))]
#[tauri::command]
fn tests_open_files_drawer(
    app: AppHandle,
    shell: tauri::State<'_, ShellState>,
) -> Result<Value, String> {
    if !shell_snapshot(&shell)?.expanded {
        apply_drawer_state(&app, &shell, true)?;
    }
    update_active_module(&app, &shell, Some("files".to_string()))?;
    Ok(json!({ "success": true }))
}

#[cfg(any(debug_assertions, feature = "e2e-tests"))]
#[tauri::command]
fn tests_collapse_drawer(
    app: AppHandle,
    shell: tauri::State<'_, ShellState>,
) -> Result<Value, String> {
    apply_drawer_state(&app, &shell, false)?;
    Ok(json!({ "success": true }))
}

#[cfg(any(debug_assertions, feature = "e2e-tests"))]
#[tauri::command]
fn tests_start_snip(app: AppHandle) -> Result<Value, String> {
    open_snip_window(&app)?;
    Ok(json!({ "success": true }))
}

#[cfg(any(debug_assertions, feature = "e2e-tests"))]
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

#[cfg(any(debug_assertions, feature = "e2e-tests"))]
#[tauri::command]
fn tests_get_window_snapshot(
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
            "appPicker": window_debug_snapshot(&app, "app-picker-poc"),
        }
    }))
}

#[cfg(any(debug_assertions, feature = "e2e-tests"))]
#[tauri::command]
fn tests_reset_window_state(
    app: AppHandle,
    shell: tauri::State<'_, ShellState>,
) -> Result<Value, String> {
    let _ = close_app_picker_poc(app.clone());
    let _ = snip_cancel(app.clone());
    let _ = close_todo_window(app.clone());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }

    update_shell_state(&app, &shell, false, None)?;
    recover_shell_windows(&app)?;
    tests_get_window_snapshot(app, shell)
}

fn emit_capture_opened(app: &AppHandle) -> Result<(), String> {
    let clipboard_text = {
        match arboard::Clipboard::new() {
            Ok(mut cb) => cb.get_text().unwrap_or_default(),
            Err(_) => String::new(),
        }
    };
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

pub fn timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

pub fn drawer_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("drawers"))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

pub fn is_path_inside(child_path: &Path, parent_path: &Path) -> bool {
    let resolved_child = match child_path.canonicalize() {
        Ok(path) => path,
        Err(_) => child_path.to_path_buf(),
    };
    let resolved_parent = match parent_path.canonicalize() {
        Ok(path) => path,
        Err(_) => parent_path.to_path_buf(),
    };
    resolved_child.starts_with(resolved_parent)
}

pub fn prepare_drawer_storage(app: &AppHandle) -> Result<(), String> {
    let root = drawer_root(app)?;
    fs::create_dir_all(&root).map_err(|err| format!("failed to create drawer root: {err}"))?;
    let storage_root = crate::files::file_storage_root(app)?;
    fs::create_dir_all(storage_root)
        .map_err(|err| format!("failed to create storage root: {err}"))?;
    let default_drawer = crate::files::resolve_drawer_path(app, "收纳抽屉")?;
    fs::create_dir_all(default_drawer)
        .map_err(|err| format!("failed to create default drawer: {err}"))?;
    Ok(())
}

#[cfg(any(debug_assertions, feature = "e2e-tests"))]
macro_rules! tidydesk_generate_handler {
    () => {
        tauri::generate_handler![
            probe_go_sidecar,
            apps_scan_metadata,
            apps_scan_installed,
            apps_add_to_drawer,
            files_read_desktop_files,
            files_open,
            files_import_external_files,
            files_restore_to_desktop,
            shortcuts_validate_all,
            shortcuts_repair,
            drawers_create,
            drawers_rename_item,
            drawers_delete_item,
            apps_get_picker_target,
            windows_control,
            tests_open_files_drawer,
            tests_collapse_drawer,
            tests_start_snip,
            tests_get_window_snapshot,
            tests_reset_window_state,
            clipboard_read_text,
            events_send,
            snip_complete_selection,
            snip_cancel,
            snip_get_background_image,
            sticker_get,
            sticker_toggle_pin,
            sticker_copy,
            sticker_save_as,
            sticker_close,
            updates_get_metadata,
            updates_get_state,
            updates_check,
            updates_download,
            updates_install,
            todos_read_state,
            todos_get_counts,
            todos_create_card,
            todos_update_card,
            todos_delete_card,
            todos_move_card,
            quick_notes_read_state,
            quick_notes_create_note,
            quick_notes_update_note,
            quick_notes_delete_note,
            open_todo_window,
            close_todo_window,
            open_app_picker_poc,
            close_app_picker_poc
        ]
    };
}

#[cfg(not(any(debug_assertions, feature = "e2e-tests")))]
macro_rules! tidydesk_generate_handler {
    () => {
        tauri::generate_handler![
            probe_go_sidecar,
            apps_scan_metadata,
            apps_scan_installed,
            apps_add_to_drawer,
            files_read_desktop_files,
            files_open,
            files_import_external_files,
            files_restore_to_desktop,
            shortcuts_validate_all,
            shortcuts_repair,
            drawers_create,
            drawers_rename_item,
            drawers_delete_item,
            apps_get_picker_target,
            windows_control,
            clipboard_read_text,
            events_send,
            snip_complete_selection,
            snip_cancel,
            snip_get_background_image,
            sticker_get,
            sticker_toggle_pin,
            sticker_copy,
            sticker_save_as,
            sticker_close,
            updates_get_metadata,
            updates_get_state,
            updates_check,
            updates_download,
            updates_install,
            todos_read_state,
            todos_get_counts,
            todos_create_card,
            todos_update_card,
            todos_delete_card,
            todos_move_card,
            quick_notes_read_state,
            quick_notes_create_note,
            quick_notes_update_note,
            quick_notes_delete_note,
            open_todo_window,
            close_todo_window,
            open_app_picker_poc,
            close_app_picker_poc
        ]
    };
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppPickerTargetState(Mutex::new("收纳抽屉".to_string())))
        .manage(SidecarState::default())
        .manage(TrustedShortcutState::default())
        .manage(ShellState::default())
        .manage(UserInteractionState::default())
        .manage(StickerStoreState::default())
        .manage(SnipCaptureState::default())
        .manage(TodoStoreState::default())
        .manage(QuickNotesStoreState::default())
        .manage(UpdaterSessionState::default())
        .setup(|app| {
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("TidyDesk")
                .on_menu_event(|app, event| {
                    if event.id().as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;
            let handle = app.handle().clone();
            let _ = ensure_handle_window(&handle);
            if let Ok(bounds) = handle_window_bounds(&handle, false) {
                let _ = apply_window_bounds(&handle, "handle", bounds);
            }
            if let Some(window) = handle.get_webview_window("handle") {
                let _ = window.show();
                let _ = window.set_always_on_top(true);
            }
            let _ = restore_stickers(&handle);
            start_shortcut_background_services(handle.clone());
            Ok(())
        })
        .invoke_handler(tidydesk_generate_handler!())
        .run(tauri::generate_context!())
        .expect("failed to run TidyDesk");
}
