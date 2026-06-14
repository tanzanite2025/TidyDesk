use serde::Serialize;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
#[cfg(windows)]
use windows::core::PCWSTR;
#[cfg(windows)]
use windows::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

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
        replace_file(&temp_path, path, label)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }

    result
}

#[cfg(windows)]
fn replace_file(temp_path: &Path, path: &Path, label: &str) -> Result<(), String> {
    let from: Vec<u16> = temp_path.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        MoveFileExW(
            PCWSTR(from.as_ptr()),
            PCWSTR(to.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
        .map_err(|err| format!("failed to replace {label}: {err}"))
    }
}

#[cfg(not(windows))]
fn replace_file(temp_path: &Path, path: &Path, label: &str) -> Result<(), String> {
    fs::rename(temp_path, path).map_err(|err| format!("failed to replace {label}: {err}"))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("tidydesk-{name}-{}-{unique}", std::process::id()));
        fs::create_dir_all(&dir).expect("failed to create temp test directory");
        dir
    }

    #[test]
    fn atomic_write_text_replaces_existing_file() {
        let root = temp_test_dir("atomic-replace");
        let path = root.join("state.json");

        atomic_write_text(&path, "{\"version\":1}", "test state")
            .expect("first write should succeed");
        atomic_write_text(&path, "{\"version\":2}", "test state")
            .expect("second write should replace existing file");

        assert_eq!(
            fs::read_to_string(&path).expect("state should be readable"),
            "{\"version\":2}"
        );
    }
}
