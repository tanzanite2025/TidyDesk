use super::store::{action_label, HotkeyAction, HotkeySettingsFile};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyValidationResult {
    pub valid: bool,
    pub reason: Option<String>,
    pub message: String,
    pub normalized_accelerator: Option<String>,
    pub display_accelerator: Option<String>,
}

pub(super) fn validate_binding(
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

pub(super) fn display_accelerator(accelerator: &str) -> String {
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
