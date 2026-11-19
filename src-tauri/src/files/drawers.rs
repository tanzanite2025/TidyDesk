use super::dto::{DeleteItemPayload, RenameItemPayload};
use crate::files_rules::{
    drawer_entry_rename_target, file_storage_root, move_path_with_fallback, next_available_path,
    resolve_drawer_entry_path, resolve_drawer_path, safe_drawer_entry_name,
};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

fn managed_storage_target(
    app: &AppHandle,
    shortcut_path: &Path,
) -> Result<Option<PathBuf>, String> {
    if shortcut_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| !value.eq_ignore_ascii_case("lnk"))
        .unwrap_or(true)
    {
        return Ok(None);
    }

    let target_path = match crate::resolve_shortcut_target(&shortcut_path.display().to_string()) {
        Ok(Some(target)) if !target.is_empty() => PathBuf::from(target),
        Ok(_) | Err(_) => return Ok(None),
    };
    if !target_path.exists() {
        return Ok(None);
    }

    let storage_root = file_storage_root(app)?;
    if crate::is_path_inside(&target_path, &storage_root) {
        Ok(Some(target_path))
    } else {
        Ok(None)
    }
}

fn ensure_delete_does_not_orphan_managed_storage(
    app: &AppHandle,
    target_path: &Path,
) -> Result<(), String> {
    let metadata =
        fs::metadata(target_path).map_err(|err| format!("failed to inspect item: {err}"))?;
    if metadata.is_dir() {
        for entry in
            fs::read_dir(target_path).map_err(|err| format!("failed to read drawer: {err}"))?
        {
            let entry = entry.map_err(|err| format!("failed to read drawer entry: {err}"))?;
            ensure_delete_does_not_orphan_managed_storage(app, &entry.path())?;
        }
        return Ok(());
    }

    if managed_storage_target(app, target_path)?.is_some() {
        return Err(
            "该快捷入口指向 TidyDesk storage 中的文件。请先还原到桌面，再删除快捷入口。"
                .to_string(),
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn drawers_create(app: AppHandle, name: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target_path = resolve_drawer_path(&app, &name)?;
        fs::create_dir_all(&target_path)
            .map_err(|err| format!("failed to create drawer: {err}"))?;
        Ok(json!({
            "success": true,
            "path": target_path.display().to_string()
        }))
    })
    .await
    .map_err(|err| format!("create drawer task failed: {err}"))?
}

#[tauri::command]
pub async fn drawers_rename_item(
    app: AppHandle,
    payload: RenameItemPayload,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || drawers_rename_item_sync(&app, payload))
        .await
        .map_err(|err| format!("rename drawer item task failed: {err}"))?
}

fn drawers_rename_item_sync(
    app: &AppHandle,
    payload: RenameItemPayload,
) -> Result<serde_json::Value, String> {
    if payload.old_name.trim().is_empty() || payload.new_name.trim().is_empty() {
        return Err("oldName and newName are required".to_string());
    }

    if let Some(parent_folder) = payload.parent_folder.as_deref() {
        let drawer_path = resolve_drawer_path(app, parent_folder)?;
        let old_path = resolve_drawer_entry_path(app, parent_folder, &payload.old_name)?;
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
        move_path_with_fallback(&old_path, &target_path, "drawer item rename")?;
        return Ok(json!({ "success": true }));
    }

    let old_path = resolve_drawer_path(app, &payload.old_name)?;
    let new_path = resolve_drawer_path(app, &payload.new_name)?;
    let root = crate::drawer_root(app)?;
    if !crate::is_path_inside(&old_path, &root) || !crate::is_path_inside(&new_path, &root) {
        return Err("Unsafe rename path".to_string());
    }
    if !old_path.exists() {
        return Err("Drawer does not exist".to_string());
    }
    if new_path.exists() {
        return Err("A drawer with this name already exists".to_string());
    }

    move_path_with_fallback(&old_path, &new_path, "drawer rename")?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn drawers_delete_item(
    app: AppHandle,
    payload: DeleteItemPayload,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || drawers_delete_item_sync(&app, payload))
        .await
        .map_err(|err| format!("delete drawer item task failed: {err}"))?
}

fn drawers_delete_item_sync(
    app: &AppHandle,
    payload: DeleteItemPayload,
) -> Result<serde_json::Value, String> {
    if payload.name.trim().is_empty() {
        return Err("Delete requires name.".to_string());
    }

    if let Some(parent_folder) = payload.parent_folder.as_deref() {
        let target_path = resolve_drawer_entry_path(app, parent_folder, &payload.name)?;
        if !target_path.exists() {
            return Err("Drawer entry does not exist".to_string());
        }
        ensure_delete_does_not_orphan_managed_storage(app, &target_path)?;
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

    let drawer_path = resolve_drawer_path(app, &payload.name)?;
    let root = crate::drawer_root(app)?;
    if !crate::is_path_inside(&drawer_path, &root) {
        return Err("Unsafe delete path".to_string());
    }
    if drawer_path.exists() {
        ensure_delete_does_not_orphan_managed_storage(app, &drawer_path)?;
        fs::remove_dir_all(drawer_path).map_err(|err| format!("failed to delete drawer: {err}"))?;
    }
    Ok(json!({ "success": true }))
}
