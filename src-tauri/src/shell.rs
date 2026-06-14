use serde_json::json;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};
use url::Url;

#[derive(Debug, Clone, Default)]
pub struct ShellWindowSnapshot {
    pub expanded: bool,
    pub active_module: Option<String>,
}

#[derive(Debug, Default)]
pub struct ShellState {
    snapshot: Mutex<ShellWindowSnapshot>,
    animation_generation: AtomicU64,
}

#[derive(Debug, Clone)]
pub struct ShellBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

const DRAWER_ANIMATION_STEPS: u32 = 12;
const DRAWER_WINDOW_LABEL: &str = "main";
const HANDLE_WINDOW_LABEL: &str = "handle";

pub fn set_handle_always_on_top(app: &AppHandle, always_on_top: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
        window
            .set_always_on_top(always_on_top)
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

pub fn apply_drawer_state(
    app: &AppHandle,
    shell: &tauri::State<'_, ShellState>,
    expanded: bool,
) -> Result<(), String> {
    let previous = shell_snapshot(shell)?;
    let handle_from = handle_window_bounds(app, previous.expanded)?;
    let handle_to = handle_window_bounds(app, expanded)?;

    let animation_generation = next_animation_generation(shell);

    if expanded {
        hide_module_windows(app)?;
        ensure_drawer_window(app)?;
        let drawer_target = drawer_window_bounds(app)?;
        let drawer_start = drawer_hidden_bounds(app, &drawer_target)?;
        let next_active_module = match previous.active_module.as_deref() {
            Some("capture") => Some("capture".to_string()),
            Some("files") => Some("files".to_string()),
            _ => Some("files".to_string()),
        };
        apply_window_bounds(app, DRAWER_WINDOW_LABEL, drawer_start.clone())?;
        if let Some(window) = app.get_webview_window(DRAWER_WINDOW_LABEL) {
            window.show().map_err(|err| err.to_string())?;
            window.set_focus().map_err(|err| err.to_string())?;
        }
        if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
            window.show().map_err(|err| err.to_string())?;
        }
        set_handle_always_on_top(app, false)?;
        animate_window_bounds(
            app.clone(),
            DRAWER_WINDOW_LABEL,
            drawer_start,
            drawer_target,
            false,
            animation_generation,
        );
        animate_window_bounds(
            app.clone(),
            HANDLE_WINDOW_LABEL,
            handle_from,
            handle_to,
            false,
            animation_generation,
        );
        update_shell_state(app, shell, true, next_active_module)?;
    } else {
        let drawer_from = drawer_window_bounds(app)?;
        let drawer_target = drawer_hidden_bounds(app, &drawer_from)?;
        apply_window_bounds(app, DRAWER_WINDOW_LABEL, drawer_from.clone())?;
        if app.get_webview_window(DRAWER_WINDOW_LABEL).is_some() {
            animate_window_bounds(
                app.clone(),
                DRAWER_WINDOW_LABEL,
                drawer_from,
                drawer_target,
                true,
                animation_generation,
            );
        }
        if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
            window.show().map_err(|err| err.to_string())?;
        }
        set_handle_always_on_top(app, true)?;
        animate_window_bounds(
            app.clone(),
            HANDLE_WINDOW_LABEL,
            handle_from,
            handle_to,
            false,
            animation_generation,
        );
        let active_module = previous.active_module;
        let next_module = if active_module.as_deref() == Some("files") {
            None
        } else {
            active_module
        };
        update_shell_state(app, shell, false, next_module)?;
    }
    Ok(())
}

pub fn hide_drawer_window_now(
    app: &AppHandle,
    shell: &tauri::State<'_, ShellState>,
) -> Result<(), String> {
    next_animation_generation(shell);
    if let Some(window) = app.get_webview_window(DRAWER_WINDOW_LABEL) {
        window.hide().map_err(|err| err.to_string())?;
    }
    apply_window_bounds(app, HANDLE_WINDOW_LABEL, handle_window_bounds(app, false)?)?;
    if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
        window.show().map_err(|err| err.to_string())?;
    }
    set_handle_always_on_top(app, true)?;
    let previous = shell_snapshot(shell)?;
    let next_module = if previous.active_module.as_deref() == Some("files") {
        None
    } else {
        previous.active_module
    };
    update_shell_state(app, shell, false, next_module)
}

pub fn close_active_module(
    app: &AppHandle,
    shell: &tauri::State<'_, ShellState>,
) -> Result<(), String> {
    next_animation_generation(shell);
    let current = shell_snapshot(shell)?;
    let active_module = current.active_module.clone();
    if active_module.as_deref() == Some("files") {
        return apply_drawer_state(app, shell, false);
    }
    if let Some(module) = active_module {
        if let Some(window) = app.get_webview_window(&module) {
            window.hide().map_err(|err| err.to_string())?;
        }
    }
    apply_window_bounds(app, HANDLE_WINDOW_LABEL, handle_window_bounds(app, false)?)?;
    if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
        window.show().map_err(|err| err.to_string())?;
    }
    set_handle_always_on_top(app, true)?;
    update_shell_state(app, shell, false, None)
}

