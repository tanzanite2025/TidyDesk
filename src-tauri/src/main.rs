use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use windows::core::{Interface, PCWSTR};
use windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED, STGM_READ,
};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

#[derive(Debug, Serialize, Deserialize)]
struct RpcResponse {
    id: String,
    ok: bool,
    #[serde(default)]
    data: Value,
    #[serde(default)]
    error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarProbeResult {
    executable_path: String,
    ping: Value,
    version: Value,
    health: Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutMetadata {
    name: Option<String>,
    shortcut_path: Option<String>,
    category: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanMetadataResult {
    shortcuts: Vec<ShortcutMetadata>,
    scanned_paths: Vec<String>,
    duration_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledApp {
    name: String,
    shortcut_path: String,
    target_path: String,
    icon: Option<String>,
    category: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanInstalledResult {
    apps: Vec<InstalledApp>,
    metadata: ScanMetadataResult,
    skipped_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddAppToDrawerPayload {
    shortcut_path: String,
    target_folder: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AddAppToDrawerResult {
    success: bool,
    path: String,
}

#[tauri::command]
fn probe_go_sidecar(app: AppHandle) -> Result<SidecarProbeResult, String> {
    let sidecar_path = resolve_sidecar_path(&app)?;
    let ping = sidecar_request(&sidecar_path, "ping")?;
    let version = sidecar_request(&sidecar_path, "sidecar.version")?;
    let health = sidecar_request(&sidecar_path, "sidecar.health")?;

    Ok(SidecarProbeResult {
        executable_path: sidecar_path.display().to_string(),
        ping,
        version,
        health,
    })
}

#[tauri::command]
fn apps_scan_metadata(app: AppHandle) -> Result<Value, String> {
    let sidecar_path = resolve_sidecar_path(&app)?;
    sidecar_request_with_params(&sidecar_path, "apps.scanMetadata", scan_metadata_params())
}

#[tauri::command]
fn apps_scan_installed(app: AppHandle) -> Result<ScanInstalledResult, String> {
    let sidecar_path = resolve_sidecar_path(&app)?;
    let metadata_value =
        sidecar_request_with_params(&sidecar_path, "apps.scanMetadata", scan_metadata_params())?;
    let metadata: ScanMetadataResult = serde_json::from_value(metadata_value)
        .map_err(|err| format!("failed to parse apps.scanMetadata result: {err}"))?;
    Ok(complete_installed_apps(metadata))
}

#[tauri::command]
fn apps_add_to_drawer(
    app: AppHandle,
    payload: AddAppToDrawerPayload,
) -> Result<AddAppToDrawerResult, String> {
    let shortcut_path = Path::new(&payload.shortcut_path);
    if payload.shortcut_path.trim().is_empty() {
        return Err("Missing shortcut path".to_string());
    }
    if !shortcut_path.exists() {
        return Err("Shortcut does not exist".to_string());
    }
    if shortcut_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("lnk"))
        != Some(true)
    {
        return Err("Only .lnk shortcuts can be added to a drawer".to_string());
    }

    let target_dir = resolve_drawer_path(&app, &payload.target_folder)?;
    fs::create_dir_all(&target_dir).map_err(|err| format!("failed to create drawer: {err}"))?;
    let file_name = shortcut_path
        .file_name()
        .ok_or_else(|| "Invalid shortcut path".to_string())?;
    let destination = next_available_path(&target_dir, file_name);
    fs::copy(shortcut_path, &destination)
        .map_err(|err| format!("failed to copy shortcut to drawer: {err}"))?;

    Ok(AddAppToDrawerResult {
        success: true,
        path: destination.display().to_string(),
    })
}

#[tauri::command]
fn open_app_picker_poc(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("app-picker-poc") {
        window.show().map_err(|err| err.to_string())?;
        window.set_focus().map_err(|err| err.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        "app-picker-poc",
        WebviewUrl::App("index.html?mode=app-picker".into()),
    )
    .title("TidyDesk AppPicker Tauri PoC")
    .inner_size(920.0, 720.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|err| err.to_string())?;

    Ok(())
}

#[tauri::command]
fn close_app_picker_poc(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("app-picker-poc") {
        window.close().map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn scan_metadata_params() -> Value {
    json!({
        "startMenuPaths": start_menu_paths(),
        "desktopPath": desktop_path(),
        "maxDepth": 3,
        "skipDirectories": [
            "Accessories",
            "Administrative Tools",
            "Maintenance",
            "System Tools",
            "Startup"
        ]
    })
}

fn start_menu_paths() -> Vec<String> {
    let mut paths = Vec::new();
    let program_data =
        std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".to_string());
    paths.push(format!(
        "{program_data}\\Microsoft\\Windows\\Start Menu\\Programs"
    ));
    if let Ok(app_data) = std::env::var("APPDATA") {
        paths.push(format!(
            "{app_data}\\Microsoft\\Windows\\Start Menu\\Programs"
        ));
    }
    paths
}

fn desktop_path() -> String {
    std::env::var("USERPROFILE")
        .map(|profile| format!("{profile}\\Desktop"))
        .unwrap_or_else(|_| String::new())
}

fn drawer_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("drawers"))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

fn resolve_drawer_path(app: &AppHandle, folder_name: &str) -> Result<PathBuf, String> {
    let root = drawer_root(app)?;
    let target_path = root.join(safe_drawer_name(folder_name));
    if !is_path_inside(&target_path, &root) || target_path == root {
        return Err("Unsafe drawer path".to_string());
    }
    Ok(target_path)
}

fn safe_drawer_name(name: &str) -> String {
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

fn is_path_inside(child_path: &Path, parent_path: &Path) -> bool {
    let resolved_child = match child_path.canonicalize() {
        Ok(path) => path,
        Err(_) => child_path.to_path_buf(),
    };
    let resolved_parent = match parent_path.canonicalize() {
        Ok(path) => path,
        Err(_) => parent_path.to_path_buf(),
    };
    resolved_child.starts_with(resolved_parent)
}

fn next_available_path(dest_dir: &Path, file_name: &std::ffi::OsStr) -> PathBuf {
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

fn complete_installed_apps(metadata: ScanMetadataResult) -> ScanInstalledResult {
    let mut apps = Vec::new();
    let mut seen_targets = HashSet::new();
    let mut skipped_count = 0;

    for shortcut in &metadata.shortcuts {
        let shortcut_path = match shortcut.shortcut_path.as_deref() {
            Some(value) if !value.is_empty() => value,
            _ => {
                skipped_count += 1;
                continue;
            }
        };

        if Path::new(shortcut_path)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("lnk"))
            != Some(true)
        {
            skipped_count += 1;
            continue;
        }

        let display_name = shortcut
            .name
            .as_deref()
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| {
                Path::new(shortcut_path)
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "Unknown App".to_string());

        if should_skip_shortcut_name(&display_name) {
            skipped_count += 1;
            continue;
        }

        let target_path = match resolve_shortcut_target(shortcut_path) {
            Ok(Some(value)) if !value.is_empty() => value,
            _ => {
                skipped_count += 1;
                continue;
            }
        };

        let target = Path::new(&target_path);
        if !target.exists() {
            skipped_count += 1;
            continue;
        }

        if target
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("exe"))
            != Some(true)
        {
            skipped_count += 1;
            continue;
        }

        let normalized_target = target_path.to_lowercase();
        if seen_targets.contains(&normalized_target) {
            skipped_count += 1;
            continue;
        }
        seen_targets.insert(normalized_target);

        apps.push(InstalledApp {
            name: display_name.clone(),
            shortcut_path: shortcut_path.to_string(),
            target_path: target_path.clone(),
            icon: None,
            category: categorize_app(
                &display_name,
                &target_path,
                shortcut.category.as_deref().unwrap_or("other"),
            ),
        });
    }

    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    ScanInstalledResult {
        apps,
        metadata,
        skipped_count,
    }
}

fn should_skip_shortcut_name(name: &str) -> bool {
    let name_lower = name.to_lowercase();
    name_lower.contains("uninstall")
        || name_lower.contains("unins")
        || name_lower.contains("setup")
        || name_lower.contains("installer")
}

fn categorize_app(name: &str, target_path: &str, fallback: &str) -> String {
    let name_lower = name.to_lowercase();
    let path_lower = target_path.to_lowercase();

    if name_lower.contains("chrome")
        || name_lower.contains("firefox")
        || name_lower.contains("edge")
        || name_lower.contains("browser")
    {
        return "browser".to_string();
    }

    if name_lower.contains("visual studio")
        || name_lower.contains("vscode")
        || name_lower.contains("code")
        || name_lower.contains("git")
        || path_lower.contains("\\microsoft vs code\\")
    {
        return "development".to_string();
    }

    if name_lower.contains("word")
        || name_lower.contains("excel")
        || name_lower.contains("powerpoint")
        || name_lower.contains("office")
        || name_lower.contains("wps")
    {
        return "office".to_string();
    }

    if name_lower.contains("wechat")
        || name_lower.contains("qq")
        || name_lower.contains("dingtalk")
        || name_lower.contains("teams")
        || name_lower.contains("微信")
        || name_lower.contains("钉钉")
    {
        return "communication".to_string();
    }

    if name_lower.contains("player")
        || name_lower.contains("music")
        || name_lower.contains("video")
        || name_lower.contains("photoshop")
    {
        return "media".to_string();
    }

    fallback.to_string()
}

#[cfg(windows)]
fn resolve_shortcut_target(shortcut_path: &str) -> Result<Option<String>, String> {
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
fn resolve_shortcut_target(_shortcut_path: &str) -> Result<Option<String>, String> {
    Ok(None)
}

fn resolve_sidecar_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut directories = Vec::new();
    let file_names = sidecar_file_names();

    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        directories.push(Path::new(&manifest_dir).join("sidecars").join("apps-cache"));
        if let Some(project_root) = Path::new(&manifest_dir).parent() {
            directories.push(project_root.join("sidecars").join("apps-cache"));
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        directories.push(resource_dir.join("sidecars").join("apps-cache"));
    }

    if let Ok(current_dir) = std::env::current_dir() {
        directories.push(current_dir.join("sidecars").join("apps-cache"));
    }

    for directory in directories {
        for file_name in &file_names {
            let candidate = directory.join(file_name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    Err(format!("Go sidecar was not found: {:?}", file_names))
}

fn sidecar_file_names() -> Vec<String> {
    let exe_suffix = if cfg!(windows) { ".exe" } else { "" };
    let mut names = vec![format!("tidydesk-apps-cache{exe_suffix}")];
    if let Some(target_triple) = target_triple() {
        names.push(format!("tidydesk-apps-cache-{target_triple}{exe_suffix}"));
    }
    names
}

fn target_triple() -> Option<&'static str> {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Some("x86_64-pc-windows-msvc")
    } else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
        Some("aarch64-pc-windows-msvc")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("x86_64-apple-darwin")
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("aarch64-apple-darwin")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("x86_64-unknown-linux-gnu")
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        Some("aarch64-unknown-linux-gnu")
    } else {
        None
    }
}

fn sidecar_request(executable_path: &Path, method: &str) -> Result<Value, String> {
    sidecar_request_with_params(executable_path, method, json!({}))
}

fn sidecar_request_with_params(
    executable_path: &Path,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let mut child = Command::new(executable_path)
        .current_dir(executable_path.parent().unwrap_or_else(|| Path::new(".")))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to start sidecar: {err}"))?;

    let request = json!({
        "id": "1",
        "method": method,
        "params": params
    });

    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "failed to open sidecar stdin".to_string())?;
        writeln!(stdin, "{request}")
            .map_err(|err| format!("failed to write sidecar request: {err}"))?;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to open sidecar stdout".to_string())?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|err| format!("failed to read sidecar response: {err}"))?;

    let _ = child.kill();
    let response: RpcResponse = serde_json::from_str(line.trim())
        .map_err(|err| format!("failed to parse sidecar response: {err}"))?;
    if !response.ok {
        return Err(response.error);
    }
    Ok(response.data)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("TidyDesk Tauri PoC")
                .on_menu_event(|app, event| {
                    if event.id().as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            probe_go_sidecar,
            apps_scan_metadata,
            apps_scan_installed,
            apps_add_to_drawer,
            open_app_picker_poc,
            close_app_picker_poc
        ])
        .run(tauri::generate_context!())
        .expect("failed to run TidyDesk Tauri PoC");
}
