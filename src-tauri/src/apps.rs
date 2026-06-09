use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::Path;
use tauri::State;
use tauri::AppHandle;

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
pub fn apps_scan_metadata(app: AppHandle) -> Result<Value, String> {
    crate::sidecar_client::sidecar_request_with_params(
        &app,
        "apps.scanMetadata",
        crate::apps_classifier::scan_metadata_params(),
    )
}

#[tauri::command]
pub fn apps_scan_installed(app: AppHandle) -> Result<ScanInstalledResult, String> {
    let metadata_value = crate::sidecar_client::sidecar_request_with_params(
        &app,
        "apps.scanMetadata",
        crate::apps_classifier::scan_metadata_params(),
    )?;
    let metadata: ScanMetadataResult = serde_json::from_value(metadata_value)
        .map_err(|err| format!("failed to parse apps.scanMetadata result: {err}"))?;
    Ok(crate::apps_classifier::complete_installed_apps(metadata))
}

#[tauri::command]
pub fn apps_add_to_drawer(
    app: AppHandle,
    payload: AddAppToDrawerPayload,
) -> Result<AddAppToDrawerResult, String> {
    let shortcut_path = Path::new(&payload.shortcut_path);
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
