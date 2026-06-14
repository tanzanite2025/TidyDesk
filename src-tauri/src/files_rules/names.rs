use std::ffi::OsStr;
use std::path::{Path, PathBuf};

pub fn desktop_path() -> String {
    std::env::var("USERPROFILE")
        .map(|profile| format!("{profile}\\Desktop"))
        .unwrap_or_else(|_| String::new())
}

pub fn resolve_drawer_path(app: &tauri::AppHandle, folder_name: &str) -> Result<PathBuf, String> {
    let root = crate::drawer_root(app)?;
    let target_path = root.join(safe_drawer_name(folder_name));
    if !crate::is_path_inside(&target_path, &root) || target_path == root {
        return Err("Unsafe drawer path".to_string());
    }
    Ok(target_path)
}

pub fn resolve_drawer_entry_path(
    app: &tauri::AppHandle,
    folder_name: &str,
    entry_name: &str,
) -> Result<PathBuf, String> {
    let drawer_path = resolve_drawer_path(app, folder_name)?;
    let safe_name = safe_drawer_entry_name(entry_name)?;
    let direct_path = drawer_path.join(&safe_name);
    if !crate::is_path_inside(&direct_path, &drawer_path) {
        return Err("Unsafe drawer entry path".to_string());
    }
    if direct_path.exists() {
        return Ok(direct_path);
    }

    if Path::new(&safe_name).extension().is_none() {
        let shortcut_path = drawer_path.join(format!("{safe_name}.lnk"));
        if !crate::is_path_inside(&shortcut_path, &drawer_path) {
            return Err("Unsafe drawer entry path".to_string());
        }
        if shortcut_path.exists() {
            return Ok(shortcut_path);
        }
    }

    Ok(direct_path)
}

pub fn safe_drawer_entry_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Missing drawer entry name".to_string());
    }
    let file_name = Path::new(trimmed)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Invalid drawer entry name".to_string())?;
    if file_name != trimmed {
        return Err("Unsafe drawer entry name".to_string());
    }
    Ok(file_name.to_string())
}

pub fn drawer_entry_rename_target(old_path: &Path, new_name: &str) -> String {
    let trimmed = new_name.trim();
    if Path::new(trimmed).extension().is_some() {
        return trimmed.to_string();
    }

    match old_path.extension().and_then(|value| value.to_str()) {
        Some(extension) if !extension.is_empty() => format!("{trimmed}.{extension}"),
        _ => trimmed.to_string(),
    }
}

pub fn safe_drawer_name(name: &str) -> String {
    let trimmed = name.trim();
    let value = if trimmed.is_empty() {
        "收纳抽屉"
    } else {
        trimmed
    };
    value
        .chars()
        .map(|ch| {
            if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
                || ch.is_control()
            {
                '_'
            } else {
                ch
            }
        })
        .take(80)
        .collect()
}

pub fn next_available_path(dest_dir: &Path, file_name: &OsStr) -> PathBuf {
    let mut candidate = dest_dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let source = Path::new(file_name);
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("shortcut");
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    let mut index = 1;
    while candidate.exists() {
        candidate = dest_dir.join(format!("{stem} ({index}){extension}"));
        index += 1;
    }
    candidate
}
