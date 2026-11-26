#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

mod accounts;
mod apps;
mod apps_classifier;
mod asset_protocol;
mod backup;
mod capture;
mod commands;
mod files;
mod files_rules;
mod hotkeys;
mod icons;
mod local_db;
mod paths;
mod persistence;
mod quick_notes;
mod resident;
mod shell;
mod shortcuts;
mod stickers;
mod sticky_notes;
mod sync;
mod todos;
mod tool_windows;
mod updates;
mod workspace_runtime;

pub use crate::files_rules::{resolve_shortcut_target, write_shortcut_link, ShortcutResolver};
pub use crate::paths::{
    drawer_root, is_path_inside, is_path_inside_resolved, prepare_drawer_storage,
    resolve_path_for_comparison, timestamp_string,
};

use accounts::{
    accounts_change_password, accounts_create_workspace, accounts_create_workspace_invite,
    accounts_get_session, accounts_import_local_todos, accounts_join_workspace_by_invite,
    accounts_list_remote_sessions, accounts_list_workspace_invites,
    accounts_list_workspace_members, accounts_list_workspaces, accounts_login_with_password,
    accounts_logout_to_local, accounts_register_with_password, accounts_revoke_remote_session,
    accounts_revoke_workspace_invite, accounts_switch_session, AccountSessionState,
};
use apps::{
    apps_add_to_drawer, apps_cache_info, apps_get_picker_target, apps_refresh_installed,
    apps_scan_installed, close_app_picker, open_app_picker, AppPickerTargetState,
    TrustedShortcutState,
};
use backup::{
    backup_create_snapshot, backup_list_snapshots, backup_restore_snapshot, backup_verify_snapshot,
};
use capture::{snip_cancel, snip_complete_selection, snip_get_background_image, SnipCaptureState};
use commands::clipboard::clipboard_read_text;
use commands::events::{events_send, UserInteractionState};
#[cfg(any(debug_assertions, feature = "e2e-tests"))]
use commands::tests::{
    tests_collapse_drawer, tests_get_window_snapshot, tests_open_files_drawer,
    tests_reset_window_state, tests_start_snip,
};
use commands::windows::{windows_control, windows_drawer_ready, windows_get_shell_state};
use files::{
    drawers_create, drawers_delete_item, drawers_rename_item, files_import_external_files,
    files_open, files_read_desktop_files, files_read_icons, files_restore_to_desktop,
};
use hotkeys::{
    hotkeys_get_settings, hotkeys_reset_defaults, hotkeys_update_binding, hotkeys_validate_binding,
    HotkeyRuntimeState,
};
use quick_notes::{
    quick_notes_create_note, quick_notes_delete_note, quick_notes_read_state,
    quick_notes_update_note, QuickNotesStoreState,
};
use resident::{
    resident_get_settings, resident_hide_handle, resident_open_settings, resident_show_handle,
    resident_update_settings,
};
use shell::{apply_window_bounds, ensure_handle_window, handle_window_bounds, ShellState};
use shortcuts::{
    shortcuts_repair, shortcuts_validate_all, start_shortcut_background_services,
    ShortcutWatcherState,
};
use stickers::{
    schedule_restore_stickers, sticker_close, sticker_copy, sticker_get, sticker_save_as,
    sticker_toggle_pin, StickerStoreState,
};
use sticky_notes::{
    schedule_restore_sticky_notes, sticky_notes_list, sticky_notes_open, sticky_notes_unpin,
    sticky_notes_update_options, StickyNotesStoreState, StickyRuntimeState,
};
use sync::{
    sync_clear_outbox, sync_get_status, sync_list_outbox, sync_run_once, sync_set_realtime_enabled,
    SyncExecutionLockState, SyncOutboxState, SyncRealtimeState,
};
use todos::{
    todos_add_attachment_bytes, todos_add_card_comment, todos_create_card, todos_delete_attachment,
    todos_delete_card, todos_delete_card_comment, todos_get_card_detail, todos_get_counts,
    todos_get_unread_comment_summary, todos_list_card_comments, todos_mark_all_comments_read,
    todos_mark_card_comments_read, todos_move_card, todos_pick_and_add_attachment,
    todos_read_state, todos_set_card_cover, todos_start_snip_for_card,
    todos_update_attachment_meta, todos_update_card, TodoStoreState,
};
use tool_windows::{
    close_todo_window, open_todo_window, todos_consume_pending_focus_card, TodoFocusCardState,
};
use updates::{
    updates_cancel_download, updates_check, updates_download, updates_get_metadata,
    updates_get_state, updates_install, UpdaterSessionState,
};

