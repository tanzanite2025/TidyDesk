use std::path::Path;

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
    Err("Creating shortcuts is only implemented on Windows".to_string())
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
    Err("Creating shortcuts is only implemented on Windows".to_string())
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
