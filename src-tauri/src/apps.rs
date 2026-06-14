use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

#[allow(unused_imports)]
pub use crate::apps_classifier::{
    copy_shortcut_to_drawer, InstalledApp, ScanInstalledResult, ScanMetadataResult,
    ShortcutMetadata,
};

const APP_CACHE_VERSION: &str = "rust-app-scan-v1";
const APP_CACHE_TTL_MILLIS: i64 = 24 * 60 * 60 * 1000;

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

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCacheInfo {
    pub exists: bool,
    #[serde(default)]
    pub valid: bool,
    #[serde(default)]
    pub app_count: usize,
    #[serde(default)]
    pub age_minutes: i64,
    #[serde(default)]
    pub timestamp: Option<i64>,
    #[serde(default)]
    pub version: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppCacheFile {
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    timestamp: Option<i64>,
    #[serde(default)]
    apps: Vec<ShortcutMetadata>,
}

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

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn app_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data dir: {err}"))?
        .join("cache")
        .join("apps.json"))
}

fn load_app_cache(app: &AppHandle) -> Result<Option<AppCacheFile>, String> {
    let path = app_cache_path(app)?;
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str::<AppCacheFile>(&content)
            .map(Some)
            .map_err(|err| format!("failed to parse app cache: {err}")),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("failed to read app cache: {err}")),
    }
}

fn write_app_cache(app: &AppHandle, metadata: &ScanMetadataResult) -> Result<(), String> {
    let path = app_cache_path(app)?;
    let cache = AppCacheFile {
        version: Some(APP_CACHE_VERSION.to_string()),
        timestamp: Some(now_millis()),
        apps: metadata.shortcuts.clone(),
    };
    crate::persistence::atomic_write_json(&path, &cache, "app cache")
}

fn read_cached_installed_apps(
    app: &AppHandle,
    trusted_shortcuts: &State<'_, TrustedShortcutState>,
) -> Result<ScanInstalledResult, String> {
    let cache = load_app_cache(app)?.ok_or_else(|| "App cache is missing".to_string())?;
    let metadata = ScanMetadataResult {
        shortcuts: cache.apps,
        scanned_paths: Vec::new(),
        duration_ms: 0,
    };
    let result = crate::apps_classifier::complete_installed_apps(metadata);
    remember_trusted_shortcuts(
        trusted_shortcuts,
        result.apps.iter().map(|app| app.shortcut_path.clone()),
    )?;
    Ok(result)
}

fn scan_installed_apps(
    app: &AppHandle,
    trusted_shortcuts: &State<'_, TrustedShortcutState>,
) -> Result<ScanInstalledResult, String> {
    let metadata = crate::apps_classifier::scan_shortcut_metadata();
    if let Err(err) = write_app_cache(app, &metadata) {
        eprintln!("[TIDYDESK] Failed to write app cache: {err}");
    }
    let result = crate::apps_classifier::complete_installed_apps(metadata);
    remember_trusted_shortcuts(
        trusted_shortcuts,
        result.apps.iter().map(|app| app.shortcut_path.clone()),
    )?;
    Ok(result)
}

#[tauri::command]
pub fn apps_scan_metadata(
    app: AppHandle,
    trusted_shortcuts: State<'_, TrustedShortcutState>,
) -> Result<Value, String> {
    let metadata = crate::apps_classifier::scan_shortcut_metadata();
    if let Err(err) = write_app_cache(&app, &metadata) {
        eprintln!("[TIDYDESK] Failed to write app cache: {err}");
    }
    remember_trusted_shortcuts(
        &trusted_shortcuts,
        metadata
            .shortcuts
            .iter()
            .filter_map(|shortcut| shortcut.shortcut_path.clone()),
    )?;
    serde_json::to_value(metadata).map_err(|err| format!("failed to serialize app metadata: {err}"))
}

#[tauri::command]
pub fn apps_scan_installed(
    app: AppHandle,
    trusted_shortcuts: State<'_, TrustedShortcutState>,
) -> Result<ScanInstalledResult, String> {
    if let Ok(cache_info) = apps_cache_info(app.clone()) {
        if cache_info.exists && cache_info.valid {
            return read_cached_installed_apps(&app, &trusted_shortcuts);
        }
    }
    scan_installed_apps(&app, &trusted_shortcuts)
}

#[tauri::command]
pub fn apps_read_cache(
    app: AppHandle,
    trusted_shortcuts: State<'_, TrustedShortcutState>,
) -> Result<ScanInstalledResult, String> {
    let cache_info = apps_cache_info(app.clone())?;
    if !cache_info.exists || !cache_info.valid {
        return Err("App cache is missing or expired".to_string());
    }
    read_cached_installed_apps(&app, &trusted_shortcuts)
}

#[tauri::command]
pub fn apps_refresh_installed(
    app: AppHandle,
    trusted_shortcuts: State<'_, TrustedShortcutState>,
) -> Result<ScanInstalledResult, String> {
    scan_installed_apps(&app, &trusted_shortcuts)
}

#[tauri::command]
pub fn apps_cache_info(app: AppHandle) -> Result<AppCacheInfo, String> {
    let Some(cache) = load_app_cache(&app)? else {
        return Ok(AppCacheInfo {
            exists: false,
            valid: false,
            app_count: 0,
            age_minutes: 0,
            timestamp: None,
            version: None,
        });
    };

    let timestamp = cache.timestamp.unwrap_or_default();
    let age_millis = now_millis().saturating_sub(timestamp);
    Ok(AppCacheInfo {
        exists: true,
        valid: timestamp > 0 && age_millis < APP_CACHE_TTL_MILLIS,
        app_count: cache.apps.len(),
        age_minutes: age_millis / 60_000,
        timestamp: cache.timestamp,
        version: cache.version,
    })
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
pub fn open_app_picker(
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
pub fn close_app_picker(app: AppHandle) -> Result<(), String> {
    crate::tool_windows::close_app_picker_window(app)
}