#[cfg(any(debug_assertions, feature = "e2e-tests"))]
macro_rules! tidydesk_generate_handler {
    () => {
        tauri::generate_handler![
            apps_cache_info,
            apps_scan_installed,
            apps_refresh_installed,
            apps_add_to_drawer,
            files_read_desktop_files,
            files_read_icons,
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
            windows_get_shell_state,
            windows_drawer_ready,
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
            updates_cancel_download,
            updates_install,
            todos_read_state,
            todos_get_counts,
            todos_create_card,
            todos_update_card,
            todos_delete_card,
            todos_move_card,
            todos_get_card_detail,
            todos_add_attachment_bytes,
            todos_pick_and_add_attachment,
            todos_delete_attachment,
            todos_set_card_cover,
            todos_update_attachment_meta,
            todos_start_snip_for_card,
            todos_list_card_comments,
            todos_add_card_comment,
            todos_delete_card_comment,
            todos_get_unread_comment_summary,
            todos_mark_card_comments_read,
            todos_mark_all_comments_read,
            todos_consume_pending_focus_card,
            accounts_get_session,
            accounts_switch_session,
            accounts_login_with_password,
            accounts_register_with_password,
            accounts_change_password,
            accounts_list_remote_sessions,
            accounts_revoke_remote_session,
            accounts_list_workspaces,
            accounts_list_workspace_members,
            accounts_create_workspace,
            accounts_create_workspace_invite,
            accounts_list_workspace_invites,
            accounts_revoke_workspace_invite,
            accounts_join_workspace_by_invite,
            accounts_logout_to_local,
            accounts_import_local_todos,
            sync_get_status,
            sync_list_outbox,
            sync_clear_outbox,
            sync_run_once,
            sync_set_realtime_enabled,
            quick_notes_read_state,
            quick_notes_create_note,
            quick_notes_update_note,
            quick_notes_delete_note,
            sticky_notes_list,
            sticky_notes_open,
            sticky_notes_unpin,
            sticky_notes_update_options,
            resident_get_settings,
            resident_update_settings,
            resident_show_handle,
            resident_hide_handle,
            resident_open_settings,
            hotkeys_get_settings,
            hotkeys_validate_binding,
            hotkeys_update_binding,
            hotkeys_reset_defaults,
            open_todo_window,
            close_todo_window,
            open_app_picker,
            close_app_picker,
            backup_list_snapshots,
            backup_create_snapshot,
            backup_verify_snapshot,
            backup_restore_snapshot
        ]
    };
}

#[cfg(not(any(debug_assertions, feature = "e2e-tests")))]
macro_rules! tidydesk_generate_handler {
    () => {
        tauri::generate_handler![
            apps_cache_info,
            apps_scan_installed,
            apps_refresh_installed,
            apps_add_to_drawer,
            files_read_desktop_files,
            files_read_icons,
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
            windows_get_shell_state,
            windows_drawer_ready,
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
            updates_cancel_download,
            updates_install,
            todos_read_state,
            todos_get_counts,
            todos_create_card,
            todos_update_card,
            todos_delete_card,
            todos_move_card,
            todos_get_card_detail,
            todos_add_attachment_bytes,
            todos_pick_and_add_attachment,
            todos_delete_attachment,
            todos_set_card_cover,
            todos_update_attachment_meta,
            todos_start_snip_for_card,
            todos_list_card_comments,
            todos_add_card_comment,
            todos_delete_card_comment,
            todos_get_unread_comment_summary,
            todos_mark_card_comments_read,
            todos_mark_all_comments_read,
            todos_consume_pending_focus_card,
            accounts_get_session,
            accounts_switch_session,
            accounts_login_with_password,
            accounts_register_with_password,
            accounts_change_password,
            accounts_list_remote_sessions,
            accounts_revoke_remote_session,
            accounts_list_workspaces,
            accounts_list_workspace_members,
            accounts_create_workspace,
            accounts_create_workspace_invite,
            accounts_list_workspace_invites,
            accounts_revoke_workspace_invite,
            accounts_join_workspace_by_invite,
            accounts_logout_to_local,
            accounts_import_local_todos,
            sync_get_status,
            sync_list_outbox,
            sync_clear_outbox,
            sync_run_once,
            sync_set_realtime_enabled,
            quick_notes_read_state,
            quick_notes_create_note,
            quick_notes_update_note,
            quick_notes_delete_note,
            sticky_notes_list,
            sticky_notes_open,
            sticky_notes_unpin,
            sticky_notes_update_options,
            resident_get_settings,
            resident_update_settings,
            resident_show_handle,
            resident_hide_handle,
            resident_open_settings,
            hotkeys_get_settings,
            hotkeys_validate_binding,
            hotkeys_update_binding,
            hotkeys_reset_defaults,
            open_todo_window,
            close_todo_window,
            open_app_picker,
            close_app_picker,
            backup_list_snapshots,
            backup_create_snapshot,
            backup_verify_snapshot,
            backup_restore_snapshot
        ]
    };
}

