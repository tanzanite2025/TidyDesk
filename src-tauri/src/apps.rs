use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewWindowBuilder};
use tauri::State;

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
pub struct SidecarProbeResult {
    pub executable_path: String,
    pub ping: Value,
    pub version: Value,
    pub health: Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutMetadata {
    pub name: Option<String>,
    pub shortcut_path: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanMetadataResult {
    pub shortcuts: Vec<ShortcutMetadata>,
    pub scanned_paths: Vec<String>,
    pub duration_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub name: String,
    pub shortcut_path: String,
    pub target_path: String,
    pub icon: Option<String>,
    pub category: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanInstalledResult {
    pub apps: Vec<InstalledApp>,
    pub metadata: ScanMetadataResult,
    pub skipped_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddAppToDrawerResult {
    pub success: bool,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddAppToDrawerPayload {
    pub shortcut_path: String,
    pub target_folder: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAppPickerPayload {
    pub target_folder: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPickerTargetResult {
    pub target_folder: String,
}

#[derive(Debug)]
pub struct AppPickerTargetState(pub std::sync::Mutex<String>);

#[tauri::command]
pub fn probe_go_sidecar(app: AppHandle) -> Result<SidecarProbeResult, String> {
    let executable_path = resolve_sidecar_path(&app)?;
    let ping = sidecar_request(&app, "ping")?;
    let version = sidecar_request(&app, "sidecar.version")?;
    let health = sidecar_request(&app, "sidecar.health")?;

    Ok(SidecarProbeResult {
        executable_path: executable_path.display().to_string(),
        ping,
        version,
        health,
    })
}

#[tauri::command]
pub fn apps_scan_metadata(app: AppHandle) -> Result<Value, String> {
    sidecar_request_with_params(&app, "apps.scanMetadata", scan_metadata_params())
}

#[tauri::command]
pub fn apps_scan_installed(app: AppHandle) -> Result<ScanInstalledResult, String> {
    let metadata_value =
        sidecar_request_with_params(&app, "apps.scanMetadata", scan_metadata_params())?;
    let metadata: ScanMetadataResult = serde_json::from_value(metadata_value)
        .map_err(|err| format!("failed to parse apps.scanMetadata result: {err}"))?;
    Ok(complete_installed_apps(metadata))
}

#[tauri::command]
pub fn apps_add_to_drawer(
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

    let target_dir = crate::files::resolve_drawer_path(&app, &payload.target_folder)?;
    fs::create_dir_all(&target_dir).map_err(|err| format!("failed to create drawer: {err}"))?;
    let file_name = shortcut_path
        .file_name()
        .ok_or_else(|| "Invalid shortcut path".to_string())?;
    let destination = crate::files::next_available_path(&target_dir, file_name);
    fs::copy(shortcut_path, &destination)
        .map_err(|err| format!("failed to copy shortcut to drawer: {err}"))?;

    Ok(AddAppToDrawerResult {
        success: true,
        path: destination.display().to_string(),
    })
}

#[tauri::command]
pub fn open_app_picker_poc(
    app: AppHandle,
    state: State<'_, AppPickerTargetState>,
    payload: Option<OpenAppPickerPayload>,
) -> Result<(), String> {
    let target_folder = if let Some(target_folder) = payload
        .and_then(|value| value.target_folder)
        .map(|value| crate::files::safe_drawer_name(&value))
        .filter(|value| !value.is_empty())
    {
        let mut current = state
            .0
            .lock()
            .map_err(|_| "failed to lock app picker target".to_string())?;
        *current = target_folder;
        current.clone()
    } else {
        state
            .0
            .lock()
            .map_err(|_| "failed to lock app picker target".to_string())?
            .clone()
    };

    if let Some(window) = app.get_webview_window("app-picker-poc") {
        window.show().map_err(|err| err.to_string())?;
        window.set_focus().map_err(|err| err.to_string())?;
        window
            .emit("set-target-folder", target_folder)
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(&app, "app-picker-poc", crate::shell::webview_url_for_mode("app-picker")?)
    .title("TidyDesk AppPicker Tauri PoC")
    .inner_size(920.0, 720.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|err| err.to_string())?;
    window.show().map_err(|err| err.to_string())?;
    window
        .emit("set-target-folder", target_folder)
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn apps_get_picker_target(
    state: State<'_, AppPickerTargetState>,
) -> Result<AppPickerTargetResult, String> {
    let target_folder = state
        .0
        .lock()
        .map_err(|_| "failed to lock app picker target".to_string())?
        .clone();
    Ok(AppPickerTargetResult { target_folder })
}

#[tauri::command]
pub fn close_app_picker_poc(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("app-picker-poc") {
        window.close().map_err(|err| err.to_string())?;
    }
    Ok(())
}

// --- Sidecar process management ---

#[derive(Debug)]
struct SidecarProcess {
    child: Child,
    reader: BufReader<std::process::ChildStdout>,
    next_id: u64,
}

impl SidecarProcess {
    fn spawn(executable_path: &Path) -> Result<Self, String> {
        let mut child = Command::new(executable_path)
            .current_dir(executable_path.parent().unwrap_or_else(|| Path::new(".")))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|err| format!("failed to start sidecar: {err}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "failed to open sidecar stdout".to_string())?;
        let reader = BufReader::new(stdout);

        Ok(Self {
            child,
            reader,
            next_id: 1,
        })
    }

    fn is_alive(&mut self) -> bool {
        match self.child.try_wait() {
            Ok(Some(_)) => false,
            Ok(None) => true,
            Err(_) => false,
        }
    }

    fn send(&mut self, method: &str, params: Value) -> Result<String, String> {
        let id = self.next_id;
        self.next_id += 1;

        let request = json!({
            "id": id.to_string(),
            "method": method,
            "params": params
        });

        let stdin = self
            .child
            .stdin
            .as_mut()
            .ok_or_else(|| "sidecar stdin not available".to_string())?;
        writeln!(stdin, "{request}")
            .map_err(|err| format!("failed to write sidecar request: {err}"))?;
        stdin
            .flush()
            .map_err(|err| format!("failed to flush sidecar stdin: {err}"))?;

        let mut line = String::new();
        self.reader
            .read_line(&mut line)
            .map_err(|err| format!("failed to read sidecar response: {err}"))?;

        Ok(line)
    }

    fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for SidecarProcess {
    fn drop(&mut self) {
        self.kill();
    }
}

#[derive(Debug, Default)]
pub struct SidecarState {
    process: Mutex<Option<SidecarProcess>>,
}

fn sidecar_call(app: &AppHandle, method: &str, params: Value) -> Result<Value, String> {
    let state = app.state::<SidecarState>();
    let mut guard = state.process.lock().map_err(|_| "failed to lock sidecar state".to_string())?;

    let needs_restart = match guard.as_mut() {
        Some(p) => !p.is_alive(),
        None => true,
    };

    if needs_restart {
        if let Some(mut p) = guard.take() {
            p.kill();
        }
        let path = resolve_sidecar_path(app)?;
        *guard = Some(SidecarProcess::spawn(&path)?);
    }

    let proc = guard
        .as_mut()
        .ok_or_else(|| "sidecar process not available".to_string())?;

    let line = proc.send(method, params)?;
    let response: RpcResponse = serde_json::from_str(line.trim())
        .map_err(|err| format!("failed to parse sidecar response: {err}"))?;
    if !response.ok {
        return Err(response.error);
    }
    Ok(response.data)
}

// --- Helper functions ---

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

        let target_path = match crate::resolve_shortcut_target(shortcut_path) {
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
            icon: crate::extract_icon_data_url(target),
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

fn scan_metadata_params() -> Value {
    json!({
        "startMenuPaths": start_menu_paths(),
        "desktopPath": crate::files::desktop_path(),
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
    if let Ok(program_data) = std::env::var("PROGRAMDATA") {
        paths.push(format!(
            "{program_data}\\Microsoft\\Windows\\Start Menu\\Programs"
        ));
    }
    if let Ok(app_data) = std::env::var("APPDATA") {
        paths.push(format!(
            "{app_data}\\Microsoft\\Windows\\Start Menu\\Programs"
        ));
    }
    paths
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

fn sidecar_request(app: &AppHandle, method: &str) -> Result<Value, String> {
    sidecar_call(app, method, json!({}))
}

fn sidecar_request_with_params(
    app: &AppHandle,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    sidecar_call(app, method, params)
}
