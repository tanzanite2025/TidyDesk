use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

pub fn timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

pub fn drawer_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("drawers"))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

pub fn is_path_inside(child_path: &Path, parent_path: &Path) -> bool {
    let resolved_child = resolve_path_for_comparison(child_path);
    let resolved_parent = resolve_path_for_comparison(parent_path);
    resolved_child.starts_with(resolved_parent)
}

fn resolve_path_for_comparison(path: &Path) -> PathBuf {
    if let Ok(resolved) = path.canonicalize() {
        return resolved;
    }

    let mut suffix: Vec<OsString> = Vec::new();
    let mut current = path;
    while let Some(parent) = current.parent() {
        if let Some(name) = current.file_name() {
            suffix.push(name.to_os_string());
        }
        if let Ok(mut resolved) = parent.canonicalize() {
            for part in suffix.iter().rev() {
                resolved.push(part);
            }
            return resolved;
        }
        current = parent;
    }

    path.to_path_buf()
}

pub fn prepare_drawer_storage(app: &AppHandle) -> Result<(), String> {
    let root = drawer_root(app)?;
    fs::create_dir_all(&root).map_err(|err| format!("failed to create drawer root: {err}"))?;
    let storage_root = crate::files::file_storage_root(app)?;
    fs::create_dir_all(storage_root)
        .map_err(|err| format!("failed to create storage root: {err}"))?;
    let default_drawer = crate::files::resolve_drawer_path(app, "收纳抽屉")?;
    fs::create_dir_all(default_drawer)
        .map_err(|err| format!("failed to create default drawer: {err}"))?;
    Ok(())
}
