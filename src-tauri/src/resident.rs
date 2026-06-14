use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

const RESIDENT_SETTINGS_FILE: &str = "resident.json";
const OPEN_SETTINGS_EVENT: &str = "open-settings-panel";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentSettings {
    pub launch_minimized: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentSettingsSnapshot {
    pub autostart_enabled: bool,
    pub launch_minimized: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentSettingsUpdate {
    #[serde(default)]
    pub autostart_enabled: Option<bool>,
    #[serde(default)]
    pub launch_minimized: Option<bool>,
}

impl Default for ResidentSettings {
    fn default() -> Self {
        Self {
            launch_minimized: false,
        }
    }
}

pub fn read_resident_settings(app: &AppHandle) -> ResidentSettings {
    load_resident_settings(app).unwrap_or_default()
}

#[tauri::command]
pub fn resident_get_settings(app: AppHandle) -> Result<ResidentSettingsSnapshot, String> {
    resident_settings_snapshot(&app)
}

#[tauri::command]
pub fn resident_update_settings(
    app: AppHandle,
    payload: ResidentSettingsUpdate,
) -> Result<ResidentSettingsSnapshot, String> {
    if let Some(enabled) = payload.autostart_enabled {
        let manager = app.autolaunch();
        if enabled {
            manager
                .enable()
                .map_err(|err| format!("failed to enable autostart: {err}"))?;
        } else {
            manager
                .disable()
                .map_err(|err| format!("failed to disable autostart: {err}"))?;
        }
    }

    let mut settings = read_resident_settings(&app);
    if let Some(launch_minimized) = payload.launch_minimized {
        settings.launch_minimized = launch_minimized;
        write_resident_settings(&app, &settings)?;
    }

    resident_settings_snapshot(&app)
}

#[tauri::command]
pub fn resident_show_handle(app: AppHandle) -> Result<(), String> {
    show_handle_window(&app)
}

#[tauri::command]
pub fn resident_hide_handle(app: AppHandle) -> Result<(), String> {
    hide_handle_window(&app)
}

#[tauri::command]
pub fn resident_open_settings(app: AppHandle) -> Result<(), String> {
    open_resident_settings(&app)
}

pub fn show_handle_window(app: &AppHandle) -> Result<(), String> {
    crate::shell::ensure_handle_window(app)?;
    crate::shell::apply_window_bounds(
        app,
        "handle",
        crate::shell::handle_window_bounds(app, false)?,
    )?;
    if let Some(window) = app.get_webview_window("handle") {
        window.show().map_err(|err| err.to_string())?;
        window.set_focus().map_err(|err| err.to_string())?;
        window
            .set_always_on_top(true)
            .map_err(|err| err.to_string())?;
    }
    let shell = app.state::<crate::shell::ShellState>();
    crate::shell::update_shell_state(app, &shell, false, None)
}

pub fn hide_handle_window(app: &AppHandle) -> Result<(), String> {
    for label in ["main", "handle", "todos", "app-picker", "capture"] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.hide();
        }
    }
    let shell = app.state::<crate::shell::ShellState>();
    crate::shell::update_shell_state(app, &shell, false, None)
}

pub fn open_resident_settings(app: &AppHandle) -> Result<(), String> {
    crate::shell::ensure_handle_window(app)?;
    crate::shell::ensure_drawer_window(app)?;
    crate::shell::apply_window_bounds(app, "main", crate::shell::drawer_window_bounds(app)?)?;
    crate::shell::apply_window_bounds(
        app,
        "handle",
        crate::shell::handle_window_bounds(app, true)?,
    )?;

    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|err| err.to_string())?;
        window.set_focus().map_err(|err| err.to_string())?;
    }
    if let Some(window) = app.get_webview_window("handle") {
        window.show().map_err(|err| err.to_string())?;
        window
            .set_always_on_top(false)
            .map_err(|err| err.to_string())?;
    }

    let shell = app.state::<crate::shell::ShellState>();
    crate::shell::update_shell_state(app, &shell, true, Some("files".to_string()))?;

    let handle = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(250));
        let _ = handle.emit(OPEN_SETTINGS_EVENT, ());
    });
    Ok(())
}

fn resident_settings_snapshot(app: &AppHandle) -> Result<ResidentSettingsSnapshot, String> {
    let settings = read_resident_settings(app);
    let autostart_enabled = app
        .autolaunch()
        .is_enabled()
        .map_err(|err| format!("failed to read autostart state: {err}"))?;

    Ok(ResidentSettingsSnapshot {
        autostart_enabled,
        launch_minimized: settings.launch_minimized,
    })
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data dir: {err}"))?
        .join("settings")
        .join(RESIDENT_SETTINGS_FILE))
}

fn load_resident_settings(app: &AppHandle) -> Result<ResidentSettings, String> {
    let path = settings_path(app)?;
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content)
            .map_err(|err| format!("failed to parse resident settings: {err}")),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(ResidentSettings::default()),
        Err(err) => Err(format!("failed to read resident settings: {err}")),
    }
}

fn write_resident_settings(app: &AppHandle, settings: &ResidentSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    crate::persistence::atomic_write_json(&path, settings, "resident settings")
}
