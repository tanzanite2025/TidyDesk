use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

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
            open_app_picker_poc,
            close_app_picker_poc
        ])
        .run(tauri::generate_context!())
        .expect("failed to run TidyDesk Tauri PoC");
}