pub fn ensure_drawer_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(DRAWER_WINDOW_LABEL) {
        let needs_recreate = window
            .url()
            .map(|url| {
                let url_text = url.as_str().to_ascii_lowercase();
                url_text == "about:blank" || !url_text.contains("mode=drawer")
            })
            .unwrap_or(true);

        if !needs_recreate {
            return Ok(());
        }

        let _ = window.hide();
        window
            .destroy()
            .or_else(|_| window.close())
            .map_err(|err| err.to_string())?;
    }

    let bounds = drawer_window_bounds(app)?;
    let window =
        WebviewWindowBuilder::new(app, DRAWER_WINDOW_LABEL, webview_url_for_mode("drawer")?)
            .title("TidyDesk")
            .inner_size(bounds.width as f64, bounds.height as f64)
            .resizable(false)
            .visible(false)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .skip_taskbar(true)
            .always_on_top(false)
            .build()
            .map_err(|err| err.to_string())?;
    window
        .set_size(PhysicalSize::new(bounds.width, bounds.height))
        .map_err(|err| err.to_string())?;
    window
        .set_position(PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub fn recover_shell_windows(app: &AppHandle) -> Result<(), String> {
    let shell = app.state::<ShellState>();
    next_animation_generation(&shell);

    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.hide();
    }

    let mut snapshot = shell_snapshot(&shell)?;
    if snapshot.active_module.as_deref() == Some("todos")
        && app.get_webview_window("todos").is_none()
    {
        update_shell_state(app, &shell, false, None)?;
        snapshot = shell_snapshot(&shell)?;
    }

    if snapshot.active_module.as_deref() != Some("todos") {
        if let Some(window) = app.get_webview_window("todos") {
            let _ = window.hide();
        }
    }

    if snapshot.expanded {
        ensure_drawer_window(app)?;
        let drawer_bounds = drawer_window_bounds(app)?;
        apply_window_bounds(app, DRAWER_WINDOW_LABEL, drawer_bounds)?;
        if let Some(window) = app.get_webview_window(DRAWER_WINDOW_LABEL) {
            window.show().map_err(|err| err.to_string())?;
            if snapshot.active_module.as_deref() != Some("todos") {
                window.set_focus().map_err(|err| err.to_string())?;
            }
        }
        apply_window_bounds(app, HANDLE_WINDOW_LABEL, handle_window_bounds(app, true)?)?;
        if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
            window.show().map_err(|err| err.to_string())?;
        }
        set_handle_always_on_top(app, false)?;
    } else {
        if let Some(window) = app.get_webview_window(DRAWER_WINDOW_LABEL) {
            let _ = window.hide();
        }
        apply_window_bounds(app, HANDLE_WINDOW_LABEL, handle_window_bounds(app, false)?)?;
        if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
            window.show().map_err(|err| err.to_string())?;
            if snapshot.active_module.as_deref() != Some("todos") {
                window.set_focus().map_err(|err| err.to_string())?;
            }
        }
        set_handle_always_on_top(app, true)?;
    }

    if snapshot.active_module.as_deref() == Some("todos") {
        if let Some(window) = app.get_webview_window("todos") {
            window.show().map_err(|err| err.to_string())?;
            window.set_focus().map_err(|err| err.to_string())?;
        }
    }

    Ok(())
}

