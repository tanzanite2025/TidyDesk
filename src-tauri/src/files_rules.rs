use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

static STORAGE_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn desktop_path() -> String {
    std::env::var("USERPROFILE")
        .map(|profile| format!("{profile}\\Desktop"))
        .unwrap_or_else(|_| String::new())
}

pub fn file_storage_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("storage"))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

pub fn file_extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default()
}

pub fn modified_at(metadata: &fs::Metadata) -> String {
    metadata
        .modified()
        .unwrap_or(UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

pub fn path_identity(path: &Path, metadata: &fs::Metadata) -> String {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("item")
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    format!("{}-{}-{file_name}", metadata.len(), modified_at(metadata))
}

pub fn category_by_extension(ext: &str, file_name: &str) -> String {
    let name_lower = file_name.to_lowercase();
    let ext_lower = ext.trim_start_matches('.').to_lowercase();

    if name_lower.starts_with("新建")
        || name_lower.starts_with("untitled")
        || name_lower.contains("screenshot")
        || name_lower.starts_with("temp")
        || name_lower.starts_with("tmp")
    {
        return "temporary".to_string();
    }

    if matches!(
        ext_lower.as_str(),
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "svg" | "webp" | "ico"
    ) {
        return "image".to_string();
    }
    if matches!(
        ext_lower.as_str(),
        "doc"
            | "docx"
            | "xls"
            | "xlsx"
            | "ppt"
            | "pptx"
            | "pdf"
            | "txt"
            | "csv"
            | "md"
            | "key"
            | "numbers"
            | "pages"
    ) {
        return "document".to_string();
    }
    if matches!(
        ext_lower.as_str(),
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2"
    ) {
        return "archive".to_string();
    }
    if matches!(
        ext_lower.as_str(),
        "exe" | "msi" | "bat" | "cmd" | "dmg" | "pkg" | "lnk" | "url"
    ) {
        return "app".to_string();
    }
    if matches!(
        ext_lower.as_str(),
        "ts" | "tsx"
            | "js"
            | "jsx"
            | "json"
            | "html"
            | "css"
            | "py"
            | "go"
            | "rs"
            | "cpp"
            | "h"
            | "java"
            | "sh"
            | "yaml"
            | "yml"
    ) {
        return "developer".to_string();
    }

    "other".to_string()
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

pub fn resolve_drawer_path(app: &AppHandle, folder_name: &str) -> Result<PathBuf, String> {
    let root = crate::drawer_root(app)?;
    let target_path = root.join(safe_drawer_name(folder_name));
    if !crate::is_path_inside(&target_path, &root) || target_path == root {
        return Err("Unsafe drawer path".to_string());
    }
    Ok(target_path)
}

pub fn resolve_drawer_entry_path(
    app: &AppHandle,
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
            if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || ch.is_control()
            {
                '_'
            } else {
                ch
            }
        })
        .take(80)
        .collect()
}

pub fn next_available_path(dest_dir: &Path, file_name: &std::ffi::OsStr) -> PathBuf {
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
        fs::rename(source_path, &storage_path)
            .map_err(|err| format!("failed to move file to storage: {err}"))?;
    } else {
        fs::copy(source_path, &storage_path)
            .map_err(|err| format!("failed to copy file to storage: {err}"))?;
    }

    let shortcut_file_name = format!("{}.lnk", item_name.to_string_lossy());
    let shortcut_path = next_available_path(target_dir, std::ffi::OsStr::new(&shortcut_file_name));
    if let Err(err) = create_shortcut_link(&shortcut_path, &storage_path) {
        if is_from_desktop {
            let _ = fs::rename(&storage_path, source_path);
        } else {
            let _ = fs::remove_file(&storage_path);
        }
        return Err(err);
    }

    Ok(shortcut_path)
}

pub fn storage_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let counter = STORAGE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{nanos}-{}-{counter}", std::process::id())
}

pub fn is_system_path(path: &Path) -> bool {
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

#[cfg(windows)]
use windows::core::{Interface, PCWSTR};
#[cfg(windows)]
use windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW;
#[cfg(windows)]
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED, STGM_READ,
};
#[cfg(windows)]
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

#[cfg(windows)]
pub fn create_shortcut_link(shortcut_path: &Path, target_path: &Path) -> Result<(), String> {
    let description = format!(
        "TidyDesk managed file: {}",
        target_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
    );
    write_shortcut_link(shortcut_path, target_path, &description)
}

