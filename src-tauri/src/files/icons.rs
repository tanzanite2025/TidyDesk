use super::dto::{FileIconBatchPayload, FileIconResult};
use crate::files_rules::desktop_path;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[tauri::command]
pub async fn files_read_icons(
    app: AppHandle,
    payload: FileIconBatchPayload,
) -> Result<Vec<FileIconResult>, String> {
    if payload.files.len() > 100 {
        return Err("Too many icons requested (max 100 per batch)".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || files_read_icons_sync(&app, payload))
        .await
        .map_err(|err| format!("icon batch task failed: {err}"))?
}

fn files_read_icons_sync(
    app: &AppHandle,
    payload: FileIconBatchPayload,
) -> Result<Vec<FileIconResult>, String> {
    let drawer_root = crate::drawer_root(app)?;
    let desktop_dir = PathBuf::from(desktop_path());
    let resolved_drawer_root = crate::resolve_path_for_comparison(&drawer_root);
    let resolved_desktop_path = crate::resolve_path_for_comparison(&desktop_dir);
    let mut resolver: Option<crate::ShortcutResolver> = None;
    let mut icons = Vec::with_capacity(payload.files.len());

    for file in payload.files {
        if file.id.trim().is_empty() || file.path.trim().is_empty() {
            continue;
        }

        let entry_path = PathBuf::from(&file.path);
        if !crate::is_path_inside_resolved(&entry_path, &resolved_drawer_root)
            && !crate::is_path_inside_resolved(&entry_path, &resolved_desktop_path)
        {
            continue;
        }

        let icon_path =
            icon_source_path_for_entry(&entry_path, file.target_path.as_deref(), &mut resolver);

        icons.push(FileIconResult {
            id: file.id,
            icon: crate::icons::extract_icon_data_url_cached(app, &icon_path),
        });
    }

    Ok(icons)
}

fn icon_source_path_for_entry(
    entry_path: &Path,
    known_target_path: Option<&str>,
    resolver: &mut Option<crate::ShortcutResolver>,
) -> PathBuf {
    if entry_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("lnk"))
        == Some(true)
    {
        if let Some(target) = known_target_path.filter(|value| !value.trim().is_empty()) {
            let target_path = PathBuf::from(target);
            if target_path.exists() {
                return target_path;
            }
        }

        if resolver.is_none() {
            *resolver = crate::ShortcutResolver::new().ok();
        }
        if let Some(active_resolver) = resolver.as_ref() {
            if let Ok(Some(target)) =
                active_resolver.resolve_target(&entry_path.display().to_string())
            {
                let target_path = PathBuf::from(target);
                if target_path.exists() {
                    return target_path;
                }
            }
        }
    }
    entry_path.to_path_buf()
}
