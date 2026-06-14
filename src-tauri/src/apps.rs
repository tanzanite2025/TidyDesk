use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use tauri::AppHandle;
use tauri::State;

// 重新导出 sidecar 模块和分类模块相关的公共定义与服务，确保对主模块的 API 100% 兼容
#[allow(unused_imports)]
pub use crate::apps_classifier::{
    copy_shortcut_to_drawer, InstalledApp, ScanInstalledResult, ScanMetadataResult,
    ShortcutMetadata,
};
pub use crate::sidecar_client::{SidecarProbeResult, SidecarState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddAppToDrawerResult {
    pub success: bool,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddAppToDrawerPayload {
    pub shortcut_path: String,
    pub target_folder: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAppPickerPayload {
    pub target_folder: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPickerTargetResult {
    pub target_folder: String,
}

#[derive(Debug)]
pub struct AppPickerTargetState(pub std::sync::Mutex<String>);

#[derive(Debug, Default)]
pub struct TrustedShortcutState(pub std::sync::Mutex<HashSet<String>>);

fn shortcut_key(shortcut_path: &Path) -> Result<String, String> {
    let canonical = shortcut_path
        .canonicalize()
        .map_err(|err| format!("failed to resolve shortcut path: {err}"))?;
    Ok(canonical.to_string_lossy().to_ascii_lowercase())
}

fn remember_trusted_shortcuts(
    state: &State<'_, TrustedShortcutState>,
    shortcut_paths: impl Iterator<Item = String>,
) -> Result<(), String> {
    let mut trusted = HashSet::new();
    for shortcut_path in shortcut_paths {
        let path = Path::new(&shortcut_path);
        if let Ok(key) = shortcut_key(path) {
            trusted.insert(key);
        }
    }

    let mut current = state
        .0
        .lock()
        .map_err(|_| "failed to lock trusted shortcuts".to_string())?;
    *current = trusted;
    Ok(())
}

fn require_trusted_shortcut(
    state: &State<'_, TrustedShortcutState>,
    shortcut_path: &Path,
) -> Result<(), String> {
    let key = shortcut_key(shortcut_path)?;
    let trusted = state
        .0
        .lock()
        .map_err(|_| "failed to lock trusted shortcuts".to_string())?;
    if trusted.contains(&key) {
        Ok(())
    } else {
        Err("Shortcut must come from the latest trusted app scan".to_string())
    }
}

#[tauri::command]
pub fn probe_go_sidecar(app: AppHandle) -> Result<SidecarProbeResult, String> {
    let executable_path = crate::sidecar_client::resolve_sidecar_path(&app)?;
    let ping = crate::sidecar_client::sidecar_request(&app, "ping")?;
    let version = crate::sidecar_client::sidecar_request(&app, "sidecar.version")?;
    let health = crate::sidecar_client::sidecar_request(&app, "sidecar.health")?;

    Ok(SidecarProbeResult {
        executable_path: executable_path.display().to_string(),
        ping,
        version,
        health,
    })
}

#[tauri::command]
pub fn apps_scan_metadata(
    app: AppHandle,
    trusted_shortcuts: State<'_, TrustedShortcutState>,
) -> Result<Value, String> {
    let metadata_value = crate::sidecar_client::sidecar_request_with_params(
        &app,
        "apps.scanMetadata",
        crate::apps_classifier::scan_metadata_params(),
    )?;
    let metadata: ScanMetadataResult = serde_json::from_value(metadata_value.clone())
        .map_err(|err| format!("failed to parse apps.scanMetadata result: {err}"))?;
    remember_trusted_shortcuts(
        &trusted_shortcuts,
        metadata
            .shortcuts
            .iter()
            .filter_map(|shortcut| shortcut.shortcut_path.clone()),
    )?;
    Ok(metadata_value)
}

#[tauri::command]
pub fn apps_scan_installed(
    app: AppHandle,
    trusted_shortcuts: State<'_, TrustedShortcutState>,
) -> Result<ScanInstalledResult, String> {
    let metadata_value = crate::sidecar_client::sidecar_request_with_params(
        &app,
        "apps.scanMetadata",
        crate::apps_classifier::scan_metadata_params(),
    )?;
    let metadata: ScanMetadataResult = serde_json::from_value(metadata_value)
        .map_err(|err| format!("failed to parse apps.scanMetadata result: {err}"))?;
    let result = crate::apps_classifier::complete_installed_apps(metadata);
    remember_trusted_shortcuts(
        &trusted_shortcuts,
        result.apps.iter().map(|app| app.shortcut_path.clone()),
    )?;
    Ok(result)
}

#[tauri::command]
pub fn apps_add_to_drawer(
    app: AppHandle,
    trusted_shortcuts: State<'_, TrustedShortcutState>,
    payload: AddAppToDrawerPayload,
) -> Result<AddAppToDrawerResult, String> {
    let shortcut_path = Path::new(&payload.shortcut_path);
    require_trusted_shortcut(&trusted_shortcuts, shortcut_path)?;
    let target_dir = crate::files::resolve_drawer_path(&app, &payload.target_folder)?;
    fs::create_dir_all(&target_dir).map_err(|err| format!("failed to create drawer: {err}"))?;
    let destination = copy_shortcut_to_drawer(shortcut_path, &target_dir)?;

    Ok(AddAppToDrawerResult {
        success: true,
        path: destination.display().to_string(),
    })
}

#[tauri::command]
pub fn open_app_picker_poc(
    app: AppHandle,
    state: State<'_, AppPickerTargetState>,
    payload: Option<OpenAppPickerPayload>,
) -> Result<(), String> {
    crate::tool_windows::open_app_picker_window(app, state, payload)
}

#[tauri::command]
pub fn apps_get_picker_target(
    state: State<'_, AppPickerTargetState>,
) -> Result<AppPickerTargetResult, String> {
    let target_folder = state
        .0
        .lock()
        .map_err(|_| "failed to lock app picker target".to_string())?
        .clone();
    Ok(AppPickerTargetResult { target_folder })
}

#[tauri::command]
pub fn close_app_picker_poc(app: AppHandle) -> Result<(), String> {
    crate::tool_windows::close_app_picker_window(app)
}
