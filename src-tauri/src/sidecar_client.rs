use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    mpsc::{self, Receiver, RecvTimeoutError, Sender},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[cfg(test)]
const SIDECAR_REQUEST_TIMEOUT: Duration = Duration::from_millis(1200);
#[cfg(not(test))]
const SIDECAR_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
#[cfg(test)]
const SIDECAR_WORKER_RESPONSE_TIMEOUT: Duration = Duration::from_millis(2200);
#[cfg(not(test))]
const SIDECAR_WORKER_RESPONSE_TIMEOUT: Duration = Duration::from_secs(25);
const SIDECAR_REQUEST_RETRIES: usize = 1;

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

#[derive(Debug)]
struct SidecarRpcIo {
    reader: BufReader<ChildStdout>,
    stdin: ChildStdin,
}

pub struct SidecarProcess {
    child: Arc<Mutex<Child>>,
    rpc_io: Arc<Mutex<SidecarRpcIo>>,
    next_id: Arc<AtomicU64>,
}

impl Clone for SidecarProcess {
    fn clone(&self) -> Self {
        Self {
            child: Arc::clone(&self.child),
            rpc_io: Arc::clone(&self.rpc_io),
            next_id: Arc::clone(&self.next_id),
        }
    }
}

impl SidecarProcess {
    pub fn spawn(executable_path: &Path) -> Result<Self, String> {
        let mut child = Command::new(executable_path)
            .current_dir(executable_path.parent().unwrap_or_else(|| Path::new(".")))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|err| format!("failed to start sidecar: {err}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "failed to open sidecar stdout".to_string())?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "failed to open sidecar stdin".to_string())?;

        Ok(Self {
            child: Arc::new(Mutex::new(child)),
            rpc_io: Arc::new(Mutex::new(SidecarRpcIo {
                reader: BufReader::new(stdout),
                stdin,
            })),
            next_id: Arc::new(AtomicU64::new(1)),
        })
    }

    pub fn is_alive(&self) -> bool {
        let Ok(mut child) = self.child.lock() else {
            return false;
        };

        match child.try_wait() {
            Ok(Some(_)) => false,
            Ok(None) => true,
            Err(_) => false,
        }
    }

    fn send_and_parse(&self, method: &str, params: Value) -> Result<Value, String> {
        let request_id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();

        let request = json!({
            "id": request_id,
            "method": method,
            "params": params
        });

        let mut rpc_io = self
            .rpc_io
            .lock()
            .map_err(|_| "failed to lock sidecar rpc io".to_string())?;

        writeln!(rpc_io.stdin, "{request}")
            .map_err(|err| format!("failed to write sidecar request: {err}"))?;
        rpc_io
            .stdin
            .flush()
            .map_err(|err| format!("failed to flush sidecar stdin: {err}"))?;

        let mut line = String::new();
        rpc_io
            .reader
            .read_line(&mut line)
            .map_err(|err| format!("failed to read sidecar response: {err}"))?;

        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Err(format!(
                "sidecar closed stdout before replying to `{method}`"
            ));
        }

        let response: RpcResponse = serde_json::from_str(trimmed)
            .map_err(|err| format!("failed to parse sidecar response: {err}"))?;
        if response.id != request["id"].as_str().unwrap_or_default() {
            return Err(format!(
                "sidecar returned mismatched response id for `{method}`"
            ));
        }
        if !response.ok {
            return Err(response.error);
        }
        Ok(response.data)
    }

    pub fn request_with_timeout(&self, method: &str, params: Value) -> Result<Value, String> {
        let process = self.clone();
        let method_name = method.to_string();
        let (result_tx, result_rx) = mpsc::channel();

        std::thread::spawn(move || {
            let result = process.send_and_parse(&method_name, params);
            let _ = result_tx.send(result);
        });

        match result_rx.recv_timeout(SIDECAR_REQUEST_TIMEOUT) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => {
                self.kill();
                Err(format!(
                    "sidecar request `{method}` timed out after {} seconds",
                    SIDECAR_REQUEST_TIMEOUT.as_secs()
                ))
            }
            Err(RecvTimeoutError::Disconnected) => Err(format!(
                "sidecar request worker disconnected for `{method}`"
            )),
        }
    }

    pub fn kill(&self) {
        let Ok(mut child) = self.child.lock() else {
            return;
        };
        let _ = child.kill();
        let _ = child.wait();
    }
}