pub fn webview_url_for_mode(mode: &str) -> Result<WebviewUrl, String> {
    if cfg!(debug_assertions) {
        let url = Url::parse(&format!("http://127.0.0.1:3000/?mode={mode}"))
            .map_err(|err| err.to_string())?;
        Ok(WebviewUrl::External(url))
    } else {
        Ok(WebviewUrl::App(format!("index.html?mode={mode}").into()))
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

fn next_animation_generation(shell: &tauri::State<'_, ShellState>) -> u64 {
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

pub fn hide_module_windows(app: &AppHandle) -> Result<(), String> {
    for label in ["capture"] {
        if let Some(window) = app.get_webview_window(label) {
            window.hide().map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

pub fn apply_window_bounds(
    app: &AppHandle,
    label: &str,
    bounds: ShellBounds,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        window
            .set_position(PhysicalPosition::new(bounds.x, bounds.y))
            .map_err(|err| err.to_string())?;
        window
            .set_size(PhysicalSize::new(bounds.width, bounds.height))
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn interpolate_i32(start: i32, end: i32, progress: f64) -> i32 {
    (start as f64 + ((end - start) as f64 * progress)).round() as i32
}

fn interpolate_u32(start: u32, end: u32, progress: f64) -> u32 {
    (start as f64 + ((end as f64) - (start as f64)) * progress).round() as u32
}

fn interpolate_bounds(from: &ShellBounds, to: &ShellBounds, progress: f64) -> ShellBounds {
    ShellBounds {
        x: interpolate_i32(from.x, to.x, progress),
        y: interpolate_i32(from.y, to.y, progress),
        width: interpolate_u32(from.width, to.width, progress),
        height: interpolate_u32(from.height, to.height, progress),
    }
}

fn animate_window_bounds(
    app: AppHandle,
    label: &str,
    from: ShellBounds,
    to: ShellBounds,
    hide_after: bool,
    animation_generation: u64,
) {
    let label = label.to_string();
    std::thread::spawn(move || {
        for step in 0..=DRAWER_ANIMATION_STEPS {
            if app
                .state::<ShellState>()
                .animation_generation
                .load(Ordering::Relaxed)
                != animation_generation
            {
                break;
            }

            let progress = step as f64 / DRAWER_ANIMATION_STEPS as f64;
            let bounds = interpolate_bounds(&from, &to, progress);
            let app_handle = app.clone();
            let app_lookup = app_handle.clone();
            let window_label = label.clone();
            let _ = app_handle.run_on_main_thread(move || {
                if app_lookup
                    .state::<ShellState>()
                    .animation_generation
                    .load(Ordering::Relaxed)
                    != animation_generation
                {
                    return;
                }

                if let Some(window) = app_lookup.get_webview_window(&window_label) {
                    let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
                    let _ = window.set_size(PhysicalSize::new(bounds.width, bounds.height));
                    if hide_after && step == DRAWER_ANIMATION_STEPS {
                        let _ = window.hide();
                    }
                }
            });
            std::thread::sleep(Duration::from_millis(16));
        }
    });
}

pub fn monitor_bounds(app: &AppHandle) -> Result<ShellBounds, String> {
    for label in [HANDLE_WINDOW_LABEL, DRAWER_WINDOW_LABEL, "app-picker"] {
        if let Some(window) = app.get_webview_window(label) {
            if let Some(monitor) = window.current_monitor().map_err(|err| err.to_string())? {
                let position = monitor.position();
                let size = monitor.size();
                return Ok(ShellBounds {
                    x: position.x,
                    y: position.y,
                    width: size.width,
                    height: size.height,
                });
            }
        }
    }

    let monitor = app
        .primary_monitor()
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "No primary monitor found".to_string())?;
    let position = monitor.position();
    let size = monitor.size();
    Ok(ShellBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

pub fn content_width(app: &AppHandle) -> Result<u32, String> {
    let bounds = monitor_bounds(app)?;
    let target = ((bounds.width as f64) * 0.3).round() as u32;
    Ok(target.clamp(360, 560))
}

pub fn drawer_window_bounds(app: &AppHandle) -> Result<ShellBounds, String> {
    let screen = monitor_bounds(app)?;
    let width = content_width(app)?;
    Ok(ShellBounds {
        x: screen.x + screen.width as i32 - width as i32,
        y: screen.y,
        width,
        height: screen.height,
    })
}

pub fn drawer_hidden_bounds(app: &AppHandle, target: &ShellBounds) -> Result<ShellBounds, String> {
    let screen = monitor_bounds(app)?;
    Ok(ShellBounds {
        x: screen.x + screen.width as i32,
        y: target.y,
        width: target.width,
        height: target.height,
    })
}

pub fn handle_window_bounds(app: &AppHandle, expanded: bool) -> Result<ShellBounds, String> {
    let screen = monitor_bounds(app)?;
    let drawer_width = if expanded { content_width(app)? } else { 0 };
    let width = 80;
    let height = 300u32.min(screen.height);
    Ok(ShellBounds {
        x: screen.x + screen.width as i32 - drawer_width as i32 - width as i32,
        y: screen.y + ((screen.height - height) / 2) as i32,
        width,
        height,
    })
}

pub fn ensure_handle_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(HANDLE_WINDOW_LABEL).is_some() {
        return Ok(());
    }
    let bounds = handle_window_bounds(app, false)?;
    let window =
        WebviewWindowBuilder::new(app, HANDLE_WINDOW_LABEL, webview_url_for_mode("handle")?)
            .title("TidyDesk Handle")
            .inner_size(bounds.width as f64, bounds.height as f64)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .build()
            .map_err(|err| err.to_string())?;
    window
        .set_size(PhysicalSize::new(bounds.width, bounds.height))
        .map_err(|err| err.to_string())?;
    window
        .set_position(PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|err| err.to_string())?;
    Ok(())
}
