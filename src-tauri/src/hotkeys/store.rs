use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const HOTKEY_SETTINGS_FILE: &str = "hotkeys.json";
pub(super) const HOTKEY_SETTINGS_VERSION: u32 = 1;
pub(super) const DEFAULT_PASTE_PENDING_STICKER: &str = "ctrl+alt+v";

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HotkeyAction {
    PastePendingSticker,
    ToggleQuickCapture,
    NewStickyNote,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredHotkeyBinding {
    pub action: HotkeyAction,
    pub accelerator: Option<String>,
    pub enabled: bool,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HotkeySettingsFile {
    pub version: u32,
    pub bindings: Vec<StoredHotkeyBinding>,
}

pub(super) fn action_label(action: &HotkeyAction) -> &'static str {
    match action {
        HotkeyAction::PastePendingSticker => "贴出最近截图",
        HotkeyAction::ToggleQuickCapture => "打开/收起快捷记录",
        HotkeyAction::NewStickyNote => "一键新建桌面便签",
    }
}

fn parse_hotkey_settings_tolerant(raw: &str) -> Result<HotkeySettingsFile, serde_json::Error> {
    let mut doc: serde_json::Value = serde_json::from_str(raw)?;
    if let Some(bindings) = doc.get_mut("bindings").and_then(|v| v.as_array_mut()) {
        bindings.retain(|item| {
            item.get("action").and_then(|v| v.as_str()) != Some("toggle_files_drawer")
        });
    }
    serde_json::from_value(doc)
}

pub(super) fn read_hotkey_settings(app: &AppHandle) -> Result<HotkeySettingsFile, String> {
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
    match parse_hotkey_settings_tolerant(&raw) {
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

pub(super) fn write_hotkey_settings(
    app: &AppHandle,
    settings: &HotkeySettingsFile,
) -> Result<(), String> {
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

pub(super) fn default_binding(action: HotkeyAction) -> StoredHotkeyBinding {
    let (accelerator, enabled) = match action {
        HotkeyAction::PastePendingSticker => {
            (Some(DEFAULT_PASTE_PENDING_STICKER.to_string()), true)
        }
        HotkeyAction::ToggleQuickCapture | HotkeyAction::NewStickyNote => (None, false),
    };
    StoredHotkeyBinding {
        action,
        accelerator,
        enabled,
        updated_at: crate::timestamp_string(),
    }
}

pub(super) fn all_actions() -> Vec<HotkeyAction> {
    vec![
        HotkeyAction::PastePendingSticker,
        HotkeyAction::ToggleQuickCapture,
        HotkeyAction::NewStickyNote,
    ]
}

pub(super) fn update_stored_binding(
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

pub(crate) fn hotkey_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(hotkey_root(app)?.join(HOTKEY_SETTINGS_FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_toggle_files_drawer_is_ignored_without_wiping_other_hotkeys() {
        let raw = r#"{
            "version": 1,
            "bindings": [
                { "action": "paste_pending_sticker", "accelerator": "ctrl+shift+v", "enabled": true, "updatedAt": "100" },
                { "action": "toggle_files_drawer", "accelerator": "alt+d", "enabled": true, "updatedAt": "100" }
            ]
        }"#;
        let parsed = parse_hotkey_settings_tolerant(raw).expect("legacy hotkeys json should parse");
        let normalized = normalize_settings(parsed);
        assert_eq!(normalized.bindings.len(), 3);
        let paste = normalized
            .bindings
            .iter()
            .find(|item| item.action == HotkeyAction::PastePendingSticker)
            .expect("paste binding preserved");
        assert_eq!(paste.accelerator.as_deref(), Some("ctrl+shift+v"));
        assert!(paste.enabled);
    }
}
