use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const HOTKEY_SETTINGS_FILE: &str = "hotkeys.json";
const HOTKEY_SETTINGS_VERSION: u32 = 1;
const DEFAULT_PASTE_PENDING_STICKER: &str = "ctrl+alt+v";

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HotkeyAction {
    PastePendingSticker,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredHotkeyBinding {
    action: HotkeyAction,
    accelerator: Option<String>,
    enabled: bool,
    updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HotkeySettingsFile {
    version: u32,
    bindings: Vec<StoredHotkeyBinding>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyBindingPayload {
    action: HotkeyAction,
    label: String,
    accelerator: Option<String>,
    display_accelerator: Option<String>,
    enabled: bool,
    status: HotkeyRegistrationStatus,
    status_message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeySettingsPayload {
    version: u32,
    bindings: Vec<HotkeyBindingPayload>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyBindingUpdatePayload {
    action: HotkeyAction,
    accelerator: Option<String>,
    enabled: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyBindingValidationPayload {
    action: HotkeyAction,
    accelerator: Option<String>,
    enabled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyValidationResult {
    valid: bool,
    reason: Option<String>,
    message: String,
    normalized_accelerator: Option<String>,
    display_accelerator: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyUpdateResult {
    success: bool,
    reason: Option<String>,
    message: String,
    settings: HotkeySettingsPayload,
}

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
struct RuntimeHotkeyBinding {
    registered_accelerator: Option<String>,
    status: HotkeyRegistrationStatus,
    message: Option<String>,
}

#[derive(Debug, Default)]
pub struct HotkeyRuntimeState(Mutex<HashMap<HotkeyAction, RuntimeHotkeyBinding>>);

#[tauri::command]
pub fn hotkeys_get_settings(app: AppHandle) -> Result<HotkeySettingsPayload, String> {
    let settings = read_hotkey_settings(&app)?;
    Ok(settings_payload(&app, &settings))
}

#[tauri::command]
pub fn hotkeys_validate_binding(
    app: AppHandle,
    payload: HotkeyBindingValidationPayload,
) -> Result<HotkeyValidationResult, String> {
    let settings = read_hotkey_settings(&app)?;
    validate_binding(
        &settings,
        &payload.action,
        payload.accelerator.as_deref(),
        payload.enabled,
    )
}

#[tauri::command]
pub fn hotkeys_update_binding(
    app: AppHandle,
    payload: HotkeyBindingUpdatePayload,
) -> Result<HotkeyUpdateResult, String> {
    let mut settings = read_hotkey_settings(&app)?;
    let validation = validate_binding(
        &settings,
        &payload.action,
        payload.accelerator.as_deref(),
        payload.enabled,
    )?;
    if !validation.valid {
        return Ok(HotkeyUpdateResult {
            success: false,
            reason: validation.reason,
            message: validation.message,
            settings: settings_payload(&app, &settings),
        });
    }

    let normalized = validation.normalized_accelerator.clone();
    let old_registered = registered_accelerator(&app, &payload.action)?;
    unregister_registered_accelerator(&app, old_registered.as_deref());

    if payload.enabled {
        if let Some(accelerator) = normalized.as_deref() {
            if let Err(err) = register_action_shortcut(&app, payload.action.clone(), accelerator) {
                if let Some(old_accelerator) = old_registered.as_deref() {
                    if let Err(rollback_err) =
                        register_action_shortcut(&app, payload.action.clone(), old_accelerator)
                    {
                        set_runtime_status(
                            &app,
                            payload.action.clone(),
                            RuntimeHotkeyBinding {
                                registered_accelerator: None,
                                status: HotkeyRegistrationStatus::Conflict,
                                message: Some(format!(
                                    "新快捷键注册失败，旧快捷键恢复也失败: {rollback_err}"
                                )),
                            },
                        )?;
                    }
                }
                return Ok(HotkeyUpdateResult {
                    success: false,
                    reason: Some("externalConflict".to_string()),
                    message: format!(
                        "{} 系统或其他应用已占用，无法注册: {err}",
                        validation
                            .display_accelerator
                            .as_deref()
                            .unwrap_or("该快捷键")
                    ),
                    settings: settings_payload(&app, &settings),
                });
            }
            set_runtime_status(
                &app,
                payload.action.clone(),
                RuntimeHotkeyBinding {
                    registered_accelerator: Some(accelerator.to_string()),
                    status: HotkeyRegistrationStatus::Registered,
                    message: Some("快捷键已生效".to_string()),
                },
            )?;
        }
    } else {
        set_runtime_status(
            &app,
            payload.action.clone(),
            RuntimeHotkeyBinding {
                registered_accelerator: None,
                status: HotkeyRegistrationStatus::Disabled,
                message: Some("快捷键已关闭".to_string()),
            },
        )?;
    }

    update_stored_binding(
        &mut settings,
        payload.action,
        normalized,
        payload.enabled,
        crate::timestamp_string(),
    );
    write_hotkey_settings(&app, &settings)?;
    let settings = settings_payload(&app, &settings);
    Ok(HotkeyUpdateResult {
        success: true,
        reason: None,
        message: "快捷键已生效，无需重启".to_string(),
        settings,
    })
}

#[tauri::command]
pub fn hotkeys_reset_defaults(app: AppHandle) -> Result<HotkeyUpdateResult, String> {
    hotkeys_update_binding(
        app,
        HotkeyBindingUpdatePayload {
            action: HotkeyAction::PastePendingSticker,
            accelerator: Some(DEFAULT_PASTE_PENDING_STICKER.to_string()),
            enabled: true,
        },
    )
}

pub fn register_configured_hotkeys(app: &AppHandle) {
    crate::stickers::clear_pending_sticker_cache(app);
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

fn register_action_shortcut(
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
            if let Err(err) = crate::stickers::paste_pending_sticker(app) {
                eprintln!("[TIDYDESK] Failed to paste pending sticker: {err}");
                crate::stickers::notify_sticker_message(app, "截图贴纸失败", &err);
            }
        }
    }
}

fn validate_binding(
    settings: &HotkeySettingsFile,
    action: &HotkeyAction,
    accelerator: Option<&str>,
    enabled: bool,
) -> Result<HotkeyValidationResult, String> {
    if !enabled {
        return Ok(HotkeyValidationResult {
            valid: true,
            reason: None,
            message: "快捷键已关闭".to_string(),
            normalized_accelerator: None,
            display_accelerator: None,
        });
    }
    let Some(raw) = accelerator.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(invalid_result("empty", "启用时必须设置快捷键"));
    };
    let normalized = match normalize_accelerator(raw) {
        Ok(value) => value,
        Err(message) => return Ok(invalid_result("invalidFormat", &message)),
    };
    if let Some(conflicting_action) = settings.bindings.iter().find_map(|binding| {
        if &binding.action == action || !binding.enabled {
            return None;
        }
        let binding_accelerator = binding.accelerator.as_deref()?;
        if binding_accelerator.eq_ignore_ascii_case(&normalized) {
            Some(binding.action.clone())
        } else {
            None
        }
    }) {
        return Ok(HotkeyValidationResult {
            valid: false,
            reason: Some("internalConflict".to_string()),
            message: format!("已被“{}”使用", action_label(&conflicting_action)),
            normalized_accelerator: Some(normalized.clone()),
            display_accelerator: Some(display_accelerator(&normalized)),
        });
    }
    Ok(HotkeyValidationResult {
        valid: true,
        reason: None,
        message: "这个快捷键可以使用".to_string(),
        normalized_accelerator: Some(normalized.clone()),
        display_accelerator: Some(display_accelerator(&normalized)),
    })
}

fn invalid_result(reason: &str, message: &str) -> HotkeyValidationResult {
    HotkeyValidationResult {
        valid: false,
        reason: Some(reason.to_string()),
        message: message.to_string(),
        normalized_accelerator: None,
        display_accelerator: None,
    }
}

fn normalize_accelerator(raw: &str) -> Result<String, String> {
    let normalized_raw = raw
        .replace(' ', "")
        .replace('-', "+")
        .replace('_', "+")
        .to_ascii_lowercase();
    let mut ctrl = false;
    let mut alt = false;
    let mut shift = false;
    let mut meta = false;
    let mut key: Option<String> = None;
    for part in normalized_raw.split('+').filter(|value| !value.is_empty()) {
        match part {
            "ctrl" | "control" => ctrl = true,
            "alt" | "option" => alt = true,
            "shift" => shift = true,
            "meta" | "cmd" | "command" | "super" | "win" | "windows" => meta = true,
            value => {
                if key.is_some() {
                    return Err("只支持一个主键".to_string());
                }
                key = Some(normalize_main_key(value)?);
            }
        }
    }
    let Some(key) = key else {
        return Err("请按 Ctrl 或 Alt + 一个主键".to_string());
    };
    if !ctrl && !alt {
        return Err("请至少使用 Ctrl 或 Alt + 一个主键".to_string());
    }
    let accelerator = build_accelerator(ctrl, alt, shift, meta, &key);
    if is_reserved_accelerator(&accelerator) {
        return Err("该组合键是系统或常用操作保留快捷键".to_string());
    }
    Ok(accelerator)
}

fn normalize_main_key(value: &str) -> Result<String, String> {
    if value.len() == 1 && value.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return Ok(value.to_string());
    }
    let key = match value {
        "esc" | "escape" => "escape",
        "enter" | "return" => "enter",
        "space" | "spacebar" => "space",
        "del" | "delete" => "delete",
        "backspace" => "backspace",
        "tab" => "tab",
        "up" | "arrowup" => "arrowup",
        "down" | "arrowdown" => "arrowdown",
        "left" | "arrowleft" => "arrowleft",
        "right" | "arrowright" => "arrowright",
        "home" => "home",
        "end" => "end",
        "pageup" => "pageup",
        "pagedown" => "pagedown",
        function_key if is_function_key(function_key) => function_key,
        _ => return Err("不支持该主键".to_string()),
    };
    Ok(key.to_string())
}

fn is_function_key(value: &str) -> bool {
    let Some(number) = value.strip_prefix('f') else {
        return false;
    };
    number
        .parse::<u8>()
        .map(|index| (1..=24).contains(&index))
        .unwrap_or(false)
}

fn build_accelerator(ctrl: bool, alt: bool, shift: bool, meta: bool, key: &str) -> String {
    let mut parts = Vec::new();
    if ctrl {
        parts.push("ctrl");
    }
    if alt {
        parts.push("alt");
    }
    if shift {
        parts.push("shift");
    }
    if meta {
        parts.push("meta");
    }
    parts.push(key);
    parts.join("+")
}

fn is_reserved_accelerator(accelerator: &str) -> bool {
    matches!(
        accelerator,
        "ctrl+alt+delete"
            | "alt+tab"
            | "meta+l"
            | "ctrl+escape"
            | "ctrl+c"
            | "ctrl+v"
            | "ctrl+x"
            | "ctrl+s"
            | "ctrl+a"
            | "ctrl+p"
            | "ctrl+z"
            | "ctrl+y"
    )
}

fn display_accelerator(accelerator: &str) -> String {
    accelerator
        .split('+')
        .map(|part| match part {
            "ctrl" => "Ctrl".to_string(),
            "alt" => "Alt".to_string(),
            "shift" => "Shift".to_string(),
            "meta" => "Win".to_string(),
            "escape" => "Esc".to_string(),
            "arrowup" => "↑".to_string(),
            "arrowdown" => "↓".to_string(),
            "arrowleft" => "←".to_string(),
            "arrowright" => "→".to_string(),
            "pageup" => "PageUp".to_string(),
            "pagedown" => "PageDown".to_string(),
            value if value.len() == 1 => value.to_ascii_uppercase(),
            value => value.to_string(),
        })
        .collect::<Vec<_>>()
        .join("+")
}

fn action_label(action: &HotkeyAction) -> &'static str {
    match action {
        HotkeyAction::PastePendingSticker => "贴出最近截图",
    }
}

fn settings_payload(app: &AppHandle, settings: &HotkeySettingsFile) -> HotkeySettingsPayload {
    HotkeySettingsPayload {
        version: settings.version,
        bindings: settings
            .bindings
            .iter()
            .map(|binding| {
                let runtime = runtime_status(app, &binding.action).unwrap_or_default();
                HotkeyBindingPayload {
                    action: binding.action.clone(),
                    label: action_label(&binding.action).to_string(),
                    accelerator: binding.accelerator.clone(),
                    display_accelerator: binding.accelerator.as_deref().map(display_accelerator),
                    enabled: binding.enabled,
                    status: runtime.status,
                    status_message: runtime.message,
                }
            })
            .collect(),
    }
}

fn read_hotkey_settings(app: &AppHandle) -> Result<HotkeySettingsFile, String> {
    ensure_hotkey_storage(app)?;
    let path = hotkey_settings_path(app)?;
    let raw = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            let settings = default_hotkey_settings();
            write_hotkey_settings(app, &settings)?;
            return Ok(settings);
        }
        Err(err) => return Err(format!("failed to read hotkey settings: {err}")),
    };
    match serde_json::from_str::<HotkeySettingsFile>(&raw) {
        Ok(settings) => Ok(normalize_settings(settings)),
        Err(err) => {
            let backup_path = crate::persistence::backup_corrupt_file(&path, "hotkey settings")?;
            eprintln!(
                "[TIDYDESK] Backed up corrupt hotkey settings to {}: {err}",
                backup_path.display()
            );
            let settings = default_hotkey_settings();
            write_hotkey_settings(app, &settings)?;
            Ok(settings)
        }
    }
}

fn write_hotkey_settings(app: &AppHandle, settings: &HotkeySettingsFile) -> Result<(), String> {
    crate::persistence::atomic_write_json(&hotkey_settings_path(app)?, settings, "hotkey settings")
}

fn normalize_settings(settings: HotkeySettingsFile) -> HotkeySettingsFile {
    let mut bindings = Vec::new();
    for action in all_actions() {
        if let Some(binding) = settings
            .bindings
            .iter()
            .find(|binding| binding.action == action)
        {
            bindings.push(binding.clone());
        } else {
            bindings.push(default_binding(action));
        }
    }
    HotkeySettingsFile {
        version: HOTKEY_SETTINGS_VERSION,
        bindings,
    }
}

fn default_hotkey_settings() -> HotkeySettingsFile {
    HotkeySettingsFile {
        version: HOTKEY_SETTINGS_VERSION,
        bindings: all_actions().into_iter().map(default_binding).collect(),
    }
}

fn default_binding(action: HotkeyAction) -> StoredHotkeyBinding {
    let accelerator = match action {
        HotkeyAction::PastePendingSticker => Some(DEFAULT_PASTE_PENDING_STICKER.to_string()),
    };
    StoredHotkeyBinding {
        action,
        accelerator,
        enabled: true,
        updated_at: crate::timestamp_string(),
    }
}

fn all_actions() -> Vec<HotkeyAction> {
    vec![HotkeyAction::PastePendingSticker]
}

fn update_stored_binding(
    settings: &mut HotkeySettingsFile,
    action: HotkeyAction,
    accelerator: Option<String>,
    enabled: bool,
    updated_at: String,
) {
    if let Some(binding) = settings
        .bindings
        .iter_mut()
        .find(|binding| binding.action == action)
    {
        binding.accelerator = accelerator;
        binding.enabled = enabled;
        binding.updated_at = updated_at;
        return;
    }
    settings.bindings.push(StoredHotkeyBinding {
        action,
        accelerator,
        enabled,
        updated_at,
    });
}

fn ensure_hotkey_storage(app: &AppHandle) -> Result<(), String> {
    fs::create_dir_all(hotkey_root(app)?)
        .map_err(|err| format!("failed to create hotkey storage: {err}"))
}

fn hotkey_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("hotkeys"))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

fn hotkey_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(hotkey_root(app)?.join(HOTKEY_SETTINGS_FILE))
}

fn registered_accelerator(
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

fn unregister_registered_accelerator(app: &AppHandle, accelerator: Option<&str>) {
    if let Some(accelerator) = accelerator {
        if app.global_shortcut().is_registered(accelerator) {
            if let Err(err) = app.global_shortcut().unregister(accelerator) {
                eprintln!("[TIDYDESK] Failed to unregister hotkey {accelerator}: {err}");
            }
        }
    }
}

fn runtime_status(app: &AppHandle, action: &HotkeyAction) -> Result<RuntimeHotkeyBinding, String> {
    let state = app.state::<HotkeyRuntimeState>();
    let registry = state
        .0
        .lock()
        .map_err(|_| "failed to lock hotkey runtime state".to_string())?;
    Ok(registry.get(action).cloned().unwrap_or_default())
}

fn set_runtime_status(
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
