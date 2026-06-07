#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};
use windows::core::{Interface, PCWSTR};
use windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED, STGM_READ,
};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

mod apps;
mod files;
mod icons;
mod quick_notes;
mod shell;
mod shortcuts;
mod stickers;
mod todos;
mod tool_windows;
mod updates;

use apps::{
    apps_add_to_drawer, apps_get_picker_target, apps_scan_installed, apps_scan_metadata,
    close_app_picker_poc, open_app_picker_poc, probe_go_sidecar, AppPickerTargetState,
    SidecarState,
};
use files::{
    drawers_create, drawers_delete_item, drawers_rename_item, files_import_external_files,
    files_open, files_read_desktop_files, files_restore_to_desktop,
};
use icons::extract_icon_data_url;
use quick_notes::{
    quick_notes_create_note, quick_notes_delete_note, quick_notes_read_state,
    quick_notes_update_note,
};
use shell::{
    apply_drawer_state, apply_window_bounds, close_active_module, drawer_window_bounds,
    ensure_handle_window, shell_snapshot, update_active_module, webview_url_for_mode, ShellState,
};
use shortcuts::{shortcuts_repair, shortcuts_validate_all, start_shortcut_background_services};
use stickers::{
    open_snip_window, restore_stickers, snip_cancel, snip_complete_selection, sticker_close,
    sticker_copy, sticker_get, sticker_save_as, sticker_toggle_pin,
};
use todos::{
    todos_create_card, todos_delete_card, todos_get_counts, todos_move_card, todos_read_state,
    todos_update_card,
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

#[tauri::command]
fn clipboard_read_text() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|err| format!("failed to access system clipboard: {err}"))?;
    match clipboard.get_text() {
        Ok(text) => Ok(text),
        Err(_) => Ok(String::new()),
    }
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

#[cfg(windows)]
pub fn write_shortcut_link(
    shortcut_path: &Path,
    target_path: &Path,
    description: &str,
) -> Result<(), String> {
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|err| format!("failed to initialize COM: {err}"))?;
        let result = write_shortcut_link_with_com(shortcut_path, target_path, description);
        CoUninitialize();
        result
    }
}

#[cfg(windows)]
fn write_shortcut_link_with_com(
    shortcut_path: &Path,
    target_path: &Path,
    description: &str,
) -> Result<(), String> {
    unsafe {
        let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|err| format!("failed to create ShellLink: {err}"))?;
        let target_wide: Vec<u16> = target_path
            .display()
            .to_string()
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let working_dir = if target_path.is_dir() {
            target_path
        } else {
            target_path.parent().unwrap_or_else(|| Path::new(""))
        };
        let working_dir_wide: Vec<u16> = working_dir
            .display()
            .to_string()
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let description_wide: Vec<u16> = format!("{}", description)
            .encode_utf16()
            .chain(Some(0))
            .collect();

        shell_link
            .SetPath(PCWSTR(target_wide.as_ptr()))
            .map_err(|err| format!("failed to set shortcut target: {err}"))?;
        shell_link
            .SetWorkingDirectory(PCWSTR(working_dir_wide.as_ptr()))
            .map_err(|err| format!("failed to set shortcut cwd: {err}"))?;
        shell_link
            .SetDescription(PCWSTR(description_wide.as_ptr()))
            .map_err(|err| format!("failed to set shortcut description: {err}"))?;
        let persist_file: IPersistFile = shell_link
            .cast()
            .map_err(|err| format!("failed to query IPersistFile: {err}"))?;
        let shortcut_wide: Vec<u16> = shortcut_path
            .display()
            .to_string()
            .encode_utf16()
            .chain(Some(0))
            .collect();
        persist_file
            .Save(PCWSTR(shortcut_wide.as_ptr()), true)
            .map_err(|err| format!("failed to save shortcut: {err}"))?;
        Ok(())
    }
}

#[cfg(not(windows))]
pub fn write_shortcut_link(
    _shortcut_path: &Path,
    _target_path: &Path,
    _description: &str,
) -> Result<(), String> {
    Err("Creating shortcuts is only implemented for Windows in this PoC".to_string())
}

#[cfg(windows)]
pub fn resolve_shortcut_target(shortcut_path: &str) -> Result<Option<String>, String> {
    let shortcut_path_wide: Vec<u16> = shortcut_path.encode_utf16().chain(Some(0)).collect();
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|err| format!("failed to initialize COM: {err}"))?;
        let result = resolve_shortcut_target_with_com(&shortcut_path_wide);
        CoUninitialize();
        result
    }
}

#[cfg(windows)]
fn resolve_shortcut_target_with_com(shortcut_path_wide: &[u16]) -> Result<Option<String>, String> {
    unsafe {
        let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|err| format!("failed to create ShellLink: {err}"))?;
        let persist_file: IPersistFile = shell_link
            .cast()
            .map_err(|err| format!("failed to query IPersistFile: {err}"))?;
        persist_file
            .Load(PCWSTR(shortcut_path_wide.as_ptr()), STGM_READ)
            .map_err(|err| format!("failed to load shortcut: {err}"))?;

        let mut target = [0u16; 32768];
        let mut find_data = WIN32_FIND_DATAW::default();
        shell_link
            .GetPath(&mut target, &mut find_data, 0)
            .map_err(|err| format!("failed to resolve shortcut target: {err}"))?;
        let end = target
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(target.len());
        if end == 0 {
            return Ok(None);
        }
        Ok(Some(String::from_utf16_lossy(&target[..end])))
    }
}

#[cfg(not(windows))]
pub fn resolve_shortcut_target(_shortcut_path: &str) -> Result<Option<String>, String> {
    Ok(None)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppPickerTargetState(Mutex::new("收纳抽屉".to_string())))
        .manage(SidecarState::default())
        .manage(ShellState::default())
        .manage(UserInteractionState::default())
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
            if let Ok(bounds) = drawer_window_bounds(&handle) {
                let _ = apply_window_bounds(&handle, "main", bounds);
            }
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.hide();
            }
            if let Some(window) = handle.get_webview_window("handle") {
                let _ = window.show();
                let _ = window.set_always_on_top(true);
            }
            let _ = restore_stickers(&handle);
            start_shortcut_background_services(handle.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
        ])
        .run(tauri::generate_context!())
        .expect("failed to run TidyDesk");
}
