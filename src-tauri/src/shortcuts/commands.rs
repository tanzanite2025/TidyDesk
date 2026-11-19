use super::repair::{
    attempt_shortcut_repair, shortcuts_validate_all_internal, RepairShortcutPayload,
    RepairShortcutResult, ShortcutValidationStats,
};
use std::path::PathBuf;
use tauri::AppHandle;

#[tauri::command]
pub async fn shortcuts_validate_all(app: AppHandle) -> Result<ShortcutValidationStats, String> {
    tauri::async_runtime::spawn_blocking(move || shortcuts_validate_all_internal(&app))
        .await
        .map_err(|err| format!("shortcut validation task failed: {err}"))?
}

#[tauri::command]
pub async fn shortcuts_repair(
    app: AppHandle,
    payload: RepairShortcutPayload,
) -> Result<RepairShortcutResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::prepare_drawer_storage(&app)?;
        if payload.shortcut_path.trim().is_empty() || payload.target_path.trim().is_empty() {
            return Err("Missing shortcutPath or targetPath".to_string());
        }

        let shortcut_path = PathBuf::from(&payload.shortcut_path);
        let drawer_root = crate::drawer_root(&app)?;
        if !crate::is_path_inside(&shortcut_path, &drawer_root) {
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
    })
    .await
    .map_err(|err| format!("shortcut repair task failed: {err}"))?
}
