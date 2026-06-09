use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use tauri::AppHandle;
use crate::files_rules::*;
pub use crate::files_rules::{resolve_drawer_path, file_storage_root, desktop_path, safe_drawer_name, next_available_path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopFile {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub category: String,
    pub extension: String,
    pub modified_at: String,
    pub is_simulated: bool,
    pub parent_id: Option<String>,
    pub is_valid: Option<bool>,
    pub target_path: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopFolder {
    pub id: String,
    pub name: String,
    pub path: String,
    pub category: String,
    pub modified_at: String,
    pub is_simulated: bool,
    pub parent_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopFilesResult {
    pub files: Vec<DesktopFile>,
    pub folders: Vec<DesktopFolder>,
    pub desktop_path: String,
    pub tidy_box_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameItemPayload {
    pub old_name: String,
    pub new_name: String,
    pub parent_folder: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteItemPayload {
    pub name: String,
    pub parent_folder: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFilePayload {
    pub file_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportExternalFilesPayload {
    pub file_paths: Vec<String>,
    pub target_folder: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFileResult {
    pub source: String,
    pub shortcut: String,
    pub mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportExternalFilesResult {
    pub success: bool,
    pub added: Vec<ImportedFileResult>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreToDesktopPayload {
    pub shortcut_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreToDesktopResult {
    pub success: bool,
    pub restored_path: String,
}

#[tauri::command]
pub fn files_read_desktop_files(app: AppHandle) -> Result<DesktopFilesResult, String> {
    crate::prepare_drawer_storage(&app)?;

    let desktop_path = PathBuf::from(desktop_path());
    let drawer_root = crate::drawer_root(&app)?;
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
                icon: crate::extract_icon_data_url(&path),
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
                let resolved = crate::resolve_shortcut_target(&entry_path.display().to_string())
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
                icon: crate::extract_icon_data_url(&icon_source_path),
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
pub fn drawers_create(app: AppHandle, name: String) -> Result<serde_json::Value, String> {
    let target_path = resolve_drawer_path(&app, &name)?;
    fs::create_dir_all(&target_path).map_err(|err| format!("failed to create drawer: {err}"))?;
    Ok(json!({
        "success": true,
        "path": target_path.display().to_string()
    }))
}

#[tauri::command]
pub fn drawers_rename_item(
    app: AppHandle,
    payload: RenameItemPayload,
) -> Result<serde_json::Value, String> {
    if payload.old_name.trim().is_empty() || payload.new_name.trim().is_empty() {
        return Err("oldName and newName are required".to_string());
    }

    if let Some(parent_folder) = payload.parent_folder.as_deref() {
        let drawer_path = resolve_drawer_path(&app, parent_folder)?;
        let old_path = resolve_drawer_entry_path(&app, parent_folder, &payload.old_name)?;
        let new_name =
            safe_drawer_entry_name(&drawer_entry_rename_target(&old_path, &payload.new_name))?;
        let new_path = drawer_path.join(new_name);
        if !crate::is_path_inside(&new_path, &drawer_path) {
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
    let root = crate::drawer_root(&app)?;
    if !crate::is_path_inside(&old_path, &root) || !crate::is_path_inside(&new_path, &root) {
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
pub fn drawers_delete_item(
    app: AppHandle,
    payload: DeleteItemPayload,
) -> Result<serde_json::Value, String> {
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
    let root = crate::drawer_root(&app)?;
    if !crate::is_path_inside(&drawer_path, &root) {
        return Err("Unsafe delete path".to_string());
    }
    if drawer_path.exists() {
        fs::remove_dir_all(drawer_path).map_err(|err| format!("failed to delete drawer: {err}"))?;
    }
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub fn files_open(app: AppHandle, payload: OpenFilePayload) -> Result<serde_json::Value, String> {
    if payload.file_path.trim().is_empty() {
        return Err("Missing file path".to_string());
    }

    let drawer_root = crate::drawer_root(&app)?;
    let resolved_path = PathBuf::from(&payload.file_path);
    if !crate::is_path_inside(&resolved_path, &drawer_root) {
        return Err("Only drawer entries can be opened from TidyDesk.".to_string());
    }
    if !resolved_path.exists() {
        return Err("Drawer entry does not exist".to_string());
    }

    open_path_with_shell(&resolved_path)?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub fn files_import_external_files(
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

    crate::prepare_drawer_storage(&app)?;
    let target_dir = resolve_drawer_path(&app, payload.target_folder.as_deref().unwrap_or(""))?;
    fs::create_dir_all(&target_dir).map_err(|err| format!("failed to create drawer: {err}"))?;
    let drawer_root = crate::drawer_root(&app)?;
    let mut added = Vec::new();

    for file_path in payload.file_paths {
        let source_path = PathBuf::from(file_path);
        if !source_path.exists() {
            continue;
        }
        let resolved_source = source_path
            .canonicalize()
            .map_err(|err| format!("failed to resolve source path: {err}"))?;
        if crate::is_path_inside(&resolved_source, &drawer_root) {
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
pub fn files_restore_to_desktop(
    app: AppHandle,
    payload: RestoreToDesktopPayload,
) -> Result<RestoreToDesktopResult, String> {
    if payload.shortcut_path.trim().is_empty() {
        return Err("Missing shortcut path".to_string());
    }

    let shortcut_path = PathBuf::from(&payload.shortcut_path);
    let drawer_root = crate::drawer_root(&app)?;
    if !crate::is_path_inside(&shortcut_path, &drawer_root) {
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

    let target_path = crate::resolve_shortcut_target(&shortcut_path.display().to_string())?
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Target file does not exist".to_string())?;
    let target_path = PathBuf::from(target_path);
    if !target_path.exists() {
        return Err("Target file does not exist".to_string());
    }

    let storage_root = file_storage_root(&app)?;
    if !crate::is_path_inside(&target_path, &storage_root) {
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


