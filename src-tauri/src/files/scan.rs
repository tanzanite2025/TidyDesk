use super::dto::{DesktopFile, DesktopFilesResult, DesktopFolder, OpenFilePayload};
use crate::files_rules::*;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[tauri::command]
pub async fn files_read_desktop_files(app: AppHandle) -> Result<DesktopFilesResult, String> {
    tauri::async_runtime::spawn_blocking(move || files_read_desktop_files_sync(&app))
        .await
        .map_err(|err| format!("desktop scan task failed: {err}"))?
}

fn files_read_desktop_files_sync(app: &AppHandle) -> Result<DesktopFilesResult, String> {
    crate::prepare_drawer_storage(app)?;

    let desktop_dir = PathBuf::from(desktop_path());
    let drawer_root = crate::drawer_root(app)?;
    let storage_root = file_storage_root(app)?;
    let resolved_storage_root = crate::resolve_path_for_comparison(&storage_root);
    let resolver = crate::ShortcutResolver::new().ok();
    let mut files = Vec::new();
    let mut folders = Vec::new();
    let mut file_counter = 0usize;
    let mut folder_counter = 0usize;

    if desktop_dir.exists() {
        let desktop_entries = fs::read_dir(&desktop_dir)
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
                is_managed: false,
                target_path: None,
                icon: None,
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
            let mut is_managed = false;
            let mut target_path = None;

            if extension.eq_ignore_ascii_case(".lnk") {
                display_name = entry_path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or(&entry_name)
                    .to_string();
                let resolved = resolver
                    .as_ref()
                    .and_then(|res| res.resolve_target(&entry_path.display().to_string()).ok())
                    .flatten();
                is_valid = Some(
                    resolved
                        .as_deref()
                        .map(|value| Path::new(value).exists())
                        .unwrap_or(false),
                );
                is_managed = resolved
                    .as_deref()
                    .map(|value| {
                        crate::is_path_inside_resolved(Path::new(value), &resolved_storage_root)
                    })
                    .unwrap_or(false);
                target_path = resolved;
            }

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
                is_managed,
                target_path,
                icon: None,
            });
        }
    }

    Ok(DesktopFilesResult {
        files,
        folders,
        desktop_path: desktop_dir.display().to_string(),
        tidy_box_path: drawer_root.display().to_string(),
    })
}

#[tauri::command]
pub async fn files_open(
    app: AppHandle,
    payload: OpenFilePayload,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|err| format!("open file task failed: {err}"))?
}
