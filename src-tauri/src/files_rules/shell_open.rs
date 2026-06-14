use std::path::Path;

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
