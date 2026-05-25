use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};
use url::Url;
use windows::core::{Interface, PCWSTR};
use windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED, STGM_READ,
};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

mod icons;
mod stickers;
mod tool_windows;
mod quick_notes;
mod updates;

use icons::extract_icon_data_url;
use quick_notes::{
    quick_notes_create_note, quick_notes_delete_note, quick_notes_read_state,
    quick_notes_update_note,
};
use stickers::{
    open_snip_window, restore_stickers, snip_cancel, snip_complete_selection, sticker_close,
    sticker_copy, sticker_get, sticker_save_as, sticker_toggle_pin,
};
use tool_windows::{close_todo_window, open_todo_window};
use updates::{
    updates_check, updates_download, updates_get_metadata, updates_get_state, updates_install,
    UpdaterSessionState,
};

const TARGET_FILE_DELETED_EVENT: &str = "target-file-deleted";
const TARGET_FILE_RESTORED_EVENT: &str = "target-file-restored";
const SHORTCUTS_VALIDATED_EVENT: &str = "shortcuts-validated";
const SHORTCUT_WATCH_POLL_INTERVAL: Duration = Duration::from_secs(10);
const SHORTCUT_VALIDATION_INTERVAL: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Serialize, Deserialize)]
struct RpcResponse {
    id: String,
    ok: bool,
    #[serde(default)]
    data: Value,
    #[serde(default)]
    error: String,
}

fn validate_shortcut(shortcut_path: &Path) -> ShortcutValidationResult {
    let target_path = resolve_shortcut_target(&shortcut_path.display().to_string())
        .ok()
        .flatten()
        .filter(|value| !value.is_empty());

    match target_path {
        Some(target_path) => ShortcutValidationResult {
            is_valid: Path::new(&target_path).exists(),
            target_path: Some(target_path),
        },
        None => ShortcutValidationResult {
            is_valid: false,
            target_path: None,
        },
    }
}

#[tauri::command]
fn events_send(
    state: tauri::State<'_, UserInteractionState>,
    payload: SendEventPayload,
) -> Result<Value, String> {
    match payload.channel.as_str() {
        "user-first-interaction" | "drawer-opened" | "file-dropped" => {}
        _ => return Err(format!("Unsupported send channel: {}", payload.channel)),
    }

    let mut seen = state
        .0
        .lock()
        .map_err(|_| "failed to lock user interaction state".to_string())?;
    let first_time = seen.insert(payload.channel.clone());
    Ok(json!({
        "success": true,
        "channel": payload.channel,
        "firstTime": first_time,
    }))
}

fn attempt_shortcut_repair(
    shortcut_path: &Path,
    target_path: &str,
) -> Result<RepairShortcutResult, String> {
    if target_path.trim().is_empty() {
        return Ok(RepairShortcutResult {
            repaired: false,
            new_path: None,
        });
    }

    let Some(file_name) = Path::new(target_path).file_name() else {
        return Ok(RepairShortcutResult {
            repaired: false,
            new_path: None,
        });
    };

    for search_path in shortcut_repair_search_paths() {
        let possible_path = search_path.join(file_name);
        if !possible_path.exists() {
            continue;
        }

        let description = format!(
            "TidyDesk shortcut for {} (auto-repaired)",
            possible_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("file")
        );

        match write_shortcut_link(shortcut_path, &possible_path, &description) {
            Ok(()) => {
                return Ok(RepairShortcutResult {
                    repaired: true,
                    new_path: Some(possible_path.display().to_string()),
                });
            }
            Err(err) => {
                eprintln!(
                    "[TIDYDESK] Failed to repair shortcut {} with {}: {}",
                    shortcut_path.display(),
                    possible_path.display(),
                    err
                );
            }
        }
    }

    Ok(RepairShortcutResult {
        repaired: false,
        new_path: None,
    })
}

fn shortcut_repair_search_paths() -> Vec<PathBuf> {
    let Ok(profile) = std::env::var("USERPROFILE") else {
        return Vec::new();
    };

    ["Desktop", "Documents", "Downloads", "Pictures", "Videos"]
        .into_iter()
        .map(|segment| Path::new(&profile).join(segment))
        .collect()
}

#[derive(Debug)]
struct ShortcutValidationResult {
    is_valid: bool,
    target_path: Option<String>,
}

