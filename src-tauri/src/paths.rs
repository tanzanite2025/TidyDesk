use std::ffi::OsString;
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

pub fn legacy_local_storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("storage"))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

pub fn is_path_inside(child_path: &Path, parent_path: &Path) -> bool {
    let resolved_parent = resolve_path_for_comparison(parent_path);
    is_path_inside_resolved(child_path, &resolved_parent)
}

/// 配合外部预解析好的根目录路径使用，避免在高频循环中重复对同一父目录执行 canonicalize
pub fn is_path_inside_resolved(child_path: &Path, resolved_parent: &Path) -> bool {
    let resolved_child = resolve_path_for_comparison(child_path);
    resolved_child.starts_with(resolved_parent)
}

pub fn resolve_path_for_comparison(path: &Path) -> PathBuf {
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