#[cfg(not(windows))]
pub fn create_shortcut_link(_shortcut_path: &Path, _target_path: &Path) -> Result<(), String> {
    Err("Creating shortcuts is only implemented for Windows in this PoC".to_string())
}

#[cfg(windows)]
pub fn open_path_with_shell(path: &Path) -> Result<(), String> {
    std::process::Command::new("rundll32.exe")
        .arg("url.dll,FileProtocolHandler")
        .arg(path)
        .spawn()
        .map_err(|err| format!("failed to open path: {err}"))?;
    Ok(())
}

#[cfg(not(windows))]
pub fn open_path_with_shell(_path: &Path) -> Result<(), String> {
    Err("Opening files is only implemented for Windows in this PoC".to_string())
}

#[cfg(windows)]
pub fn write_shortcut_link(
    shortcut_path: &Path,
    target_path: &Path,
    description: &str,
) -> Result<(), String> {
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|err| format!("failed to initialize COM: {err}"))?;
        let result = write_shortcut_link_with_com(shortcut_path, target_path, description);
        CoUninitialize();
        result
    }
}

#[cfg(windows)]
fn write_shortcut_link_with_com(
    shortcut_path: &Path,
    target_path: &Path,
    description: &str,
) -> Result<(), String> {
    unsafe {
        let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|err| format!("failed to create ShellLink: {err}"))?;
        let target_wide: Vec<u16> = target_path
            .display()
            .to_string()
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let working_dir = if target_path.is_dir() {
            target_path
        } else {
            target_path.parent().unwrap_or_else(|| Path::new(""))
        };
        let working_dir_wide: Vec<u16> = working_dir
            .display()
            .to_string()
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let description_wide: Vec<u16> = format!("{}", description)
            .encode_utf16()
            .chain(Some(0))
            .collect();

        shell_link
            .SetPath(PCWSTR(target_wide.as_ptr()))
            .map_err(|err| format!("failed to set shortcut target: {err}"))?;
        shell_link
            .SetWorkingDirectory(PCWSTR(working_dir_wide.as_ptr()))
            .map_err(|err| format!("failed to set shortcut cwd: {err}"))?;
        shell_link
            .SetDescription(PCWSTR(description_wide.as_ptr()))
            .map_err(|err| format!("failed to set shortcut description: {err}"))?;
        let persist_file: IPersistFile = shell_link
            .cast()
            .map_err(|err| format!("failed to query IPersistFile: {err}"))?;
        let shortcut_wide: Vec<u16> = shortcut_path
            .display()
            .to_string()
            .encode_utf16()
            .chain(Some(0))
            .collect();
        persist_file
            .Save(PCWSTR(shortcut_wide.as_ptr()), true)
            .map_err(|err| format!("failed to save shortcut: {err}"))?;
        Ok(())
    }
}

#[cfg(not(windows))]
pub fn write_shortcut_link(
    _shortcut_path: &Path,
    _target_path: &Path,
    _description: &str,
) -> Result<(), String> {
    Err("Creating shortcuts is only implemented for Windows in this PoC".to_string())
}

#[cfg(windows)]
pub fn resolve_shortcut_target(shortcut_path: &str) -> Result<Option<String>, String> {
    let shortcut_path_wide: Vec<u16> = shortcut_path.encode_utf16().chain(Some(0)).collect();
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|err| format!("failed to initialize COM: {err}"))?;
        let result = resolve_shortcut_target_with_com(&shortcut_path_wide);
        CoUninitialize();
        result
    }
}

#[cfg(windows)]
fn resolve_shortcut_target_with_com(shortcut_path_wide: &[u16]) -> Result<Option<String>, String> {
    unsafe {
        let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|err| format!("failed to create ShellLink: {err}"))?;
        let persist_file: IPersistFile = shell_link
            .cast()
            .map_err(|err| format!("failed to query IPersistFile: {err}"))?;
        persist_file
            .Load(PCWSTR(shortcut_path_wide.as_ptr()), STGM_READ)
            .map_err(|err| format!("failed to load shortcut: {err}"))?;

        let mut target = [0u16; 32768];
        let mut find_data = WIN32_FIND_DATAW::default();
        shell_link
            .GetPath(&mut target, &mut find_data, 0)
            .map_err(|err| format!("failed to resolve shortcut target: {err}"))?;
        let end = target
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(target.len());
        if end == 0 {
            return Ok(None);
        }
        Ok(Some(String::from_utf16_lossy(&target[..end])))
    }
}

#[cfg(not(windows))]
pub fn resolve_shortcut_target(_shortcut_path: &str) -> Result<Option<String>, String> {
    Ok(None)
}