#[derive(Debug, Clone)]
struct ShortcutWatchEntry {
    shortcut_count: usize,
    exists: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarProbeResult {
    executable_path: String,
    ping: Value,
    version: Value,
    health: Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutMetadata {
    name: Option<String>,
    shortcut_path: Option<String>,
    category: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanMetadataResult {
    shortcuts: Vec<ShortcutMetadata>,
    scanned_paths: Vec<String>,
    duration_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledApp {
    name: String,
    shortcut_path: String,
    target_path: String,
    icon: Option<String>,
    category: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanInstalledResult {
    apps: Vec<InstalledApp>,
    metadata: ScanMetadataResult,
    skipped_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddAppToDrawerPayload {
    shortcut_path: String,
    target_folder: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenAppPickerPayload {
    target_folder: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowControlPayload {
    action: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTodoCardPayload {
    title: Option<String>,
    content: Option<String>,
    column_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTodoCardPayload {
    id: String,
    title: Option<String>,
    content: Option<String>,
    column_id: Option<String>,
    tags: Option<Vec<String>>,
    archived: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveTodoCardPayload {
    id: String,
    column_id: String,
    before_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameItemPayload {
    old_name: String,
    new_name: String,
    parent_folder: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteItemPayload {
    name: String,
    parent_folder: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenFilePayload {
    file_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendEventPayload {
    channel: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportExternalFilesPayload {
    file_paths: Vec<String>,
    target_folder: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedFileResult {
    source: String,
    shortcut: String,
    mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportExternalFilesResult {
    success: bool,
    added: Vec<ImportedFileResult>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreToDesktopPayload {
    shortcut_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepairShortcutPayload {
    shortcut_path: String,
    target_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreToDesktopResult {
    success: bool,
    restored_path: String,
}

#[derive(Debug, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct ShortcutValidationStats {
    total: usize,
    valid: usize,
    invalid: usize,
    repaired: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepairShortcutResult {
    repaired: bool,
    new_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppPickerTargetResult {
    target_folder: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AddAppToDrawerResult {
    success: bool,
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopFile {
    id: String,
    name: String,
    path: String,
    size: u64,
    category: String,
    extension: String,
    modified_at: String,
    is_simulated: bool,
    parent_id: Option<String>,
    is_valid: Option<bool>,
    target_path: Option<String>,
    icon: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopFolder {
    id: String,
    name: String,
    path: String,
    category: String,
    modified_at: String,
    is_simulated: bool,
    parent_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopFilesResult {
    files: Vec<DesktopFile>,
    folders: Vec<DesktopFolder>,
    desktop_path: String,
    tidy_box_path: String,
}

#[derive(Debug)]
struct AppPickerTargetState(Mutex<String>);

#[derive(Debug, Clone)]
struct ShellWindowSnapshot {
    expanded: bool,
    active_module: Option<String>,
}

#[derive(Debug)]
struct DrawerWindowState(Mutex<bool>);

#[derive(Debug)]
struct ModuleWindowState(Mutex<Option<String>>);

#[derive(Debug, Default)]
struct UserInteractionState(Mutex<HashSet<String>>);

#[tauri::command]
fn probe_go_sidecar(app: AppHandle) -> Result<SidecarProbeResult, String> {
    let sidecar_path = resolve_sidecar_path(&app)?;
    let ping = sidecar_request(&sidecar_path, "ping")?;
    let version = sidecar_request(&sidecar_path, "sidecar.version")?;
    let health = sidecar_request(&sidecar_path, "sidecar.health")?;

    Ok(SidecarProbeResult {
        executable_path: sidecar_path.display().to_string(),
        ping,
        version,
        health,
    })
}

#[tauri::command]
fn apps_scan_metadata(app: AppHandle) -> Result<Value, String> {
    let sidecar_path = resolve_sidecar_path(&app)?;
    sidecar_request_with_params(&sidecar_path, "apps.scanMetadata", scan_metadata_params())
}

#[tauri::command]
fn apps_scan_installed(app: AppHandle) -> Result<ScanInstalledResult, String> {
    let sidecar_path = resolve_sidecar_path(&app)?;
    let metadata_value =
        sidecar_request_with_params(&sidecar_path, "apps.scanMetadata", scan_metadata_params())?;
    let metadata: ScanMetadataResult = serde_json::from_value(metadata_value)
        .map_err(|err| format!("failed to parse apps.scanMetadata result: {err}"))?;
    Ok(complete_installed_apps(metadata))
}

#[tauri::command]
fn apps_add_to_drawer(
    app: AppHandle,
    payload: AddAppToDrawerPayload,
) -> Result<AddAppToDrawerResult, String> {
    let shortcut_path = Path::new(&payload.shortcut_path);
    if payload.shortcut_path.trim().is_empty() {
        return Err("Missing shortcut path".to_string());
    }
    if !shortcut_path.exists() {
        return Err("Shortcut does not exist".to_string());
    }
    if shortcut_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("lnk"))
        != Some(true)
    {
        return Err("Only .lnk shortcuts can be added to a drawer".to_string());
    }

    let target_dir = resolve_drawer_path(&app, &payload.target_folder)?;
    fs::create_dir_all(&target_dir).map_err(|err| format!("failed to create drawer: {err}"))?;
    let file_name = shortcut_path
        .file_name()
        .ok_or_else(|| "Invalid shortcut path".to_string())?;
    let destination = next_available_path(&target_dir, file_name);
    fs::copy(shortcut_path, &destination)
        .map_err(|err| format!("failed to copy shortcut to drawer: {err}"))?;

    Ok(AddAppToDrawerResult {
        success: true,
        path: destination.display().to_string(),
    })
}

#[tauri::command]
fn files_read_desktop_files(app: AppHandle) -> Result<DesktopFilesResult, String> {
    prepare_drawer_storage(&app)?;

    let desktop_path = PathBuf::from(desktop_path());
    let drawer_root = drawer_root(&app)?;
    let mut files = Vec::new();
    let mut folders = Vec::new();
    let mut file_counter = 0usize;
    let mut folder_counter = 0usize;

    if desktop_path.exists() {
        let desktop_entries = fs::read_dir(&desktop_path)
            .map_err(|err| format!("failed to read desktop directory: {err}"))?;
        for entry in desktop_entries {
            let entry = entry.map_err(|err| format!("failed to read desktop item: {err}"))?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if is_protected_desktop_item(&name) {
                continue;
            }
            let metadata = entry
                .metadata()
                .map_err(|err| format!("failed to inspect desktop item: {err}"))?;
            let extension = file_extension(&path);
            file_counter += 1;
            files.push(DesktopFile {
                id: format!(
                    "desktop-file-{file_counter}-{}",
                    path_identity(&path, &metadata)
                ),
                name: name.clone(),
                path: path.display().to_string(),
                size: metadata.len(),
                category: category_by_extension(&extension, &name),
                extension,
                modified_at: modified_at(&metadata),
                is_simulated: false,
                parent_id: None,
                is_valid: None,
                target_path: None,
                icon: extract_icon_data_url(&path),
            });
        }
    }

    let drawer_entries =
        fs::read_dir(&drawer_root).map_err(|err| format!("failed to read drawers: {err}"))?;
    for item in drawer_entries {
        let item = item.map_err(|err| format!("failed to read drawer item: {err}"))?;
        let drawer_path = item.path();
        if !drawer_path.is_dir() {
            continue;
        }

        let drawer_name = item.file_name().to_string_lossy().to_string();
        let drawer_metadata = item
            .metadata()
            .map_err(|err| format!("failed to inspect drawer: {err}"))?;
        folder_counter += 1;
        let folder_id = format!(
            "drawer-{folder_counter}-{}",
            path_identity(&drawer_path, &drawer_metadata)
        );
        folders.push(DesktopFolder {
            id: folder_id.clone(),
            name: drawer_name,
            path: drawer_path.display().to_string(),
            category: "folder".to_string(),
            modified_at: modified_at(&drawer_metadata),
            is_simulated: false,
            parent_id: None,
        });

        let entries = fs::read_dir(&drawer_path)
            .map_err(|err| format!("failed to read drawer entries: {err}"))?;
        for entry in entries {
            let entry = entry.map_err(|err| format!("failed to read drawer entry: {err}"))?;
            let entry_path = entry.path();
            if !entry_path.is_file() {
                continue;
            }

            let entry_name = entry.file_name().to_string_lossy().to_string();
            let entry_metadata = entry
                .metadata()
                .map_err(|err| format!("failed to inspect drawer entry: {err}"))?;
            let extension = file_extension(&entry_path);
            let mut display_name = entry_name.clone();
            let mut is_valid = None;
            let mut target_path = None;

            if extension.eq_ignore_ascii_case(".lnk") {
                display_name = entry_path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or(&entry_name)
                    .to_string();
                let resolved = resolve_shortcut_target(&entry_path.display().to_string())
                    .ok()
                    .flatten();
                is_valid = Some(
                    resolved
                        .as_deref()
                        .map(|value| Path::new(value).exists())
                        .unwrap_or(false),
                );
                target_path = resolved;
            }

            let icon_source_path = target_path
                .as_ref()
                .map(PathBuf::from)
                .filter(|value| value.exists())
                .unwrap_or_else(|| entry_path.clone());

            file_counter += 1;
            files.push(DesktopFile {
                id: format!(
                    "drawer-file-{file_counter}-{}",
                    path_identity(&entry_path, &entry_metadata)
                ),
                name: display_name,
                path: entry_path.display().to_string(),
                size: entry_metadata.len(),
                category: category_by_extension(&extension, &entry_name),
                extension,
                modified_at: modified_at(&entry_metadata),
                is_simulated: false,
                parent_id: Some(folder_id.clone()),
                is_valid,
                target_path,
                icon: extract_icon_data_url(&icon_source_path),
            });
        }
    }

    Ok(DesktopFilesResult {
        files,
        folders,
        desktop_path: desktop_path.display().to_string(),
        tidy_box_path: drawer_root.display().to_string(),
    })
}

#[tauri::command]
fn drawers_create(app: AppHandle, name: String) -> Result<Value, String> {
    let target_path = resolve_drawer_path(&app, &name)?;
    fs::create_dir_all(&target_path).map_err(|err| format!("failed to create drawer: {err}"))?;
    Ok(json!({
        "success": true,
        "path": target_path.display().to_string()
    }))
}

#[tauri::command]
fn drawers_rename_item(app: AppHandle, payload: RenameItemPayload) -> Result<Value, String> {
    if payload.old_name.trim().is_empty() || payload.new_name.trim().is_empty() {
        return Err("oldName and newName are required".to_string());
    }

    if let Some(parent_folder) = payload.parent_folder.as_deref() {
        let drawer_path = resolve_drawer_path(&app, parent_folder)?;
        let old_path = resolve_drawer_entry_path(&app, parent_folder, &payload.old_name)?;
        let new_name =
            safe_drawer_entry_name(&drawer_entry_rename_target(&old_path, &payload.new_name))?;
        let new_path = drawer_path.join(new_name);
        if !is_path_inside(&new_path, &drawer_path) {
            return Err("Unsafe rename path".to_string());
        }
        if !old_path.exists() {
            return Err("Drawer entry does not exist".to_string());
        }
        let target_path = next_available_path(
            &drawer_path,
            new_path
                .file_name()
                .ok_or_else(|| "Invalid rename target".to_string())?,
        );
        fs::rename(&old_path, target_path)
            .map_err(|err| format!("failed to rename item: {err}"))?;
        return Ok(json!({ "success": true }));
    }

    let old_path = resolve_drawer_path(&app, &payload.old_name)?;
    let new_path = resolve_drawer_path(&app, &payload.new_name)?;
    let root = drawer_root(&app)?;
    if !is_path_inside(&old_path, &root) || !is_path_inside(&new_path, &root) {
        return Err("Unsafe rename path".to_string());
    }
    if !old_path.exists() {
        return Err("Drawer does not exist".to_string());
    }
    if new_path.exists() {
        return Err("A drawer with this name already exists".to_string());
    }

    fs::rename(old_path, new_path).map_err(|err| format!("failed to rename drawer: {err}"))?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
fn drawers_delete_item(app: AppHandle, payload: DeleteItemPayload) -> Result<Value, String> {
    if payload.name.trim().is_empty() {
        return Err("Delete requires name.".to_string());
    }

    if let Some(parent_folder) = payload.parent_folder.as_deref() {
        let target_path = resolve_drawer_entry_path(&app, parent_folder, &payload.name)?;
        if !target_path.exists() {
            return Err("Drawer entry does not exist".to_string());
        }
        let metadata =
            fs::metadata(&target_path).map_err(|err| format!("failed to inspect item: {err}"))?;
        if metadata.is_dir() {
            fs::remove_dir_all(&target_path)
                .map_err(|err| format!("failed to delete directory: {err}"))?;
        } else {
            fs::remove_file(&target_path).map_err(|err| format!("failed to delete file: {err}"))?;
        }
        return Ok(json!({ "success": true }));
    }

    let drawer_path = resolve_drawer_path(&app, &payload.name)?;
    let root = drawer_root(&app)?;
    if !is_path_inside(&drawer_path, &root) {
        return Err("Unsafe delete path".to_string());
    }
    if drawer_path.exists() {
        fs::remove_dir_all(drawer_path).map_err(|err| format!("failed to delete drawer: {err}"))?;
    }
    Ok(json!({ "success": true }))
}

#[tauri::command]
fn files_open(app: AppHandle, payload: OpenFilePayload) -> Result<Value, String> {
    if payload.file_path.trim().is_empty() {
        return Err("Missing file path".to_string());
    }

    let drawer_root = drawer_root(&app)?;
    let resolved_path = PathBuf::from(&payload.file_path);
    if !is_path_inside(&resolved_path, &drawer_root) {
        return Err("Only drawer entries can be opened from TidyDesk.".to_string());
    }
    if !resolved_path.exists() {
        return Err("Drawer entry does not exist".to_string());
    }

    open_path_with_shell(&resolved_path)?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
fn files_import_external_files(
    app: AppHandle,
    payload: ImportExternalFilesPayload,
) -> Result<ImportExternalFilesResult, String> {
    if payload.file_paths.is_empty() {
        return Err("Missing files to import".to_string());
    }
    if payload.file_paths.len() > 100 {
        return Err("Too many files (max 100 per batch)".to_string());
    }
    for file_path in &payload.file_paths {
        if file_path.trim().is_empty() || file_path.len() > 260 {
            return Err("Invalid file path".to_string());
        }
    }

    prepare_drawer_storage(&app)?;
    let target_dir = resolve_drawer_path(&app, payload.target_folder.as_deref().unwrap_or(""))?;
    fs::create_dir_all(&target_dir).map_err(|err| format!("failed to create drawer: {err}"))?;
    let drawer_root = drawer_root(&app)?;
    let mut added = Vec::new();

    for file_path in payload.file_paths {
        let source_path = PathBuf::from(file_path);
        if !source_path.exists() {
            continue;
        }
        let resolved_source = source_path
            .canonicalize()
            .map_err(|err| format!("failed to resolve source path: {err}"))?;
        if is_path_inside(&resolved_source, &drawer_root) {
            continue;
        }
        let source_name = resolved_source
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "Invalid source file name".to_string())?;
        if is_protected_desktop_item(source_name) {
            continue;
        }

        let shortcut = create_drawer_shortcut(&app, &resolved_source, &target_dir)?;
        added.push(ImportedFileResult {
            source: resolved_source.display().to_string(),
            shortcut: shortcut.display().to_string(),
            mode: "shortcut".to_string(),
        });
    }

    Ok(ImportExternalFilesResult {
        success: true,
        added,
    })
}

#[tauri::command]
fn files_restore_to_desktop(
    app: AppHandle,
    payload: RestoreToDesktopPayload,
) -> Result<RestoreToDesktopResult, String> {
    if payload.shortcut_path.trim().is_empty() {
        return Err("Missing shortcut path".to_string());
    }

    let shortcut_path = PathBuf::from(&payload.shortcut_path);
    let drawer_root = drawer_root(&app)?;
    if !is_path_inside(&shortcut_path, &drawer_root) {
        return Err("Only drawer entries can be restored".to_string());
    }
    if !shortcut_path.exists() {
        return Err("Shortcut does not exist".to_string());
    }
    if shortcut_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("lnk"))
        != Some(true)
    {
        return Err("Only .lnk shortcuts can be restored".to_string());
    }

    let target_path = resolve_shortcut_target(&shortcut_path.display().to_string())?
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Target file does not exist".to_string())?;
    let target_path = PathBuf::from(target_path);
    if !target_path.exists() {
        return Err("Target file does not exist".to_string());
    }

    let storage_root = file_storage_root(&app)?;
    if !is_path_inside(&target_path, &storage_root) {
        return Err("File is not managed by TidyDesk (not in storage)".to_string());
    }

    let desktop_path = PathBuf::from(desktop_path());
    let file_name = target_path
        .file_name()
        .ok_or_else(|| "Invalid target file name".to_string())?;
    let destination = next_available_path(&desktop_path, file_name);
    fs::rename(&target_path, &destination)
        .map_err(|err| format!("failed to restore file to desktop: {err}"))?;
    fs::remove_file(&shortcut_path).map_err(|err| format!("failed to remove shortcut: {err}"))?;

    if let Some(storage_dir) = target_path.parent() {
        if storage_dir != storage_root {
            if fs::read_dir(storage_dir)
                .map(|mut entries| entries.next().is_none())
                .unwrap_or(false)
            {
                let _ = fs::remove_dir(storage_dir);
            }
        }
    }

    Ok(RestoreToDesktopResult {
        success: true,
        restored_path: destination.display().to_string(),
    })
}

#[tauri::command]
fn shortcuts_validate_all(app: AppHandle) -> Result<ShortcutValidationStats, String> {
    shortcuts_validate_all_internal(&app)
}

fn shortcuts_validate_all_internal(app: &AppHandle) -> Result<ShortcutValidationStats, String> {
    prepare_drawer_storage(&app)?;
    let drawer_root = drawer_root(&app)?;
    let mut stats = ShortcutValidationStats::default();

    let drawer_items = fs::read_dir(&drawer_root)
        .map_err(|err| format!("failed to read drawer root: {err}"))?;

    for drawer_item in drawer_items {
        let Ok(drawer_item) = drawer_item else {
            continue;
        };
        let Ok(file_type) = drawer_item.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }

        let drawer_path = drawer_item.path();
        let Ok(entries) = fs::read_dir(&drawer_path) else {
            continue;
        };

        for entry in entries {
            let Ok(entry) = entry else {
                continue;
            };
            let Ok(entry_type) = entry.file_type() else {
                continue;
            };
            if !entry_type.is_file() {
                continue;
            }

            let shortcut_path = entry.path();
            if shortcut_path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case("lnk"))
                != Some(true)
            {
                continue;
            }

            stats.total += 1;
            let validation = validate_shortcut(&shortcut_path);
            if validation.is_valid {
                stats.valid += 1;
                continue;
            }

            if let Some(target_path) = validation.target_path {
                let repair = attempt_shortcut_repair(&shortcut_path, &target_path)?;
                if repair.repaired {
                    stats.repaired += 1;
                    stats.valid += 1;
                } else {
                    stats.invalid += 1;
                }
            } else {
                stats.invalid += 1;
            }
        }
    }

    Ok(stats)
}

#[tauri::command]
fn shortcuts_repair(
    app: AppHandle,
    payload: RepairShortcutPayload,
) -> Result<RepairShortcutResult, String> {
    prepare_drawer_storage(&app)?;
    if payload.shortcut_path.trim().is_empty() || payload.target_path.trim().is_empty() {
        return Err("Missing shortcutPath or targetPath".to_string());
    }

    let shortcut_path = PathBuf::from(&payload.shortcut_path);
    let drawer_root = drawer_root(&app)?;
    if !is_path_inside(&shortcut_path, &drawer_root) {
        return Err("Only drawer shortcuts can be repaired".to_string());
    }
    if !shortcut_path.exists() {
        return Err("Shortcut does not exist".to_string());
    }
    if shortcut_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("lnk"))
        != Some(true)
    {
        return Err("Only .lnk shortcuts can be repaired".to_string());
    }

    attempt_shortcut_repair(&shortcut_path, &payload.target_path)
}

fn collect_shortcut_watch_entries(app: &AppHandle) -> Result<HashMap<String, ShortcutWatchEntry>, String> {
    prepare_drawer_storage(app)?;
    let drawer_root = drawer_root(app)?;
    let mut entries = HashMap::new();

    let drawer_items = fs::read_dir(&drawer_root)
        .map_err(|err| format!("failed to read drawer root: {err}"))?;

    for drawer_item in drawer_items {
        let Ok(drawer_item) = drawer_item else {
            continue;
        };
        let Ok(file_type) = drawer_item.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }

        let Ok(entries_in_drawer) = fs::read_dir(drawer_item.path()) else {
            continue;
        };

        for entry in entries_in_drawer {
            let Ok(entry) = entry else {
                continue;
            };
            let Ok(entry_type) = entry.file_type() else {
                continue;
            };
            if !entry_type.is_file() {
                continue;
            }

            let shortcut_path = entry.path();
            if shortcut_path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case("lnk"))
                != Some(true)
            {
                continue;
            }

            let validation = validate_shortcut(&shortcut_path);
            let Some(target_path) = validation.target_path else {
                continue;
            };

            let watched = entries.entry(target_path).or_insert(ShortcutWatchEntry {
                shortcut_count: 0,
                exists: validation.is_valid,
            });
            watched.shortcut_count += 1;
            watched.exists = watched.exists || validation.is_valid;
        }
    }

    Ok(entries)
}

fn sync_shortcut_watch_events(
    app: &AppHandle,
    previous: &mut HashMap<String, ShortcutWatchEntry>,
) -> Result<(), String> {
    let current = collect_shortcut_watch_entries(app)?;

    for (target_path, snapshot) in &current {
        if let Some(prev) = previous.get(target_path) {
            if prev.exists && !snapshot.exists {
                app.emit(
                    TARGET_FILE_DELETED_EVENT,
                    json!({
                        "targetPath": target_path,
                        "shortcutCount": snapshot.shortcut_count,
                    }),
                )
                .map_err(|err| err.to_string())?;
            } else if !prev.exists && snapshot.exists {
                app.emit(
                    TARGET_FILE_RESTORED_EVENT,
                    json!({
                        "targetPath": target_path,
                        "shortcutCount": snapshot.shortcut_count,
                    }),
                )
                .map_err(|err| err.to_string())?;
            }
        }
    }

    *previous = current;
    Ok(())
}

fn start_shortcut_background_services(app: AppHandle) {
    std::thread::spawn(move || {
        let mut previous = match collect_shortcut_watch_entries(&app) {
            Ok(entries) => entries,
            Err(err) => {
                eprintln!("[TIDYDESK] Failed to initialize shortcut watcher state: {err}");
                HashMap::new()
            }
        };
        let mut last_validation = Instant::now();

        loop {
            if let Err(err) = sync_shortcut_watch_events(&app, &mut previous) {
                eprintln!("[TIDYDESK] Shortcut watcher sync failed: {err}");
            }

            if last_validation.elapsed() >= SHORTCUT_VALIDATION_INTERVAL {
                match shortcuts_validate_all_internal(&app) {
                    Ok(stats) => {
                        if stats.repaired > 0 || stats.invalid > 0 {
                            if let Err(err) = app.emit(SHORTCUTS_VALIDATED_EVENT, stats) {
                                eprintln!("[TIDYDESK] Failed to emit shortcut validation stats: {err}");
                            }
                        }
                    }
                    Err(err) => {
                        eprintln!("[TIDYDESK] Periodic shortcut validation failed: {err}");
                    }
                }
                last_validation = Instant::now();
            }

            std::thread::sleep(SHORTCUT_WATCH_POLL_INTERVAL);
        }
    });
}

#[tauri::command]
fn open_app_picker_poc(
    app: AppHandle,
    state: tauri::State<'_, AppPickerTargetState>,
    payload: Option<OpenAppPickerPayload>,
) -> Result<(), String> {
    let target_folder = if let Some(target_folder) = payload
        .and_then(|value| value.target_folder)
        .map(|value| safe_drawer_name(&value))
        .filter(|value| !value.is_empty())
    {
        let mut current = state
            .0
            .lock()
            .map_err(|_| "failed to lock app picker target".to_string())?;
        *current = target_folder;
        current.clone()
    } else {
        state
            .0
            .lock()
            .map_err(|_| "failed to lock app picker target".to_string())?
            .clone()
    };

    if let Some(window) = app.get_webview_window("app-picker-poc") {
        window.show().map_err(|err| err.to_string())?;
        window.set_focus().map_err(|err| err.to_string())?;
        window
            .emit("set-target-folder", target_folder)
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(&app, "app-picker-poc", webview_url_for_mode("app-picker")?)
    .title("TidyDesk AppPicker Tauri PoC")
    .inner_size(920.0, 720.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|err| err.to_string())?;
    window
        .emit("set-target-folder", target_folder)
        .map_err(|err| err.to_string())?;

    Ok(())
}

#[tauri::command]
fn close_app_picker_poc(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("app-picker-poc") {
        window.close().map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn apps_get_picker_target(
    state: tauri::State<'_, AppPickerTargetState>,
) -> Result<AppPickerTargetResult, String> {
    let target_folder = state
        .0
        .lock()
        .map_err(|_| "failed to lock app picker target".to_string())?
        .clone();
    Ok(AppPickerTargetResult { target_folder })
}

#[tauri::command]
fn windows_control(
    app: AppHandle,
    drawer_state: tauri::State<'_, DrawerWindowState>,
    module_state: tauri::State<'_, ModuleWindowState>,
    payload: WindowControlPayload,
) -> Result<Value, String> {
    match payload.action.as_str() {
        "close" => {
            for label in ["capture", "todos", "drawer", "main"] {
                if let Some(window) = app.get_webview_window(label) {
                    let _ = window.close();
                }
            }
        }
        "minimize" => {
            let current = shell_snapshot(&drawer_state, &module_state)?;
            if let Some(label) = current.active_module.as_deref() {
                if matches!(label, "todos" | "capture") {
                    if let Some(window) = app.get_webview_window(label) {
                        window.minimize().map_err(|err| err.to_string())?;
                    }
                } else if let Some(window) = app.get_webview_window("main") {
                    window.minimize().map_err(|err| err.to_string())?;
                }
            } else if let Some(window) = app.get_webview_window("main") {
                window.minimize().map_err(|err| err.to_string())?;
            }
        }
        "open-files" => {
            let current = shell_snapshot(&drawer_state, &module_state)?;
            if current.expanded && current.active_module.as_deref() == Some("files") {
                apply_drawer_state(&app, &drawer_state, &module_state, false)?;
            } else if current.expanded {
                update_active_module(
                    &app,
                    &drawer_state,
                    &module_state,
                    Some("files".to_string()),
                )?;
            } else {
                apply_drawer_state(&app, &drawer_state, &module_state, true)?;
                update_active_module(
                    &app,
                    &drawer_state,
                    &module_state,
                    Some("files".to_string()),
                )?;
            }
        }
        "open-capture" => {
            let current = shell_snapshot(&drawer_state, &module_state)?;
            if current.expanded && current.active_module.as_deref() == Some("capture") {
                apply_drawer_state(&app, &drawer_state, &module_state, false)?;
            } else {
                if let Some(window) = app.get_webview_window("todos") {
                    window.hide().map_err(|err| err.to_string())?;
                }
                apply_drawer_state(&app, &drawer_state, &module_state, true)?;
                update_active_module(
                    &app,
                    &drawer_state,
                    &module_state,
                    Some("capture".to_string()),
                )?;
            }
        }
        "show-files-tab" => {
            let current = shell_snapshot(&drawer_state, &module_state)?;
            if !current.expanded {
                apply_drawer_state(&app, &drawer_state, &module_state, true)?;
            }
            update_active_module(
                &app,
                &drawer_state,
                &module_state,
                Some("files".to_string()),
            )?;
        }
        "show-capture-tab" => {
            let current = shell_snapshot(&drawer_state, &module_state)?;
            if !current.expanded {
                apply_drawer_state(&app, &drawer_state, &module_state, true)?;
            }
            update_active_module(
                &app,
                &drawer_state,
                &module_state,
                Some("capture".to_string()),
            )?;
        }
        "close-panel" => {
            if shell_snapshot(&drawer_state, &module_state)?.active_module.as_deref() == Some("todos") {
                return Err("Todo window lifecycle is managed by close_todo_window".to_string());
            }
            close_active_module(&app, &drawer_state, &module_state)?;
        }
        "expand-drawer" => {
            apply_drawer_state(&app, &drawer_state, &module_state, true)?;
        }
        "collapse-drawer" => {
            apply_drawer_state(&app, &drawer_state, &module_state, false)?;
        }
        "toggle-drawer" => {
            let expanded = !shell_snapshot(&drawer_state, &module_state)?.expanded;
            apply_drawer_state(&app, &drawer_state, &module_state, expanded)?;
        }
        "start-screenshot" => {
            open_snip_window(&app)?;
        }
        _ => return Err(format!("Unsupported window action: {}", payload.action)),
    }

    Ok(json!({ "success": true }))
}

#[tauri::command]
fn clipboard_read_text() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|err| format!("failed to access system clipboard: {err}"))?;
    match clipboard.get_text() {
        Ok(text) => Ok(text),
        Err(_) => Ok(String::new()),
    }
}

#[tauri::command]
fn todos_read_state(app: AppHandle) -> Result<Value, String> {
    todo_state(&app)
}

#[tauri::command]
fn todos_get_counts(app: AppHandle) -> Result<Value, String> {
    let index = read_todo_index(&app)?;
    Ok(todo_counts(&index))
}

#[tauri::command]
fn todos_create_card(app: AppHandle, payload: CreateTodoCardPayload) -> Result<Value, String> {
    let mut index = read_todo_index(&app)?;
    let content = payload.content.unwrap_or_default();
    let first_content_line = content
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("");
    let title = safe_todo_title(
        payload.title.as_deref().unwrap_or(first_content_line),
        "新待办",
    );
    let now = timestamp_string();
    let board_id = todo_board_id(&index);
    let column_id = payload
        .column_id
        .filter(|value| todo_column_ids(&index).contains(value))
        .unwrap_or_else(|| "todo".to_string());
    let card_id = create_todo_id("card");
    let card = json!({
        "id": card_id,
        "boardId": board_id,
        "columnId": column_id,
        "title": title,
        "tags": [],
        "archived": false,
        "createdAt": now,
        "updatedAt": now,
    });

    index["cards"].as_array_mut().unwrap().push(card);
    prepend_card_order(&mut index, &column_id, &card_id)?;
    index["boards"][0]["updatedAt"] = json!(now);
    write_todo_card_content(&app, &card_id, &content)?;
    write_todo_index(&app, &index)?;
    broadcast_todo_counts(&app)?;
    todo_state(&app)
}

#[tauri::command]
fn todos_update_card(app: AppHandle, payload: UpdateTodoCardPayload) -> Result<Value, String> {
    if payload.id.trim().is_empty() {
        return Err("Missing todo card id".to_string());
    }

    let mut index = read_todo_index(&app)?;
    let valid_column_ids = todo_column_ids(&index);
    let card_index = find_todo_card_index(&index, &payload.id)?;
    let now = timestamp_string();

    if let Some(title) = payload.title {
        index["cards"][card_index]["title"] = json!(safe_todo_title(&title, "未命名待办"));
    }
    if let Some(column_id) = payload.column_id {
        let current_column = index["cards"][card_index]["columnId"]
            .as_str()
            .unwrap_or("todo")
            .to_string();
        if valid_column_ids.contains(&column_id) && column_id != current_column {
            remove_card_from_orders(&mut index, &payload.id)?;
            prepend_card_order(&mut index, &column_id, &payload.id)?;
            index["cards"][card_index]["columnId"] = json!(column_id);
        }
    }
    if let Some(tags) = payload.tags {
        let next_tags: Vec<String> = tags
            .iter()
            .map(|tag| safe_todo_title(tag, ""))
            .filter(|tag| !tag.is_empty())
            .take(8)
            .collect();
        index["cards"][card_index]["tags"] = json!(next_tags);
    }
    if let Some(archived) = payload.archived {
        index["cards"][card_index]["archived"] = json!(archived);
    }
    if let Some(content) = payload.content {
        write_todo_card_content(&app, &payload.id, &content)?;
    }

    index["cards"][card_index]["updatedAt"] = json!(now.clone());
    index["boards"][0]["updatedAt"] = json!(now);
    write_todo_index(&app, &index)?;
    broadcast_todo_counts(&app)?;
    todo_state(&app)
}

#[tauri::command]
fn todos_delete_card(app: AppHandle, card_id: String) -> Result<Value, String> {
    let mut index = read_todo_index(&app)?;
    index["cards"]
        .as_array_mut()
        .unwrap()
        .retain(|card| card["id"].as_str() != Some(card_id.as_str()));
    remove_card_from_orders(&mut index, &card_id)?;
    index["boards"][0]["updatedAt"] = json!(timestamp_string());
    let card_path = todo_card_path(&app, &card_id)?;
    if let Err(err) = fs::remove_file(card_path) {
        if err.kind() != std::io::ErrorKind::NotFound {
            return Err(format!("failed to delete todo card content: {err}"));
        }
    }
    write_todo_index(&app, &index)?;
    broadcast_todo_counts(&app)?;
    todo_state(&app)
}

#[tauri::command]
fn todos_move_card(app: AppHandle, payload: MoveTodoCardPayload) -> Result<Value, String> {
    if payload.id.trim().is_empty() {
        return Err("Missing todo card id".to_string());
    }
    if payload.column_id.trim().is_empty() {
        return Err("Missing todo column id".to_string());
    }

    let mut index = read_todo_index(&app)?;
    let valid_column_ids = todo_column_ids(&index);
    if !valid_column_ids.contains(&payload.column_id) {
        return Err("Todo column not found".to_string());
    }
    let card_index = find_todo_card_index(&index, &payload.id)?;
    remove_card_from_orders(&mut index, &payload.id)?;
    insert_card_order(
        &mut index,
        &payload.column_id,
        &payload.id,
        payload.before_id.as_deref(),
    )?;
    let now = timestamp_string();
    index["cards"][card_index]["columnId"] = json!(payload.column_id);
    index["cards"][card_index]["updatedAt"] = json!(now.clone());
    index["boards"][0]["updatedAt"] = json!(now);
    write_todo_index(&app, &index)?;
    broadcast_todo_counts(&app)?;
    todo_state(&app)
}

fn todo_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("todos"))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

fn todo_cards_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(todo_root(app)?.join("cards"))
}

fn todo_index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(todo_root(app)?.join("boards.json"))
}

fn ensure_todo_storage(app: &AppHandle) -> Result<(), String> {
    fs::create_dir_all(todo_cards_root(app)?)
        .map_err(|err| format!("failed to create todo storage: {err}"))?;
    let index_path = todo_index_path(app)?;
    if !index_path.exists() {
        write_todo_index(app, &create_default_todo_index())?;
    }
    Ok(())
}

fn create_default_todo_index() -> Value {
    let now = timestamp_string();
    json!({
        "version": 1,
        "activeBoardId": "default-board",
        "boards": [{
            "id": "default-board",
            "title": "待办",
            "columns": [
                { "id": "todo", "title": "待处理" },
                { "id": "doing", "title": "进行中" },
                { "id": "done", "title": "已完成" }
            ],
            "cardOrder": {
                "todo": [],
                "doing": [],
                "done": []
            },
            "createdAt": now,
            "updatedAt": now
        }],
        "cards": []
    })
}

fn read_todo_index(app: &AppHandle) -> Result<Value, String> {
    ensure_todo_storage(app)?;
    let index_path = todo_index_path(app)?;
    let raw = fs::read_to_string(index_path).unwrap_or_default();
    let parsed =
        serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| create_default_todo_index());
    let normalized = normalize_todo_index(parsed);
    write_todo_index(app, &normalized)?;
    Ok(normalized)
}

fn write_todo_index(app: &AppHandle, index: &Value) -> Result<(), String> {
    fs::create_dir_all(todo_root(app)?)
        .map_err(|err| format!("failed to create todo root: {err}"))?;
    let normalized = normalize_todo_index(index.clone());
    let content = serde_json::to_string_pretty(&normalized)
        .map_err(|err| format!("failed to serialize todo index: {err}"))?;
    fs::write(todo_index_path(app)?, content)
        .map_err(|err| format!("failed to write todo index: {err}"))
}

fn normalize_todo_index(index: Value) -> Value {
    let mut normalized = if index.is_object() {
        index
    } else {
        create_default_todo_index()
    };
    let fallback = create_default_todo_index();
    let mut board = normalized["boards"]
        .as_array()
        .and_then(|boards| boards.first())
        .cloned()
        .unwrap_or_else(|| fallback["boards"][0].clone());

    board["id"] = json!(board["id"].as_str().unwrap_or("default-board"));
    board["title"] = json!(safe_todo_title(
        board["title"].as_str().unwrap_or("待办"),
        "待办"
    ));
    if !board["columns"]
        .as_array()
        .map(|value| !value.is_empty())
        .unwrap_or(false)
    {
        board["columns"] = fallback["boards"][0]["columns"].clone();
    }
    if !board["cardOrder"].is_object() {
        board["cardOrder"] = json!({});
    }

    let column_ids: Vec<String> = board["columns"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|column| column["id"].as_str().map(str::to_string))
        .collect();
    for column_id in &column_ids {
        if !board["cardOrder"][column_id].is_array() {
            board["cardOrder"][column_id] = json!([]);
        }
    }

    let mut cards = Vec::new();
    let mut card_ids = HashSet::new();
    if let Some(raw_cards) = normalized["cards"].as_array() {
        for card in raw_cards {
            let Some(id) = card["id"].as_str() else {
                continue;
            };
            let column_id = card["columnId"]
                .as_str()
                .filter(|value| column_ids.contains(&value.to_string()))
                .unwrap_or("todo");
            card_ids.insert(id.to_string());
            cards.push(json!({
                "id": id,
                "boardId": card["boardId"].as_str().unwrap_or(board["id"].as_str().unwrap_or("default-board")),
                "columnId": column_id,
                "title": safe_todo_title(card["title"].as_str().unwrap_or("未命名待办"), "未命名待办"),
                "tags": card["tags"].as_array().cloned().unwrap_or_default(),
                "archived": card["archived"].as_bool().unwrap_or(false),
                "createdAt": card["createdAt"].as_str().unwrap_or_else(|| timestamp_string().leak()),
                "updatedAt": card["updatedAt"].as_str().unwrap_or_else(|| timestamp_string().leak()),
            }));
        }
    }

    for column_id in &column_ids {
        let filtered: Vec<Value> = board["cardOrder"][column_id]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|id| id.as_str())
            .filter(|id| card_ids.contains(*id))
            .map(|id| json!(id))
            .collect();
        board["cardOrder"][column_id] = json!(filtered);
    }
    for card in &cards {
        let card_id = card["id"].as_str().unwrap();
        let column_id = card["columnId"].as_str().unwrap_or("todo");
        let order = board["cardOrder"][column_id].as_array_mut().unwrap();
        if !order.iter().any(|id| id.as_str() == Some(card_id)) {
            order.push(json!(card_id));
        }
    }

    normalized["version"] = json!(1);
    normalized["activeBoardId"] = json!(board["id"].as_str().unwrap_or("default-board"));
    normalized["boards"] = json!([board]);
    normalized["cards"] = json!(cards);
    normalized
}

fn todo_state(app: &AppHandle) -> Result<Value, String> {
    let index = read_todo_index(app)?;
    let cards = index["cards"]
        .as_array()
        .unwrap()
        .iter()
        .map(|card| {
            let mut next = card.clone();
            let card_id = next["id"].as_str().unwrap_or_default().to_string();
            next["content"] = json!(read_todo_card_content(app, &card_id).unwrap_or_default());
            next
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "activeBoardId": index["activeBoardId"],
        "boards": index["boards"],
        "cards": cards,
        "counts": todo_counts(&index),
    }))
}

fn todo_counts(index: &Value) -> Value {
    let mut total = 0;
    let mut open = 0;
    let mut done = 0;
    for card in index["cards"].as_array().unwrap_or(&Vec::new()) {
        if card["archived"].as_bool().unwrap_or(false) {
            continue;
        }
        total += 1;
        if card["columnId"].as_str() == Some("done") {
            done += 1;
        } else {
            open += 1;
        }
    }
    json!({ "total": total, "open": open, "done": done })
}

fn broadcast_todo_counts(app: &AppHandle) -> Result<(), String> {
    let index = read_todo_index(app)?;
    let counts = todo_counts(&index);
    for label in ["handle", "main", "todos", "capture"] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .emit("todo-counts-updated", counts.clone())
                .map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn todo_board_id(index: &Value) -> String {
    index["boards"][0]["id"]
        .as_str()
        .unwrap_or("default-board")
        .to_string()
}

fn todo_column_ids(index: &Value) -> HashSet<String> {
    index["boards"][0]["columns"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|column| column["id"].as_str().map(str::to_string))
        .collect()
}

fn find_todo_card_index(index: &Value, card_id: &str) -> Result<usize, String> {
    index["cards"]
        .as_array()
        .unwrap()
        .iter()
        .position(|card| card["id"].as_str() == Some(card_id))
        .ok_or_else(|| "Todo card not found".to_string())
}

fn remove_card_from_orders(index: &mut Value, card_id: &str) -> Result<(), String> {
    let column_ids: Vec<String> = todo_column_ids(index).into_iter().collect();
    for column_id in column_ids {
        if let Some(order) = index["boards"][0]["cardOrder"][&column_id].as_array_mut() {
            order.retain(|id| id.as_str() != Some(card_id));
        }
    }
    Ok(())
}

fn prepend_card_order(index: &mut Value, column_id: &str, card_id: &str) -> Result<(), String> {
    let order = index["boards"][0]["cardOrder"][column_id]
        .as_array_mut()
        .ok_or_else(|| "Todo card order not found".to_string())?;
    order.insert(0, json!(card_id));
    Ok(())
}

fn insert_card_order(
    index: &mut Value,
    column_id: &str,
    card_id: &str,
    before_id: Option<&str>,
) -> Result<(), String> {
    let order = index["boards"][0]["cardOrder"][column_id]
        .as_array_mut()
        .ok_or_else(|| "Todo card order not found".to_string())?;
    if let Some(before_id) = before_id {
        if let Some(position) = order.iter().position(|id| id.as_str() == Some(before_id)) {
            order.insert(position, json!(card_id));
            return Ok(());
        }
    }
    order.push(json!(card_id));
    Ok(())
}

fn todo_card_path(app: &AppHandle, card_id: &str) -> Result<PathBuf, String> {
    let safe_name: String = card_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let root = todo_cards_root(app)?;
    let path = root.join(format!("{safe_name}.md"));
    if !is_path_inside(&path, &root) {
        return Err("Unsafe todo card path".to_string());
    }
    Ok(path)
}

fn read_todo_card_content(app: &AppHandle, card_id: &str) -> Result<String, String> {
    match fs::read_to_string(todo_card_path(app, card_id)?) {
        Ok(content) => Ok(content),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(format!("failed to read todo card content: {err}")),
    }
}

fn write_todo_card_content(app: &AppHandle, card_id: &str, content: &str) -> Result<(), String> {
    fs::create_dir_all(todo_cards_root(app)?)
        .map_err(|err| format!("failed to create todo cards root: {err}"))?;
    fs::write(todo_card_path(app, card_id)?, content)
        .map_err(|err| format!("failed to write todo card content: {err}"))
}

fn safe_todo_title(title: &str, fallback: &str) -> String {
    let normalized = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let value = if normalized.is_empty() {
        fallback
    } else {
        &normalized
    };
    value.chars().take(120).collect()
}

fn create_todo_id(prefix: &str) -> String {
    format!("{prefix}-{}-{}", timestamp_string(), std::process::id())
}

fn timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

#[derive(Debug, Clone)]
struct ShellBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

const DRAWER_ANIMATION_STEPS: u32 = 12;

fn set_handle_always_on_top(app: &AppHandle, always_on_top: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("handle") {
        window
            .set_always_on_top(always_on_top)
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn apply_drawer_state(
    app: &AppHandle,
    drawer_state: &tauri::State<'_, DrawerWindowState>,
    module_state: &tauri::State<'_, ModuleWindowState>,
    expanded: bool,
) -> Result<(), String> {
    let previous = shell_snapshot(drawer_state, module_state)?;
    let handle_from = handle_window_bounds(app, previous.expanded)?;
    let handle_to = handle_window_bounds(app, expanded)?;

    if expanded {
        hide_module_windows(app)?;
        let drawer_target = drawer_window_bounds(app)?;
        let drawer_start = drawer_hidden_bounds(app, &drawer_target)?;
        let next_active_module = match previous.active_module.as_deref() {
            Some("capture") => Some("capture".to_string()),
            Some("files") => Some("files".to_string()),
            _ => Some("files".to_string()),
        };
        apply_window_bounds(app, "main", drawer_start.clone())?;
        if let Some(window) = app.get_webview_window("main") {
            window.show().map_err(|err| err.to_string())?;
            window.set_focus().map_err(|err| err.to_string())?;
        }
        if let Some(window) = app.get_webview_window("handle") {
            window.show().map_err(|err| err.to_string())?;
        }
        set_handle_always_on_top(app, false)?;
        animate_window_bounds(app.clone(), "main", drawer_start, drawer_target, false);
        animate_window_bounds(app.clone(), "handle", handle_from, handle_to, false);
        update_shell_state(
            app,
            drawer_state,
            module_state,
            true,
            next_active_module,
        )?;
    } else {
        let drawer_from = drawer_window_bounds(app)?;
        let drawer_target = drawer_hidden_bounds(app, &drawer_from)?;
        apply_window_bounds(app, "main", drawer_from.clone())?;
        if app.get_webview_window("main").is_some() {
            animate_window_bounds(app.clone(), "main", drawer_from, drawer_target, true);
        }
        if let Some(window) = app.get_webview_window("handle") {
            window.show().map_err(|err| err.to_string())?;
        }
        set_handle_always_on_top(app, true)?;
        animate_window_bounds(app.clone(), "handle", handle_from, handle_to, false);
        let active_module = previous.active_module;
        let next_module = if active_module.as_deref() == Some("files") {
            None
        } else {
            active_module
        };
        update_shell_state(app, drawer_state, module_state, false, next_module)?;
    }
    Ok(())
}

fn hide_drawer_window_now(
    app: &AppHandle,
    drawer_state: &tauri::State<'_, DrawerWindowState>,
    module_state: &tauri::State<'_, ModuleWindowState>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|err| err.to_string())?;
    }
    apply_window_bounds(app, "handle", handle_window_bounds(app, false)?)?;
    if let Some(window) = app.get_webview_window("handle") {
        window.show().map_err(|err| err.to_string())?;
    }
    set_handle_always_on_top(app, true)?;
    let previous = shell_snapshot(drawer_state, module_state)?;
    let next_module = if previous.active_module.as_deref() == Some("files") {
        None
    } else {
        previous.active_module
    };
    update_shell_state(app, drawer_state, module_state, false, next_module)
}

fn close_active_module(
    app: &AppHandle,
    drawer_state: &tauri::State<'_, DrawerWindowState>,
    module_state: &tauri::State<'_, ModuleWindowState>,
) -> Result<(), String> {
    let current = shell_snapshot(drawer_state, module_state)?;
    let active_module = current.active_module.clone();
    if active_module.as_deref() == Some("files") {
        return apply_drawer_state(app, drawer_state, module_state, false);
    }
    if let Some(module) = active_module {
        if let Some(window) = app.get_webview_window(&module) {
            window.hide().map_err(|err| err.to_string())?;
        }
    }
    apply_window_bounds(app, "handle", handle_window_bounds(app, false)?)?;
    if let Some(window) = app.get_webview_window("handle") {
        window.show().map_err(|err| err.to_string())?;
    }
    set_handle_always_on_top(app, true)?;
    update_shell_state(app, drawer_state, module_state, false, None)
}

fn webview_url_for_mode(mode: &str) -> Result<WebviewUrl, String> {
    if cfg!(debug_assertions) {
        let url = Url::parse(&format!("http://127.0.0.1:3000/?mode={mode}"))
            .map_err(|err| err.to_string())?;
        Ok(WebviewUrl::External(url))
    } else {
        Ok(WebviewUrl::App(format!("index.html?mode={mode}").into()))
    }
}

fn update_shell_state(
    app: &AppHandle,
    drawer_state: &tauri::State<'_, DrawerWindowState>,
    module_state: &tauri::State<'_, ModuleWindowState>,
    expanded: bool,
    active_module: Option<String>,
) -> Result<(), String> {
    {
        let mut current = drawer_state
            .0
            .lock()
            .map_err(|_| "failed to lock drawer state".to_string())?;
        *current = expanded;
    }
    {
        let mut current = module_state
            .0
            .lock()
            .map_err(|_| "failed to lock module state".to_string())?;
        *current = active_module.clone();
    }
    let snapshot = ShellWindowSnapshot {
        expanded,
        active_module,
    };
    broadcast_shell_state(app, &snapshot)
}

fn update_active_module(
    app: &AppHandle,
    drawer_state: &tauri::State<'_, DrawerWindowState>,
    module_state: &tauri::State<'_, ModuleWindowState>,
    active_module: Option<String>,
) -> Result<(), String> {
    let expanded = *drawer_state
        .0
        .lock()
        .map_err(|_| "failed to lock drawer state".to_string())?;
    update_shell_state(app, drawer_state, module_state, expanded, active_module)
}

fn shell_snapshot(
    drawer_state: &tauri::State<'_, DrawerWindowState>,
    module_state: &tauri::State<'_, ModuleWindowState>,
) -> Result<ShellWindowSnapshot, String> {
    let expanded = *drawer_state
        .0
        .lock()
        .map_err(|_| "failed to lock drawer state".to_string())?;
    let active_module = module_state
        .0
        .lock()
        .map_err(|_| "failed to lock module state".to_string())?
        .clone();
    Ok(ShellWindowSnapshot {
        expanded,
        active_module,
    })
}

fn broadcast_shell_state(app: &AppHandle, snapshot: &ShellWindowSnapshot) -> Result<(), String> {
    let payload = json!({
        "expanded": snapshot.expanded,
        "activeModule": snapshot.active_module.clone(),
    });

    for label in ["handle", "main"] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .emit("drawer-state", payload.clone())
                .map_err(|err| err.to_string())?;
        }
    }

    for label in ["handle", "main"] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .emit("module-state", payload.clone())
                .map_err(|err| err.to_string())?;
        }
    }

    Ok(())
}

fn hide_module_windows(app: &AppHandle) -> Result<(), String> {
    for label in ["capture"] {
        if let Some(window) = app.get_webview_window(label) {
            window.hide().map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn apply_window_bounds(app: &AppHandle, label: &str, bounds: ShellBounds) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        window
            .set_position(PhysicalPosition::new(bounds.x, bounds.y))
            .map_err(|err| err.to_string())?;
        window
            .set_size(PhysicalSize::new(bounds.width, bounds.height))
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn interpolate_i32(start: i32, end: i32, progress: f64) -> i32 {
    (start as f64 + ((end - start) as f64 * progress)).round() as i32
}

fn interpolate_u32(start: u32, end: u32, progress: f64) -> u32 {
    (start as f64 + ((end as f64) - (start as f64)) * progress).round() as u32
}

fn interpolate_bounds(from: &ShellBounds, to: &ShellBounds, progress: f64) -> ShellBounds {
    ShellBounds {
        x: interpolate_i32(from.x, to.x, progress),
        y: interpolate_i32(from.y, to.y, progress),
        width: interpolate_u32(from.width, to.width, progress),
        height: interpolate_u32(from.height, to.height, progress),
    }
}

fn animate_window_bounds(
    app: AppHandle,
    label: &str,
    from: ShellBounds,
    to: ShellBounds,
    hide_after: bool,
) {
    let label = label.to_string();
    std::thread::spawn(move || {
        for step in 0..=DRAWER_ANIMATION_STEPS {
            let progress = step as f64 / DRAWER_ANIMATION_STEPS as f64;
            let bounds = interpolate_bounds(&from, &to, progress);
            let app_handle = app.clone();
            let app_lookup = app_handle.clone();
            let window_label = label.clone();
            let _ = app_handle.run_on_main_thread(move || {
                if let Some(window) = app_lookup.get_webview_window(&window_label) {
                    let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
                    let _ = window.set_size(PhysicalSize::new(bounds.width, bounds.height));
                    if hide_after && step == DRAWER_ANIMATION_STEPS {
                        let _ = window.hide();
                    }
                }
            });
            std::thread::sleep(Duration::from_millis(16));
        }
    });
}

fn monitor_bounds(app: &AppHandle) -> Result<ShellBounds, String> {
    for label in ["handle", "main", "app-picker-poc"] {
        if let Some(window) = app.get_webview_window(label) {
            if let Some(monitor) = window.current_monitor().map_err(|err| err.to_string())? {
                let position = monitor.position();
                let size = monitor.size();
                return Ok(ShellBounds {
                    x: position.x,
                    y: position.y,
                    width: size.width,
                    height: size.height,
                });
            }
        }
    }

    let monitor = app
        .primary_monitor()
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "No primary monitor found".to_string())?;
    let position = monitor.position();
    let size = monitor.size();
    Ok(ShellBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

fn content_width(app: &AppHandle) -> Result<u32, String> {
    let bounds = monitor_bounds(app)?;
    let target = ((bounds.width as f64) * 0.3).round() as u32;
    Ok(target.clamp(360, 560))
}

fn drawer_window_bounds(app: &AppHandle) -> Result<ShellBounds, String> {
    let screen = monitor_bounds(app)?;
    let width = content_width(app)?;
    Ok(ShellBounds {
        x: screen.x + screen.width as i32 - width as i32,
        y: screen.y,
        width,
        height: screen.height,
    })
}

fn drawer_hidden_bounds(app: &AppHandle, target: &ShellBounds) -> Result<ShellBounds, String> {
    let screen = monitor_bounds(app)?;
    Ok(ShellBounds {
        x: screen.x + screen.width as i32,
        y: target.y,
        width: target.width,
        height: target.height,
    })
}

fn handle_window_bounds(app: &AppHandle, expanded: bool) -> Result<ShellBounds, String> {
    let screen = monitor_bounds(app)?;
    let drawer_width = if expanded { content_width(app)? } else { 0 };
    let width = 80;
    let height = 300u32.min(screen.height);
    Ok(ShellBounds {
        x: screen.x + screen.width as i32 - drawer_width as i32 - width as i32,
        y: screen.y + ((screen.height - height) / 2) as i32,
        width,
        height,
    })
}

fn ensure_handle_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window("handle").is_some() {
        return Ok(());
    }
    let bounds = handle_window_bounds(app, false)?;
    let window = WebviewWindowBuilder::new(
        app,
        "handle",
        webview_url_for_mode("handle")?,
    )
    .title("TidyDesk Handle")
    .inner_size(bounds.width as f64, bounds.height as f64)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .build()
    .map_err(|err| err.to_string())?;
    window
        .set_size(PhysicalSize::new(bounds.width, bounds.height))
        .map_err(|err| err.to_string())?;
    window
        .set_position(PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn scan_metadata_params() -> Value {
    json!({
        "startMenuPaths": start_menu_paths(),
        "desktopPath": desktop_path(),
        "maxDepth": 3,
        "skipDirectories": [
            "Accessories",
            "Administrative Tools",
            "Maintenance",
            "System Tools",
            "Startup"
        ]
    })
}

fn start_menu_paths() -> Vec<String> {
    let mut paths = Vec::new();
    let program_data =
        std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".to_string());
    paths.push(format!(
        "{program_data}\\Microsoft\\Windows\\Start Menu\\Programs"
    ));
    if let Ok(app_data) = std::env::var("APPDATA") {
        paths.push(format!(
            "{app_data}\\Microsoft\\Windows\\Start Menu\\Programs"
        ));
    }
    paths
}

fn desktop_path() -> String {
    std::env::var("USERPROFILE")
        .map(|profile| format!("{profile}\\Desktop"))
        .unwrap_or_else(|_| String::new())
}

fn drawer_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("drawers"))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

fn file_storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("storage"))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

fn prepare_drawer_storage(app: &AppHandle) -> Result<(), String> {
    let root = drawer_root(app)?;
    fs::create_dir_all(&root).map_err(|err| format!("failed to create drawer root: {err}"))?;
    let storage_root = file_storage_root(app)?;
    fs::create_dir_all(storage_root)
        .map_err(|err| format!("failed to create storage root: {err}"))?;
    let default_drawer = resolve_drawer_path(app, "收纳抽屉")?;
    fs::create_dir_all(default_drawer)
        .map_err(|err| format!("failed to create default drawer: {err}"))?;
    Ok(())
}

fn file_extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default()
}

fn modified_at(metadata: &fs::Metadata) -> String {
    metadata
        .modified()
        .unwrap_or(UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

fn path_identity(path: &Path, metadata: &fs::Metadata) -> String {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("item")
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    format!("{}-{}-{file_name}", metadata.len(), modified_at(metadata))
}

fn category_by_extension(ext: &str, file_name: &str) -> String {
    let name_lower = file_name.to_lowercase();
    let ext_lower = ext.trim_start_matches('.').to_lowercase();

    if name_lower.starts_with("新建")
        || name_lower.starts_with("untitled")
        || name_lower.contains("screenshot")
        || name_lower.starts_with("temp")
        || name_lower.starts_with("tmp")
    {
        return "temporary".to_string();
    }

    if matches!(
        ext_lower.as_str(),
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "svg" | "webp" | "ico"
    ) {
        return "image".to_string();
    }
    if matches!(
        ext_lower.as_str(),
        "doc"
            | "docx"
            | "xls"
            | "xlsx"
            | "ppt"
            | "pptx"
            | "pdf"
            | "txt"
            | "csv"
            | "md"
            | "key"
            | "numbers"
            | "pages"
    ) {
        return "document".to_string();
    }
    if matches!(
        ext_lower.as_str(),
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2"
    ) {
        return "archive".to_string();
    }
    if matches!(
        ext_lower.as_str(),
        "exe" | "msi" | "bat" | "cmd" | "dmg" | "pkg" | "lnk" | "url"
    ) {
        return "app".to_string();
    }
    if matches!(
        ext_lower.as_str(),
        "ts" | "tsx"
            | "js"
            | "jsx"
            | "json"
            | "html"
            | "css"
            | "py"
            | "go"
            | "rs"
            | "cpp"
            | "h"
            | "java"
            | "sh"
            | "yaml"
            | "yml"
    ) {
        return "developer".to_string();
    }

    "other".to_string()
}

fn is_protected_desktop_item(name: &str) -> bool {
    let name_lower = name.to_lowercase();
    [
        "desktop.ini",
        "tidydesk",
        "node_modules",
        ".git",
        ".github",
        "桌面收纳盒",
    ]
    .iter()
    .any(|value| name_lower.contains(&value.to_lowercase()))
}

fn resolve_drawer_path(app: &AppHandle, folder_name: &str) -> Result<PathBuf, String> {
    let root = drawer_root(app)?;
    let target_path = root.join(safe_drawer_name(folder_name));
    if !is_path_inside(&target_path, &root) || target_path == root {
        return Err("Unsafe drawer path".to_string());
    }
    Ok(target_path)
}

fn resolve_drawer_entry_path(
    app: &AppHandle,
    folder_name: &str,
    entry_name: &str,
) -> Result<PathBuf, String> {
    let drawer_path = resolve_drawer_path(app, folder_name)?;
    let safe_name = safe_drawer_entry_name(entry_name)?;
    let direct_path = drawer_path.join(&safe_name);
    if !is_path_inside(&direct_path, &drawer_path) {
        return Err("Unsafe drawer entry path".to_string());
    }
    if direct_path.exists() {
        return Ok(direct_path);
    }

    if Path::new(&safe_name).extension().is_none() {
        let shortcut_path = drawer_path.join(format!("{safe_name}.lnk"));
        if !is_path_inside(&shortcut_path, &drawer_path) {
            return Err("Unsafe drawer entry path".to_string());
        }
        if shortcut_path.exists() {
            return Ok(shortcut_path);
        }
    }

    Ok(direct_path)
}

fn safe_drawer_entry_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Missing drawer entry name".to_string());
    }
    let file_name = Path::new(trimmed)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Invalid drawer entry name".to_string())?;
    if file_name != trimmed {
        return Err("Unsafe drawer entry name".to_string());
    }
    Ok(file_name.to_string())
}

fn drawer_entry_rename_target(old_path: &Path, new_name: &str) -> String {
    let trimmed = new_name.trim();
    if Path::new(trimmed).extension().is_some() {
        return trimmed.to_string();
    }

    match old_path.extension().and_then(|value| value.to_str()) {
        Some(extension) if !extension.is_empty() => format!("{trimmed}.{extension}"),
        _ => trimmed.to_string(),
    }
}

fn safe_drawer_name(name: &str) -> String {
    let trimmed = name.trim();
    let value = if trimmed.is_empty() {
        "收纳抽屉"
    } else {
        trimmed
    };
    value
        .chars()
        .map(|ch| {
            if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || ch.is_control()
            {
                '_'
            } else {
                ch
            }
        })
        .take(80)
        .collect()
}

fn is_path_inside(child_path: &Path, parent_path: &Path) -> bool {
    let resolved_child = match child_path.canonicalize() {
        Ok(path) => path,
        Err(_) => child_path.to_path_buf(),
    };
    let resolved_parent = match parent_path.canonicalize() {
        Ok(path) => path,
        Err(_) => parent_path.to_path_buf(),
    };
    resolved_child.starts_with(resolved_parent)
}

fn next_available_path(dest_dir: &Path, file_name: &std::ffi::OsStr) -> PathBuf {
    let mut candidate = dest_dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let source = Path::new(file_name);
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("shortcut");
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    let mut index = 1;
    while candidate.exists() {
        candidate = dest_dir.join(format!("{stem} ({index}){extension}"));
        index += 1;
    }
    candidate
}

fn create_drawer_shortcut(
    app: &AppHandle,
    source_path: &Path,
    target_dir: &Path,
) -> Result<PathBuf, String> {
    if !source_path.exists() {
        return Err("Source file does not exist".to_string());
    }
    if is_system_path(source_path) {
        return Err("Cannot move system files".to_string());
    }

    let item_name = source_path
        .file_name()
        .ok_or_else(|| "Invalid source file name".to_string())?;
    let desktop_path = PathBuf::from(desktop_path());
    let is_from_desktop = is_path_inside(source_path, &desktop_path);
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");

    if extension.eq_ignore_ascii_case("lnk") || extension.eq_ignore_ascii_case("url") {
        let shortcut_path = next_available_path(target_dir, item_name);
        fs::copy(source_path, &shortcut_path)
            .map_err(|err| format!("failed to copy shortcut: {err}"))?;
        if is_from_desktop {
            fs::remove_file(source_path)
                .map_err(|err| format!("failed to remove original shortcut: {err}"))?;
        }
        return Ok(shortcut_path);
    }

    let storage_root = file_storage_root(app)?;
    fs::create_dir_all(&storage_root).map_err(|err| format!("failed to create storage: {err}"))?;
    let storage_id = storage_id();
    let storage_dir = storage_root.join(storage_id);
    fs::create_dir_all(&storage_dir)
        .map_err(|err| format!("failed to create storage dir: {err}"))?;
    let storage_path = storage_dir.join(item_name);

    if is_from_desktop {
        fs::rename(source_path, &storage_path)
            .map_err(|err| format!("failed to move file to storage: {err}"))?;
    } else {
        fs::copy(source_path, &storage_path)
            .map_err(|err| format!("failed to copy file to storage: {err}"))?;
    }

    let shortcut_file_name = format!("{}.lnk", item_name.to_string_lossy());
    let shortcut_path = next_available_path(target_dir, std::ffi::OsStr::new(&shortcut_file_name));
    if let Err(err) = create_shortcut_link(&shortcut_path, &storage_path) {
        if is_from_desktop {
            let _ = fs::rename(&storage_path, source_path);
        } else {
            let _ = fs::remove_file(&storage_path);
        }
        return Err(err);
    }

    Ok(shortcut_path)
}

fn storage_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{millis}-{}", std::process::id())
}

fn is_system_path(path: &Path) -> bool {
    let resolved = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_lowercase();
    let mut system_paths = vec![
        "C:\\Windows".to_string(),
        "C:\\Program Files".to_string(),
        "C:\\Program Files (x86)".to_string(),
    ];
    if let Ok(system_root) = std::env::var("SYSTEMROOT") {
        system_paths.push(system_root);
    }
    if let Ok(windir) = std::env::var("WINDIR") {
        system_paths.push(windir);
    }
    system_paths
        .iter()
        .filter(|value| !value.is_empty())
        .any(|value| resolved.starts_with(&value.to_lowercase()))
}

#[cfg(windows)]
fn create_shortcut_link(shortcut_path: &Path, target_path: &Path) -> Result<(), String> {
    let description = format!(
        "TidyDesk managed file: {}",
        target_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
    );
    write_shortcut_link(shortcut_path, target_path, &description)
}

#[cfg(windows)]
fn write_shortcut_link(shortcut_path: &Path, target_path: &Path, description: &str) -> Result<(), String> {
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|err| format!("failed to initialize COM: {err}"))?;
        let result = write_shortcut_link_with_com(shortcut_path, target_path, description);
        CoUninitialize();
        result
    }
}

#[cfg(windows)]
fn write_shortcut_link_with_com(
    shortcut_path: &Path,
    target_path: &Path,
    description: &str,
) -> Result<(), String> {
    unsafe {
        let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|err| format!("failed to create ShellLink: {err}"))?;
        let target_wide: Vec<u16> = target_path
            .display()
            .to_string()
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let working_dir = if target_path.is_dir() {
            target_path
        } else {
            target_path.parent().unwrap_or_else(|| Path::new(""))
        };
        let working_dir_wide: Vec<u16> = working_dir
            .display()
            .to_string()
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let description_wide: Vec<u16> = format!(
            "{}",
            description
        )
        .encode_utf16()
        .chain(Some(0))
        .collect();

        shell_link
            .SetPath(PCWSTR(target_wide.as_ptr()))
            .map_err(|err| format!("failed to set shortcut target: {err}"))?;
        shell_link
            .SetWorkingDirectory(PCWSTR(working_dir_wide.as_ptr()))
            .map_err(|err| format!("failed to set shortcut cwd: {err}"))?;
        shell_link
            .SetDescription(PCWSTR(description_wide.as_ptr()))
            .map_err(|err| format!("failed to set shortcut description: {err}"))?;
        let persist_file: IPersistFile = shell_link
            .cast()
            .map_err(|err| format!("failed to query IPersistFile: {err}"))?;
        let shortcut_wide: Vec<u16> = shortcut_path
            .display()
            .to_string()
            .encode_utf16()
            .chain(Some(0))
            .collect();
        persist_file
            .Save(PCWSTR(shortcut_wide.as_ptr()), true)
            .map_err(|err| format!("failed to save shortcut: {err}"))?;
        Ok(())
    }
}

#[cfg(not(windows))]
fn create_shortcut_link(_shortcut_path: &Path, _target_path: &Path) -> Result<(), String> {
    Err("Creating shortcuts is only implemented for Windows in this PoC".to_string())
}

#[cfg(not(windows))]
fn write_shortcut_link(
    _shortcut_path: &Path,
    _target_path: &Path,
    _description: &str,
) -> Result<(), String> {
    Err("Creating shortcuts is only implemented for Windows in this PoC".to_string())
}

#[cfg(windows)]
fn open_path_with_shell(path: &Path) -> Result<(), String> {
    Command::new("rundll32.exe")
        .arg("url.dll,FileProtocolHandler")
        .arg(path)
        .spawn()
        .map_err(|err| format!("failed to open path: {err}"))?;
    Ok(())
}

#[cfg(not(windows))]
fn open_path_with_shell(_path: &Path) -> Result<(), String> {
    Err("Opening files is only implemented for Windows in this PoC".to_string())
}

fn complete_installed_apps(metadata: ScanMetadataResult) -> ScanInstalledResult {
    let mut apps = Vec::new();
    let mut seen_targets = HashSet::new();
    let mut skipped_count = 0;

    for shortcut in &metadata.shortcuts {
        let shortcut_path = match shortcut.shortcut_path.as_deref() {
            Some(value) if !value.is_empty() => value,
            _ => {
                skipped_count += 1;
                continue;
            }
        };

        if Path::new(shortcut_path)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("lnk"))
            != Some(true)
        {
            skipped_count += 1;
            continue;
        }

        let display_name = shortcut
            .name
            .as_deref()
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| {
                Path::new(shortcut_path)
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "Unknown App".to_string());

        if should_skip_shortcut_name(&display_name) {
            skipped_count += 1;
            continue;
        }

        let target_path = match resolve_shortcut_target(shortcut_path) {
            Ok(Some(value)) if !value.is_empty() => value,
            _ => {
                skipped_count += 1;
                continue;
            }
        };

        let target = Path::new(&target_path);
        if !target.exists() {
            skipped_count += 1;
            continue;
        }

        if target
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("exe"))
            != Some(true)
        {
            skipped_count += 1;
            continue;
        }

        let normalized_target = target_path.to_lowercase();
        if seen_targets.contains(&normalized_target) {
            skipped_count += 1;
            continue;
        }
        seen_targets.insert(normalized_target);

        apps.push(InstalledApp {
            name: display_name.clone(),
            shortcut_path: shortcut_path.to_string(),
            target_path: target_path.clone(),
            icon: extract_icon_data_url(target),
            category: categorize_app(
                &display_name,
                &target_path,
                shortcut.category.as_deref().unwrap_or("other"),
            ),
        });
    }

    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    ScanInstalledResult {
        apps,
        metadata,
        skipped_count,
    }
}

fn should_skip_shortcut_name(name: &str) -> bool {
    let name_lower = name.to_lowercase();
    name_lower.contains("uninstall")
        || name_lower.contains("unins")
        || name_lower.contains("setup")
        || name_lower.contains("installer")
}

fn categorize_app(name: &str, target_path: &str, fallback: &str) -> String {
    let name_lower = name.to_lowercase();
    let path_lower = target_path.to_lowercase();

    if name_lower.contains("chrome")
        || name_lower.contains("firefox")
        || name_lower.contains("edge")
        || name_lower.contains("browser")
    {
        return "browser".to_string();
    }

    if name_lower.contains("visual studio")
        || name_lower.contains("vscode")
        || name_lower.contains("code")
        || name_lower.contains("git")
        || path_lower.contains("\\microsoft vs code\\")
    {
        return "development".to_string();
    }

    if name_lower.contains("word")
        || name_lower.contains("excel")
        || name_lower.contains("powerpoint")
        || name_lower.contains("office")
        || name_lower.contains("wps")
    {
        return "office".to_string();
    }

    if name_lower.contains("wechat")
        || name_lower.contains("qq")
        || name_lower.contains("dingtalk")
        || name_lower.contains("teams")
        || name_lower.contains("微信")
        || name_lower.contains("钉钉")
    {
        return "communication".to_string();
    }

    if name_lower.contains("player")
        || name_lower.contains("music")
        || name_lower.contains("video")
        || name_lower.contains("photoshop")
    {
        return "media".to_string();
    }

    fallback.to_string()
}

#[cfg(windows)]
fn resolve_shortcut_target(shortcut_path: &str) -> Result<Option<String>, String> {
    let shortcut_path_wide: Vec<u16> = shortcut_path.encode_utf16().chain(Some(0)).collect();
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|err| format!("failed to initialize COM: {err}"))?;
        let result = resolve_shortcut_target_with_com(&shortcut_path_wide);
        CoUninitialize();
        result
    }
}

#[cfg(windows)]
fn resolve_shortcut_target_with_com(shortcut_path_wide: &[u16]) -> Result<Option<String>, String> {
    unsafe {
        let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|err| format!("failed to create ShellLink: {err}"))?;
        let persist_file: IPersistFile = shell_link
            .cast()
            .map_err(|err| format!("failed to query IPersistFile: {err}"))?;
        persist_file
            .Load(PCWSTR(shortcut_path_wide.as_ptr()), STGM_READ)
            .map_err(|err| format!("failed to load shortcut: {err}"))?;

        let mut target = [0u16; 32768];
        let mut find_data = WIN32_FIND_DATAW::default();
        shell_link
            .GetPath(&mut target, &mut find_data, 0)
            .map_err(|err| format!("failed to resolve shortcut target: {err}"))?;
        let end = target
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(target.len());
        if end == 0 {
            return Ok(None);
        }
        Ok(Some(String::from_utf16_lossy(&target[..end])))
    }
}

#[cfg(not(windows))]
fn resolve_shortcut_target(_shortcut_path: &str) -> Result<Option<String>, String> {
    Ok(None)
}

fn resolve_sidecar_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut directories = Vec::new();
    let file_names = sidecar_file_names();

    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        directories.push(Path::new(&manifest_dir).join("sidecars").join("apps-cache"));
        if let Some(project_root) = Path::new(&manifest_dir).parent() {
            directories.push(project_root.join("sidecars").join("apps-cache"));
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        directories.push(resource_dir.join("sidecars").join("apps-cache"));
    }

    if let Ok(current_dir) = std::env::current_dir() {
        directories.push(current_dir.join("sidecars").join("apps-cache"));
    }

    for directory in directories {
        for file_name in &file_names {
            let candidate = directory.join(file_name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    Err(format!("Go sidecar was not found: {:?}", file_names))
}

fn sidecar_file_names() -> Vec<String> {
    let exe_suffix = if cfg!(windows) { ".exe" } else { "" };
    let mut names = vec![format!("tidydesk-apps-cache{exe_suffix}")];
    if let Some(target_triple) = target_triple() {
        names.push(format!("tidydesk-apps-cache-{target_triple}{exe_suffix}"));
    }
    names
}

fn target_triple() -> Option<&'static str> {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Some("x86_64-pc-windows-msvc")
    } else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
        Some("aarch64-pc-windows-msvc")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("x86_64-apple-darwin")
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("aarch64-apple-darwin")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("x86_64-unknown-linux-gnu")
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        Some("aarch64-unknown-linux-gnu")
    } else {
        None
    }
}

fn sidecar_request(executable_path: &Path, method: &str) -> Result<Value, String> {
    sidecar_request_with_params(executable_path, method, json!({}))
}

fn sidecar_request_with_params(
    executable_path: &Path,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let mut child = Command::new(executable_path)
        .current_dir(executable_path.parent().unwrap_or_else(|| Path::new(".")))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to start sidecar: {err}"))?;

    let request = json!({
        "id": "1",
        "method": method,
        "params": params
    });

    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "failed to open sidecar stdin".to_string())?;
        writeln!(stdin, "{request}")
            .map_err(|err| format!("failed to write sidecar request: {err}"))?;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to open sidecar stdout".to_string())?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|err| format!("failed to read sidecar response: {err}"))?;

    let _ = child.kill();
    let response: RpcResponse = serde_json::from_str(line.trim())
        .map_err(|err| format!("failed to parse sidecar response: {err}"))?;
    if !response.ok {
        return Err(response.error);
    }
    Ok(response.data)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppPickerTargetState(Mutex::new("收纳抽屉".to_string())))
        .manage(DrawerWindowState(Mutex::new(false)))
        .manage(ModuleWindowState(Mutex::new(None)))
        .manage(UserInteractionState::default())
        .manage(UpdaterSessionState::default())
        .setup(|app| {
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("TidyDesk")
                .on_menu_event(|app, event| {
                    if event.id().as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;
            let handle = app.handle().clone();
            let _ = ensure_handle_window(&handle);
            if let Ok(bounds) = drawer_window_bounds(&handle) {
                let _ = apply_window_bounds(&handle, "main", bounds);
            }
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.hide();
            }
            if let Some(window) = handle.get_webview_window("handle") {
                let _ = window.show();
                let _ = window.set_always_on_top(true);
            }
            let _ = restore_stickers(&handle);
            start_shortcut_background_services(handle.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            probe_go_sidecar,
            apps_scan_metadata,
            apps_scan_installed,
            apps_add_to_drawer,
            files_read_desktop_files,
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
            clipboard_read_text,
            events_send,
            snip_complete_selection,
            snip_cancel,
            sticker_get,
            sticker_toggle_pin,
            sticker_copy,
            sticker_save_as,
            sticker_close,
            updates_get_metadata,
            updates_get_state,
            updates_check,
            updates_download,
            updates_install,
            todos_read_state,
            todos_get_counts,
            todos_create_card,
            todos_update_card,
            todos_delete_card,
            todos_move_card,
            quick_notes_read_state,
            quick_notes_create_note,
            quick_notes_update_note,
            quick_notes_delete_note,
            open_todo_window,
            close_todo_window,
            open_app_picker_poc,
            close_app_picker_poc
        ])
        .run(tauri::generate_context!())
        .expect("failed to run TidyDesk");
}
