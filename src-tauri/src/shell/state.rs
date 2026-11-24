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
    pub(super) animation_generation: AtomicU64,
    pub(super) drawer_ready: AtomicBool,
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

pub(super) fn next_animation_generation(shell: &tauri::State<'_, ShellState>) -> u64 {
    shell.animation_generation.fetch_add(1, Ordering::Relaxed) + 1
}

pub fn broadcast_shell_state(
    app: &AppHandle,
    snapshot: &ShellWindowSnapshot,
) -> Result<(), String> {
    let payload = json!({
        "expanded": snapshot.expanded,
        "activeModule": snapshot.active_module.clone(),
    });

    for label in ["handle", "main"] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .emit("drawer-state", payload.clone())
                .map_err(|err| err.to_string())?;
        }
    }

    for label in ["handle", "main"] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .emit("module-state", payload.clone())
                .map_err(|err| err.to_string())?;
        }
    }

    Ok(())
}