pub struct SidecarWorkerRequest {
    pub method: String,
    pub params: Value,
    pub response_tx: Sender<Result<Value, String>>,
}

#[derive(Clone)]
pub struct SidecarWorkerHandle {
    pub request_tx: Sender<SidecarWorkerRequest>,
}

#[derive(Default)]
pub struct SidecarState {
    pub worker: Mutex<Option<SidecarWorkerHandle>>,
}

pub fn sidecar_call(app: &AppHandle, method: &str, params: Value) -> Result<Value, String> {
    let mut last_error = None;

    for _ in 0..=1 {
        let handle = ensure_sidecar_worker(app)?;
        let (response_tx, response_rx) = mpsc::channel();
        let request = SidecarWorkerRequest {
            method: method.to_string(),
            params: params.clone(),
            response_tx,
        };

        if handle.request_tx.send(request).is_err() {
            clear_sidecar_worker(app)?;
            last_error = Some("failed to send request to sidecar worker".to_string());
            continue;
        }

        match response_rx.recv_timeout(SIDECAR_WORKER_RESPONSE_TIMEOUT) {
            Ok(result) => return result,
            Err(RecvTimeoutError::Timeout) => {
                clear_sidecar_worker(app)?;
                last_error = Some(format!(
                    "sidecar worker did not reply within {} seconds",
                    SIDECAR_WORKER_RESPONSE_TIMEOUT.as_secs()
                ));
            }
            Err(RecvTimeoutError::Disconnected) => {
                clear_sidecar_worker(app)?;
                last_error = Some("sidecar worker disconnected before replying".to_string());
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "sidecar request failed".to_string()))
}

pub fn ensure_sidecar_worker(app: &AppHandle) -> Result<SidecarWorkerHandle, String> {
    let state = app.state::<SidecarState>();
    let mut worker = state
        .worker
        .lock()
        .map_err(|_| "failed to lock sidecar state".to_string())?;

    if let Some(handle) = worker.as_ref() {
        return Ok(handle.clone());
    }

    let handle = spawn_sidecar_worker(app.clone());
    *worker = Some(handle.clone());
    Ok(handle)
}

pub fn clear_sidecar_worker(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<SidecarState>();
    let mut worker = state
        .worker
        .lock()
        .map_err(|_| "failed to lock sidecar state".to_string())?;
    *worker = None;
    Ok(())
}

fn spawn_sidecar_worker(app: AppHandle) -> SidecarWorkerHandle {
    let (request_tx, request_rx) = mpsc::channel();
    std::thread::spawn(move || run_sidecar_worker(app, request_rx));
    SidecarWorkerHandle { request_tx }
}

fn run_sidecar_worker(app: AppHandle, request_rx: Receiver<SidecarWorkerRequest>) {
    let mut process = None;

    for request in request_rx {
        let result = execute_sidecar_request(&app, &mut process, &request.method, request.params);
        let _ = request.response_tx.send(result);
    }

    if let Some(process) = process.take() {
        process.kill();
    }
}

fn execute_sidecar_request(
    app: &AppHandle,
    process: &mut Option<SidecarProcess>,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let executable_path = resolve_sidecar_path(app)?;
    execute_sidecar_request_at_path(&executable_path, process, method, params)
}

pub fn execute_sidecar_request_at_path(
    executable_path: &Path,
    process: &mut Option<SidecarProcess>,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let mut last_error = None;

    for attempt in 0..=SIDECAR_REQUEST_RETRIES {
        let sidecar = ensure_sidecar_process_at_path(executable_path, process)?;
        match sidecar.request_with_timeout(method, params.clone()) {
            Ok(value) => return Ok(value),
            Err(err) => {
                eprintln!(
                    "[TIDYDESK] Sidecar request `{method}` failed on attempt {}: {err}",
                    attempt + 1
                );
                sidecar.kill();
                *process = None;
                last_error = Some(err);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| format!("sidecar request `{method}` failed")))
}

fn ensure_sidecar_process_at_path(
    executable_path: &Path,
    process: &mut Option<SidecarProcess>,
) -> Result<SidecarProcess, String> {
    let needs_restart = match process.as_ref() {
        Some(sidecar) => !sidecar.is_alive(),
        None => true,
    };

    if needs_restart {
        if let Some(existing) = process.take() {
            existing.kill();
        }
        *process = Some(SidecarProcess::spawn(executable_path)?);
    }

    process
        .as_ref()
        .cloned()
        .ok_or_else(|| "sidecar process not available".to_string())
}

pub fn resolve_sidecar_path(app: &AppHandle) -> Result<PathBuf, String> {
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

pub fn sidecar_request(app: &AppHandle, method: &str) -> Result<Value, String> {
    sidecar_call(app, method, json!({}))
}

pub fn sidecar_request_with_params(
    app: &AppHandle,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    sidecar_call(app, method, params)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
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

    fn write_windows_sidecar_wrapper(
        dir: &Path,
        script_name: &str,
        script_body: &str,
    ) -> Result<PathBuf, String> {
        let script_path = dir.join(script_name);
        fs::write(&script_path, script_body)
            .map_err(|err| format!("failed to write sidecar test script: {err}"))?;
        let wrapper_path = dir.join("mock-sidecar.cmd");
        let wrapper_body = format!(
            "@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0{}\"\r\n",
            script_name
        );
        fs::write(&wrapper_path, wrapper_body)
            .map_err(|err| format!("failed to write sidecar test wrapper: {err}"))?;
        Ok(wrapper_path)
    }

    #[cfg(windows)]
    #[test]
    fn sidecar_request_timeout_kills_stuck_process() {
        let root = temp_test_dir("sidecar-timeout");
        let executable_path = write_windows_sidecar_wrapper(
            &root,
            "hang.ps1",
            r#"
$line = [Console]::In.ReadLine()
if ($null -ne $line) {
  Start-Sleep -Milliseconds 2500
}
"#,
        )
        .expect("failed to prepare mock sidecar");

        let process =
            SidecarProcess::spawn(&executable_path).expect("failed to spawn mock sidecar");
        let result = process.request_with_timeout("ping", json!({}));

        assert!(result.is_err());
        assert!(!process.is_alive());
    }

    #[cfg(windows)]
    #[test]
    fn execute_sidecar_request_restarts_after_timeout() {
        let root = temp_test_dir("sidecar-restart");
        let state_path = root.join("state.txt");
        let script_body = format!(
            r#"
$statePath = '{}'
$line = [Console]::In.ReadLine()
if (-not (Test-Path $statePath)) {{
  Set-Content -Path $statePath -Value 'first'
  Start-Sleep -Milliseconds 2500
  exit 0
}}
$request = $line | ConvertFrom-Json
$response = @{{
  id = $request.id
  ok = $true
  data = @{{
    pong = 'mock-sidecar'
  }}
}} | ConvertTo-Json -Compress
[Console]::Out.WriteLine($response)
"#,
            state_path.display()
        );
        let executable_path = write_windows_sidecar_wrapper(&root, "flaky.ps1", &script_body)
            .expect("failed to prepare flaky mock sidecar");

        let mut process = None;
        let value =
            execute_sidecar_request_at_path(&executable_path, &mut process, "ping", json!({}))
                .expect("request should recover after timeout");

        assert_eq!(value["pong"], "mock-sidecar");
        assert!(state_path.exists());
        let live_process = process.expect("worker should keep a restarted process");
        assert!(live_process.is_alive());
        live_process.kill();
    }
}
