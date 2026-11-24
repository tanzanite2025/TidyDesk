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

fn active_monitor(app: &AppHandle) -> Result<tauri::Monitor, String> {
    for label in [
        HANDLE_WINDOW_LABEL,
        DRAWER_WINDOW_LABEL,
        crate::tool_windows::APP_PICKER_WINDOW_LABEL,
    ] {
        if let Some(window) = app.get_webview_window(label) {
            if let Some(monitor) = window.current_monitor().map_err(|err| err.to_string())? {
                return Ok(monitor);
            }
        }
    }

    app.primary_monitor()
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "No primary monitor found".to_string())
}

pub fn monitor_bounds(app: &AppHandle) -> Result<ShellBounds, String> {
    let monitor = active_monitor(app)?;
    let position = monitor.position();
    let size = monitor.size();
    Ok(ShellBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

pub fn compute_todo_bounds_for_work_area(
    work_x: i32,
    work_y: i32,
    work_width: u32,
    work_height: u32,
    scale_factor: f64,
) -> ShellBounds {
    let safe_scale = scale_factor.max(1.0);
    let max_w = work_width.saturating_sub(32).max(1);
    let max_h = work_height.saturating_sub(32).max(1);
    let min_w = ((900.0 * safe_scale).round() as u32).min(max_w);
    let min_h = ((640.0 * safe_scale).round() as u32).min(max_h);

    let width = ((work_width as f64) * 0.76)
        .round()
        .clamp(min_w as f64, max_w as f64) as u32;
    let height = ((work_height as f64) * 0.84)
        .round()
        .clamp(min_h as f64, max_h as f64) as u32;

    ShellBounds {
        x: work_x + ((work_width.saturating_sub(width)) / 2) as i32,
        y: work_y + ((work_height.saturating_sub(height)) / 2) as i32,
        width,
        height,
    }
}

pub fn todo_window_bounds(app: &AppHandle) -> Result<ShellBounds, String> {
    let monitor = active_monitor(app)?;
    let work_area = monitor.work_area();
    Ok(compute_todo_bounds_for_work_area(
        work_area.position.x,
        work_area.position.y,
        work_area.size.width,
        work_area.size.height,
        monitor.scale_factor(),
    ))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_todo_bounds_scales_proportionally_across_1080p_2k_4k() {
        let fhd = compute_todo_bounds_for_work_area(0, 0, 1920, 1040, 1.0);
        assert_eq!((fhd.width, fhd.height), (1459, 874));

        let qhd = compute_todo_bounds_for_work_area(0, 0, 2560, 1400, 1.25);
        assert_eq!((qhd.width, qhd.height), (1946, 1176));

        let uhd = compute_todo_bounds_for_work_area(0, 0, 3840, 2100, 1.5);
        assert_eq!((uhd.width, uhd.height), (2918, 1764));
    }
}
