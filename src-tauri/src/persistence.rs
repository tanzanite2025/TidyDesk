use serde::Serialize;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn atomic_write_json<T: Serialize>(path: &Path, value: &T, label: &str) -> Result<(), String> {
    let content = serde_json::to_string_pretty(value)
        .map_err(|err| format!("failed to serialize {label}: {err}"))?;
    atomic_write_text(path, &content, label)
}

pub fn atomic_write_text(path: &Path, content: &str, label: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create {label} parent: {err}"))?;
    }

    let temp_path = temporary_path(path);
    let result = (|| {
        let mut file = File::create(&temp_path)
            .map_err(|err| format!("failed to create temporary {label}: {err}"))?;
        file.write_all(content.as_bytes())
            .map_err(|err| format!("failed to write temporary {label}: {err}"))?;
        file.sync_all()
            .map_err(|err| format!("failed to sync temporary {label}: {err}"))?;
        drop(file);
        fs::rename(&temp_path, path).map_err(|err| format!("failed to replace {label}: {err}"))
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }

    result
}

pub fn backup_corrupt_file(path: &Path, label: &str) -> Result<PathBuf, String> {
    let backup_path = corrupt_backup_path(path);
    fs::rename(path, &backup_path)
        .map_err(|err| format!("failed to back up corrupt {label}: {err}"))?;
    Ok(backup_path)
}

fn temporary_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("data");
    path.with_file_name(format!(
        ".{file_name}.tmp-{}-{}",
        crate::timestamp_string(),
        std::process::id()
    ))
}

fn corrupt_backup_path(path: &Path) -> PathBuf {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("data");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("json");
    let timestamp = crate::timestamp_string();

    if extension.is_empty() {
        path.with_file_name(format!("{stem}.corrupt-{timestamp}"))
    } else {
        path.with_file_name(format!("{stem}.corrupt-{timestamp}.{extension}"))
    }
}
