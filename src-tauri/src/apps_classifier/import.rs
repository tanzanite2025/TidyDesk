use super::{classify::should_skip_shortcut_name, is_lnk_path};
use std::fs;
use std::path::{Path, PathBuf};

pub fn validate_importable_shortcut(shortcut_path: &Path) -> Result<(), String> {
    if shortcut_path.as_os_str().is_empty() {
        return Err("Missing shortcut path".to_string());
    }
    if !shortcut_path.exists() {
        return Err("Shortcut does not exist".to_string());
    }
    if !is_lnk_path(shortcut_path) {
        return Err("Only .lnk shortcuts can be added to a drawer".to_string());
    }

    let display_name = shortcut_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if should_skip_shortcut_name(display_name) {
        return Err("Installer and uninstaller shortcuts cannot be added to a drawer".to_string());
    }

    let shortcut_path_string = shortcut_path.to_string_lossy();
    let target_path = crate::resolve_shortcut_target(shortcut_path_string.as_ref())
        .map_err(|err| format!("failed to resolve shortcut target: {err}"))?
        .ok_or_else(|| "Shortcut target could not be resolved".to_string())?;
    let target = Path::new(&target_path);
    if !target.exists() {
        return Err("Shortcut target does not exist".to_string());
    }
    if target
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("exe"))
        != Some(true)
    {
        return Err("Only shortcuts targeting .exe files can be added to a drawer".to_string());
    }

    Ok(())
}

pub fn copy_shortcut_to_drawer(shortcut_path: &Path, target_dir: &Path) -> Result<PathBuf, String> {
    validate_importable_shortcut(shortcut_path)?;

    let file_name = shortcut_path
        .file_name()
        .ok_or_else(|| "Invalid shortcut path".to_string())?;
    let destination = crate::files::next_available_path(target_dir, file_name);
    fs::copy(shortcut_path, &destination)
        .map_err(|err| format!("failed to copy shortcut to drawer: {err}"))?;
    Ok(destination)
}
