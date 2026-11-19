use super::{DRAWER_WINDOW_LABEL, HANDLE_WINDOW_LABEL};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

#[derive(Debug, Clone)]
pub struct ShellBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn apply_window_bounds(
    app: &AppHandle,
    label: &str,
    bounds: ShellBounds,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        let needs_move = window
            .outer_position()
            .map(|pos| pos.x != bounds.x || pos.y != bounds.y)
            .unwrap_or(true);
        if needs_move {
            window
                .set_position(PhysicalPosition::new(bounds.x, bounds.y))
                .map_err(|err| err.to_string())?;
        }
        let needs_resize = window
            .outer_size()
            .map(|size| size.width != bounds.width || size.height != bounds.height)
            .unwrap_or(true);
        if needs_resize {
            window
                .set_size(PhysicalSize::new(bounds.width, bounds.height))
                .map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

pub fn monitor_bounds(app: &AppHandle) -> Result<ShellBounds, String> {
    for label in [
        HANDLE_WINDOW_LABEL,
        DRAWER_WINDOW_LABEL,
        crate::tool_windows::APP_PICKER_WINDOW_LABEL,
    ] {
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
