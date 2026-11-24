use super::accelerator::{display_accelerator, validate_binding, HotkeyValidationResult};
use super::runtime::{
    register_action_shortcut, registered_accelerator, runtime_status, set_runtime_status,
    unregister_registered_accelerator, HotkeyRegistrationStatus, RuntimeHotkeyBinding,
};
use super::store::{
    action_label, all_actions, default_binding, read_hotkey_settings, update_stored_binding,
    write_hotkey_settings, HotkeyAction, HotkeySettingsFile,
};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

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
pub struct HotkeyUpdateResult {
    success: bool,
    reason: Option<String>,
    message: String,
    settings: HotkeySettingsPayload,
}

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
    let mut final_result: Option<HotkeyUpdateResult> = None;
    for action in all_actions().into_iter().rev() {
        let def = default_binding(action);
        let res = hotkeys_update_binding(
            app.clone(),
            HotkeyBindingUpdatePayload {
                action: def.action,
                accelerator: def.accelerator,
                enabled: def.enabled,
            },
        )?;
        let failed = !res.success;
        final_result = Some(res);
        if failed {
            break;
        }
    }
    Ok(final_result.unwrap_or_else(|| HotkeyUpdateResult {
        success: true,
        reason: None,
        message: "已恢复默认快捷键".to_string(),
        settings: HotkeySettingsPayload {
            version: 1,
            bindings: Vec::new(),
        },
    }))
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