fn main() {
    let result = tauri::Builder::default()
        .register_uri_scheme_protocol("tidydesk-asset", |ctx, request| {
            asset_protocol::handle_asset_request(ctx.app_handle(), request.uri().path())
        })
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = crate::resident::show_handle_window(app);
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("TidyDesk")
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppPickerTargetState(Mutex::new("收纳抽屉".to_string())))
        .manage(TrustedShortcutState::default())
        .manage(ShortcutWatcherState::default())
        .manage(ShellState::default())
        .manage(UserInteractionState::default())
        .manage(StickerStoreState::default())
        .manage(SnipCaptureState::default())
        .manage(TodoStoreState::default())
        .manage(TodoFocusCardState::default())
        .manage(AccountSessionState::default())
        .manage(SyncOutboxState::default())
        .manage(SyncExecutionLockState::default())
        .manage(SyncRealtimeState::default())
        .manage(QuickNotesStoreState::default())
        .manage(StickyNotesStoreState::default())
        .manage(StickyRuntimeState::default())
        .manage(UpdaterSessionState::default())
        .manage(HotkeyRuntimeState::default())
        .setup(|app| {
            let show_handle =
                MenuItem::with_id(app, "show_handle", "显示桌面把手", true, None::<&str>)?;
            let hide_handle =
                MenuItem::with_id(app, "hide_handle", "隐藏到托盘", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_handle, &hide_handle, &settings, &quit])?;
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("TidyDesk")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show_handle" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            let _ = crate::resident::show_handle_window(&app_handle);
                        });
                    }
                    "hide_handle" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            let _ = crate::resident::hide_handle_window(&app_handle);
                        });
                    }
                    "settings" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            let _ = crate::resident::open_resident_settings(&app_handle);
                        });
                    }
                    "quit" => {
                        crate::sticky_notes::mark_app_exiting(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app_handle = tray.app_handle().clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            let _ = crate::resident::show_handle_window(&app_handle);
                        });
                    }
                })
                .build(app)?;
            let handle = app.handle().clone();
            let resident_settings = resident::read_resident_settings(&handle);
            shortcuts::set_shortcut_background_monitoring(
                &handle,
                resident_settings.background_monitor_enabled,
            );
            if resident_settings.auto_update_check_enabled {
                updates::start_update_auto_check(
                    handle.clone(),
                    std::time::Duration::from_secs(15),
                );
            }
            hotkeys::register_configured_hotkeys(&handle);
            let _ = ensure_handle_window(&handle);
            if let Ok(bounds) = handle_window_bounds(&handle, false) {
                let _ = apply_window_bounds(&handle, "handle", bounds);
            }
            if !resident_settings.launch_minimized {
                if let Some(window) = handle.get_webview_window("handle") {
                    let _ = window.show();
                    let _ = window.set_always_on_top(true);
                }
            }
            schedule_restore_stickers(handle.clone());
            schedule_restore_sticky_notes(handle.clone());
            start_shortcut_background_services(handle.clone());
            sync::schedule_restore_realtime_sync(handle.clone());
            Ok(())
        })
        .invoke_handler(tidydesk_generate_handler!())
        .build(tauri::generate_context!());
    match result {
        Ok(app) => {
            app.run(|app_handle, event| {
                if matches!(
                    event,
                    tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
                ) {
                    crate::sticky_notes::mark_app_exiting(app_handle);
                }
            });
        }
        Err(err) => {
            eprintln!("[TIDYDESK] failed to run TidyDesk: {err}");
            std::process::exit(1);
        }
    }
}
