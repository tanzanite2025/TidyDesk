use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, State};

#[allow(unused_imports)]
pub use crate::apps_classifier::{
    copy_shortcut_to_drawer, AppCacheInfo, AppIconUpdate, InstalledApp, ScanInstalledResult,
    ScanMetadataResult,
};

const APP_ICON_UPDATE_EVENT: &str = "apps-icons-updated";
const APP_ICON_BATCH_SIZE: usize = 24;
static APP_ICON_GENERATION: AtomicU64 = AtomicU64::new(0);

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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIconsUpdatedPayload {
    pub icons: Vec<AppIconUpdate>,
    pub complete: bool,
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

fn emit_icon_batch(app: &AppHandle, icons: Vec<AppIconUpdate>, complete: bool) {
    if let Err(err) = app.emit(
        APP_ICON_UPDATE_EVENT,
        AppIconsUpdatedPayload { icons, complete },
    ) {
        eprintln!("[TIDYDESK] Failed to emit app icon update: {err}");
    }
}

fn spawn_app_icon_updates(app: &AppHandle, apps: &[InstalledApp]) {
    let generation = APP_ICON_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    if apps.is_empty() {
        emit_icon_batch(app, Vec::new(), true);
        return;
    }

    let app_handle = app.clone();
    let apps = apps.to_vec();
    tauri::async_runtime::spawn_blocking(move || {
        let mut batch = Vec::with_capacity(APP_ICON_BATCH_SIZE);
        for installed_app in apps {
            if APP_ICON_GENERATION.load(Ordering::Acquire) != generation {
                return;
            }
            let update =
                crate::apps_classifier::app_icon_update_cached(&app_handle, &installed_app);
            if update.icon.is_some() {
                batch.push(update);
            }

            if batch.len() >= APP_ICON_BATCH_SIZE {
                emit_icon_batch(&app_handle, std::mem::take(&mut batch), false);
            }
        }

        if APP_ICON_GENERATION.load(Ordering::Acquire) == generation {
            emit_icon_batch(&app_handle, batch, true);
        }
    });
}

fn scan_installed_metadata(app: &AppHandle) -> ScanMetadataResult {
    let metadata = crate::apps_classifier::scan_shortcut_metadata();
    if let Err(err) = crate::apps_classifier::write_app_cache(app, &metadata) {
        eprintln!("[TIDYDESK] Failed to write app cache: {err}");
    }
    metadata
}

async fn read_cached_metadata_background(
    app: AppHandle,
) -> Result<Option<ScanMetadataResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::apps_classifier::read_valid_cached_metadata(&app)
    })
    .await
    .map_err(|err| format!("app cache task failed: {err}"))?
}

async fn scan_installed_metadata_background(app: AppHandle) -> Result<ScanMetadataResult, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(scan_installed_metadata(&app)))
        .await
        .map_err(|err| format!("app scan task failed: {err}"))?
}

#[tauri::command]
pub async fn apps_scan_installed(
    app: AppHandle,
    trusted_shortcuts: State<'_, TrustedShortcutState>,
) -> Result<ScanInstalledResult, String> {
    let metadata = match read_cached_metadata_background(app.clone()).await? {
        Some(cached) => cached,
        None => scan_installed_metadata_background(app.clone()).await?,
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::apps_classifier::complete_installed_apps(metadata)
    })
    .await
    .map_err(|err| format!("complete installed apps task failed: {err}"))?;
    remember_trusted_shortcuts(
        &trusted_shortcuts,
        result.apps.iter().map(|item| item.shortcut_path.clone()),
    )?;
    spawn_app_icon_updates(&app, &result.apps);
    Ok(result)
}

#[tauri::command]
pub async fn apps_refresh_installed(
    app: AppHandle,
    trusted_shortcuts: State<'_, TrustedShortcutState>,
) -> Result<ScanInstalledResult, String> {
    let metadata = scan_installed_metadata_background(app.clone()).await?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::apps_classifier::complete_installed_apps(metadata)
    })
    .await
    .map_err(|err| format!("complete installed apps task failed: {err}"))?;
    remember_trusted_shortcuts(
        &trusted_shortcuts,
        result.apps.iter().map(|item| item.shortcut_path.clone()),
    )?;
    spawn_app_icon_updates(&app, &result.apps);
    Ok(result)
}

#[tauri::command]
pub fn apps_cache_info(app: AppHandle) -> Result<AppCacheInfo, String> {
    crate::apps_classifier::app_cache_info(&app)
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
    if let Err(err) = app.emit("drawer-files-changed", ()) {
        eprintln!("[TIDYDESK] Failed to emit drawer-files-changed: {err}");
    }

    Ok(AddAppToDrawerResult {
        success: true,
        path: destination.display().to_string(),
    })
}

#[tauri::command]
pub async fn open_app_picker(
    app: AppHandle,
    payload: Option<OpenAppPickerPayload>,
) -> Result<(), String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::tool_windows::open_app_picker_window(&app_handle, payload)
    })
    .await
    .map_err(|err| format!("open app picker task failed: {err}"))?
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
pub async fn close_app_picker(app: AppHandle) -> Result<(), String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::tool_windows::close_app_picker_window(&app_handle)
    })
    .await
    .map_err(|err| format!("close app picker task failed: {err}"))?
}
