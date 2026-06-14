#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

mod apps;
mod apps_classifier;
mod commands;
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
mod paths;

pub use crate::files_rules::{resolve_shortcut_target, write_shortcut_link};
pub use crate::paths::{drawer_root, is_path_inside, prepare_drawer_storage, timestamp_string};

use apps::{
    apps_add_to_drawer, apps_get_picker_target, apps_scan_installed, apps_scan_metadata,
    close_app_picker, open_app_picker, probe_go_sidecar, AppPickerTargetState, SidecarState,
    TrustedShortcutState,
};
use commands::clipboard::clipboard_read_text;
use commands::events::{events_send, UserInteractionState};
#[cfg(any(debug_assertions, feature = "e2e-tests"))]
use commands::tests::{
    tests_collapse_drawer, tests_get_window_snapshot, tests_open_files_drawer,
    tests_reset_window_state, tests_start_snip,
};
use commands::windows::windows_control;
use files::{
    drawers_create, drawers_delete_item, drawers_rename_item, files_import_external_files,
    files_open, files_read_desktop_files, files_restore_to_desktop,
};
use icons::extract_icon_data_url;
use quick_notes::{
    quick_notes_create_note, quick_notes_delete_note, quick_notes_read_state,
    quick_notes_update_note, QuickNotesStoreState,
};
use shell::{apply_window_bounds, ensure_handle_window, handle_window_bounds, ShellState};
use shortcuts::{shortcuts_repair, shortcuts_validate_all, start_shortcut_background_services};
use stickers::{
    restore_stickers, snip_cancel, snip_complete_selection, snip_get_background_image,
    sticker_close, sticker_copy, sticker_get, sticker_save_as, sticker_toggle_pin,
    SnipCaptureState, StickerStoreState,
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
            open_app_picker,
            close_app_picker
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
            open_app_picker,
            close_app_picker
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
