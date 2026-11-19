use super::dto::{RestoreToDesktopPayload, RestoreToDesktopResult};
use crate::files_rules::{
    desktop_path, file_storage_root, move_path_with_fallback, next_available_path,
};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[tauri::command]
pub async fn files_restore_to_desktop(
    app: AppHandle,
    payload: RestoreToDesktopPayload,
) -> Result<RestoreToDesktopResult, String> {
    tauri::async_runtime::spawn_blocking(move || files_restore_to_desktop_sync(&app, payload))
        .await
        .map_err(|err| format!("restore file task failed: {err}"))?
}

fn files_restore_to_desktop_sync(
    app: &AppHandle,
    payload: RestoreToDesktopPayload,
) -> Result<RestoreToDesktopResult, String> {
    if payload.shortcut_path.trim().is_empty() {
        return Err("Missing shortcut path".to_string());
    }

    let shortcut_path = PathBuf::from(&payload.shortcut_path);
    let drawer_root = crate::drawer_root(app)?;
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

    let storage_root = file_storage_root(app)?;
    if !crate::is_path_inside(&target_path, &storage_root) {
        return Err("File is not managed by TidyDesk (not in storage)".to_string());
    }

    let desktop_dir = PathBuf::from(desktop_path());
    let file_name = target_path
        .file_name()
        .ok_or_else(|| "Invalid target file name".to_string())?;
    let destination = next_available_path(&desktop_dir, file_name);
    let staged_shortcut_path = stage_restore_shortcut_delete(&shortcut_path)?;
    if let Err(err) = move_path_with_fallback(&target_path, &destination, "file to desktop") {
        if let Err(restore_err) = fs::rename(&staged_shortcut_path, &shortcut_path) {
            return Err(format!(
                "{err}; additionally failed to restore shortcut: {restore_err}"
            ));
        }
        return Err(err);
    }
    if let Err(err) = fs::remove_file(&staged_shortcut_path) {
        eprintln!(
            "[TIDYDESK] Failed to remove staged restore shortcut {}: {err}",
            staged_shortcut_path.display()
        );
    }

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

fn stage_restore_shortcut_delete(shortcut_path: &Path) -> Result<PathBuf, String> {
    let staged_path = staged_restore_shortcut_delete_path(shortcut_path);
    fs::rename(shortcut_path, &staged_path)
        .map_err(|err| format!("failed to stage shortcut deletion: {err}"))?;
    Ok(staged_path)
}

fn staged_restore_shortcut_delete_path(shortcut_path: &Path) -> PathBuf {
    let file_name = shortcut_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("shortcut.lnk");
    shortcut_path.with_file_name(format!(
        "{file_name}.restore.{}.deleting",
        crate::timestamp_string()
    ))
}
