use super::ShellBounds;
use serde_json::json;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex,
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Default)]
pub struct ShellWindowSnapshot {
    pub expanded: bool,
    pub active_module: Option<String>,
}

#[derive(Debug, Default)]
pub struct ShellState {
    snapshot: Mutex<ShellWindowSnapshot>,
    /// Serializes `WebviewWindowBuilder::build()` calls across threads to avoid Win32/WebView2 STA startup races.
    window_build_lock: Mutex<()>,
    pub(super) handle_events_registered: AtomicBool,
    pub(super) handle_bounds_generation: AtomicU64,
    pub(super) cached_handle_bounds: Mutex<Option<ShellBounds>>,
}

pub fn with_window_build_lock<T, F>(app: &AppHandle, op: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    let state = app.state::<ShellState>();
    let _guard = state
        .window_build_lock
        .lock()
        .map_err(|_| "failed to lock window build mutex".to_string())?;
    op()
}

pub fn bump_handle_bounds_generation(app: &AppHandle, bounds: ShellBounds) -> u64 {
    let state = app.state::<ShellState>();
    if let Ok(mut cached) = state.cached_handle_bounds.lock() {
        *cached = Some(bounds);
    }
    state
        .handle_bounds_generation
        .fetch_add(1, Ordering::AcqRel)
        + 1
}

pub fn is_current_handle_bounds_generation(app: &AppHandle, generation: u64) -> bool {
    app.state::<ShellState>()
        .handle_bounds_generation
        .load(Ordering::Acquire)
        == generation
}

pub fn read_cached_handle_bounds(app: &AppHandle) -> Option<ShellBounds> {
    app.state::<ShellState>()
        .cached_handle_bounds
        .lock()
        .ok()
        .and_then(|guard| *guard)
}

pub fn set_cached_handle_bounds(app: &AppHandle, bounds: ShellBounds) {
    if let Ok(mut cached) = app.state::<ShellState>().cached_handle_bounds.lock() {
        *cached = Some(bounds);
    }
}

pub fn update_shell_state(
    app: &AppHandle,
    shell: &tauri::State<'_, ShellState>,
    expanded: bool,
    active_module: Option<String>,
) -> Result<(), String> {
    let snapshot = {
        let mut current = shell
            .snapshot
            .lock()
            .map_err(|_| "failed to lock shell state".to_string())?;
        current.expanded = expanded;
        current.active_module = active_module.clone();
        current.clone()
    };
    broadcast_shell_state(app, &snapshot)
}

pub fn update_active_module(
    app: &AppHandle,
    shell: &tauri::State<'_, ShellState>,
    active_module: Option<String>,
) -> Result<(), String> {
    let expanded = shell
        .snapshot
        .lock()
        .map_err(|_| "failed to lock shell state".to_string())?
        .expanded;
    update_shell_state(app, shell, expanded, active_module)
}

pub fn shell_snapshot(shell: &tauri::State<'_, ShellState>) -> Result<ShellWindowSnapshot, String> {
    Ok(shell
        .snapshot
        .lock()
        .map_err(|_| "failed to lock shell state".to_string())?
        .clone())
}

pub fn broadcast_shell_state(
    app: &AppHandle,
    snapshot: &ShellWindowSnapshot,
) -> Result<(), String> {
    let payload = json!({
        "expanded": snapshot.expanded,
        "activeModule": snapshot.active_module.clone(),
    });

    if let Some(window) = app.get_webview_window("handle") {
        window
            .emit("module-state", payload)
            .map_err(|err| err.to_string())?;
    }

    Ok(())
}
