use super::{create_shortcut_link, desktop_path, next_available_path};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

static STORAGE_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn file_storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("storage"))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

pub fn is_protected_desktop_item(name: &str) -> bool {
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

pub fn create_drawer_shortcut(
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
    let is_from_desktop = crate::is_path_inside(source_path, &desktop_path);
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
        move_path_with_fallback(source_path, &storage_path, "file to storage")?;
    } else {
        copy_path_verified(source_path, &storage_path, "file to storage")?;
    }

    let shortcut_file_name = format!("{}.lnk", item_name.to_string_lossy());
    let shortcut_path = next_available_path(target_dir, std::ffi::OsStr::new(&shortcut_file_name));
    if let Err(err) = create_shortcut_link(&shortcut_path, &storage_path) {
        if is_from_desktop {
            let _ = move_path_with_fallback(&storage_path, source_path, "file from storage");
        } else {
            let _ = remove_path(&storage_path);
        }
        return Err(err);
    }

    Ok(shortcut_path)
}

pub fn move_path_with_fallback(
    source: &Path,
    destination: &Path,
    label: &str,
) -> Result<(), String> {
    match fs::rename(source, destination) {
        Ok(()) => Ok(()),
        Err(rename_err) => {
            if let Err(copy_err) = copy_path_verified(source, destination, label) {
                let _ = remove_path(destination);
                return Err(format!(
                    "failed to move {label}: {rename_err}; copy fallback failed: {copy_err}"
                ));
            }
            if let Err(remove_err) = remove_path(source) {
                let _ = remove_path(destination);
                return Err(format!(
                    "failed to remove original {label} after copy fallback: {remove_err}; rename failed: {rename_err}"
                ));
            }
            Ok(())
        }
    }
}

fn copy_path_verified(source: &Path, destination: &Path, label: &str) -> Result<(), String> {
    copy_path(source, destination).map_err(|err| format!("failed to copy {label}: {err}"))?;
    if let Err(err) = verify_path_copy(source, destination) {
        let _ = remove_path(destination);
        return Err(format!("failed to verify copied {label}: {err}"));
    }
    Ok(())
}

fn copy_path(source: &Path, destination: &Path) -> std::io::Result<()> {
    let metadata = fs::metadata(source)?;
    if metadata.is_dir() {
        copy_dir_recursive(source, destination)
    } else {
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(source, destination).map(|_| ())
    }
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        copy_path(&source_path, &destination_path)?;
    }
    Ok(())
}

fn verify_path_copy(source: &Path, destination: &Path) -> Result<(), String> {
    let source_metadata =
        fs::metadata(source).map_err(|err| format!("failed to inspect source: {err}"))?;
    let destination_metadata =
        fs::metadata(destination).map_err(|err| format!("failed to inspect destination: {err}"))?;
    if source_metadata.is_dir() {
        if !destination_metadata.is_dir() {
            return Err("destination is not a directory".to_string());
        }
        for entry in fs::read_dir(source).map_err(|err| format!("failed to read source: {err}"))? {
            let entry = entry.map_err(|err| format!("failed to read source entry: {err}"))?;
            verify_path_copy(&entry.path(), &destination.join(entry.file_name()))?;
        }
        Ok(())
    } else if destination_metadata.is_file() && source_metadata.len() == destination_metadata.len()
    {
        Ok(())
    } else {
        Err("destination file size does not match source".to_string())
    }
}

fn remove_path(path: &Path) -> std::io::Result<()> {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

fn storage_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let counter = STORAGE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{nanos}-{}-{counter}", std::process::id())
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
