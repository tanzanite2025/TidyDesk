use super::store::{read_hotkey_settings, HotkeyAction, StoredHotkeyBinding};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HotkeyRegistrationStatus {
    Registered,
    Conflict,
    Disabled,
    #[default]
    Unset,
}

#[derive(Clone, Debug, Default)]
pub(super) struct RuntimeHotkeyBinding {
    pub registered_accelerator: Option<String>,
    pub status: HotkeyRegistrationStatus,
    pub message: Option<String>,
}

#[derive(Debug, Default)]
pub struct HotkeyRuntimeState(Mutex<HashMap<HotkeyAction, RuntimeHotkeyBinding>>);

pub fn register_configured_hotkeys(app: &AppHandle) {
    crate::capture::clear_pending_sticker_cache(app);
    match read_hotkey_settings(app) {
        Ok(settings) => {
            for binding in settings.bindings {
                register_stored_binding(app, binding);
            }
        }
        Err(err) => eprintln!("[TIDYDESK] Failed to read hotkey settings: {err}"),
    }
}

fn register_stored_binding(app: &AppHandle, binding: StoredHotkeyBinding) {
    if !binding.enabled {
        let _ = set_runtime_status(
            app,
            binding.action,
            RuntimeHotkeyBinding {
                registered_accelerator: None,
                status: HotkeyRegistrationStatus::Disabled,
                message: Some("快捷键已关闭".to_string()),
            },
        );
        return;
    }
    let Some(accelerator) = binding.accelerator else {
        let _ = set_runtime_status(
            app,
            binding.action,
            RuntimeHotkeyBinding {
                registered_accelerator: None,
                status: HotkeyRegistrationStatus::Unset,
                message: Some("未设置快捷键".to_string()),
            },
        );
        return;
    };
    match register_action_shortcut(app, binding.action.clone(), &accelerator) {
        Ok(()) => {
            let _ = set_runtime_status(
                app,
                binding.action,
                RuntimeHotkeyBinding {
                    registered_accelerator: Some(accelerator),
                    status: HotkeyRegistrationStatus::Registered,
                    message: Some("快捷键已生效".to_string()),
                },
            );
        }
        Err(err) => {
            let _ = set_runtime_status(
                app,
                binding.action,
                RuntimeHotkeyBinding {
                    registered_accelerator: None,
                    status: HotkeyRegistrationStatus::Conflict,
                    message: Some(format!("系统或其他应用已占用: {err}")),
                },
            );
        }
    }
}

pub(super) fn register_action_shortcut(
    app: &AppHandle,
    action: HotkeyAction,
    accelerator: &str,
) -> Result<(), String> {
    let callback_action = action.clone();
    app.global_shortcut()
        .on_shortcut(accelerator, move |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                handle_hotkey_action(app, &callback_action);
            }
        })
        .map_err(|err| err.to_string())
}

fn handle_hotkey_action(app: &AppHandle, action: &HotkeyAction) {
    match action {
        HotkeyAction::PastePendingSticker => {
            if let Err(err) = crate::capture::paste_pending_sticker(app) {
                eprintln!("[TIDYDESK] Failed to paste pending sticker: {err}");
                crate::stickers::notify_sticker_message(app, "截图贴纸失败", &err);
            }
        }
        HotkeyAction::ToggleQuickCapture => {
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) =
                    crate::tool_windows::open_or_toggle_capture_window(&app_clone, true).await
                {
                    eprintln!("[TIDYDESK] Failed to toggle quick capture via hotkey: {err}");
                }
            });
        }
        HotkeyAction::ToggleFilesDrawer => {
            let app_clone = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let shell = app_clone.state::<crate::shell::ShellState>();
                let expanded = crate::shell::shell_snapshot(&shell)
                    .map(|snap| snap.expanded)
                    .unwrap_or(false);
                if let Err(err) = crate::shell::apply_drawer_state(&app_clone, &shell, !expanded) {
                    eprintln!("[TIDYDESK] Failed to toggle files drawer via hotkey: {err}");
                }
            });
        }
        HotkeyAction::NewStickyNote => {
            let app_clone = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                match crate::quick_notes::create_blank_sticky_note(&app_clone) {
                    Ok(note_id) => {
                        if let Err(err) =
                            crate::sticky_notes::open_sticky_note_sync(&app_clone, &note_id)
                        {
                            eprintln!(
                                "[TIDYDESK] Failed to open new sticky note via hotkey: {err}"
                            );
                        }
                    }
                    Err(err) => {
                        eprintln!("[TIDYDESK] Failed to create sticky note via hotkey: {err}");
                    }
                }
            });
        }
    }
}

pub(super) fn registered_accelerator(
    app: &AppHandle,
    action: &HotkeyAction,
) -> Result<Option<String>, String> {
    let state = app.state::<HotkeyRuntimeState>();
    let registry = state
        .0
        .lock()
        .map_err(|_| "failed to lock hotkey runtime state".to_string())?;
    Ok(registry
        .get(action)
        .and_then(|binding| binding.registered_accelerator.clone()))
}

pub(super) fn unregister_registered_accelerator(app: &AppHandle, accelerator: Option<&str>) {
    if let Some(accelerator) = accelerator {
        if app.global_shortcut().is_registered(accelerator) {
            if let Err(err) = app.global_shortcut().unregister(accelerator) {
                eprintln!("[TIDYDESK] Failed to unregister hotkey {accelerator}: {err}");
            }
        }
    }
}

pub(super) fn runtime_status(
    app: &AppHandle,
    action: &HotkeyAction,
) -> Result<RuntimeHotkeyBinding, String> {
    let state = app.state::<HotkeyRuntimeState>();
    let registry = state
        .0
        .lock()
        .map_err(|_| "failed to lock hotkey runtime state".to_string())?;
    Ok(registry.get(action).cloned().unwrap_or_default())
}

pub(super) fn set_runtime_status(
    app: &AppHandle,
    action: HotkeyAction,
    status: RuntimeHotkeyBinding,
) -> Result<(), String> {
    let state = app.state::<HotkeyRuntimeState>();
    let mut registry = state
        .0
        .lock()
        .map_err(|_| "failed to lock hotkey runtime state".to_string())?;
    registry.insert(action, status);
    Ok(())
}
