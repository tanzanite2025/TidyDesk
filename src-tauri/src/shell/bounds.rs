use super::{DRAWER_WINDOW_LABEL, HANDLE_WINDOW_LABEL};
use tauri::{AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize};

const MINIMIZED_COORDINATE_THRESHOLD: i32 = -30_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShellBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy)]
pub struct WorkAreaMonitor {
    pub bounds: ShellBounds,
    pub scale_factor: f64,
}

pub fn scaled_px(logical: u32, scale_factor: f64) -> u32 {
    ((f64::from(logical) * scale_factor.max(1.0)).round() as u32).max(1)
}

pub fn is_valid_runtime_window_bounds(x: i32, y: i32, width: u32, height: u32) -> bool {
    x > MINIMIZED_COORDINATE_THRESHOLD
        && y > MINIMIZED_COORDINATE_THRESHOLD
        && width >= 120
        && height >= 120
}

fn monitor_to_work_area(monitor: &Monitor) -> WorkAreaMonitor {
    let area = monitor.work_area();
    WorkAreaMonitor {
        bounds: ShellBounds {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        },
        scale_factor: monitor.scale_factor().max(1.0),
    }
}

pub fn available_work_areas(app: &AppHandle) -> (Vec<WorkAreaMonitor>, Option<WorkAreaMonitor>) {
    let primary = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor_to_work_area(&monitor));

    let monitors = app
        .available_monitors()
        .map(|list| list.iter().map(monitor_to_work_area).collect::<Vec<_>>())
        .unwrap_or_default();

    (monitors, primary)
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

/// Clamp any existing floating window (e.g. `todos` or `capture` reused after hiding)
/// back onto an available monitor work area if an external screen was disconnected.
pub fn ensure_window_in_available_monitors(
    app: &AppHandle,
    label: &str,
    min_logical_width: u32,
    min_logical_height: u32,
    fallback_bounds: ShellBounds,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(label) else {
        return Ok(());
    };
    let Ok(pos) = window.outer_position() else {
        return Ok(());
    };
    let Ok(size) = window.outer_size() else {
        return Ok(());
    };
    let current = ShellBounds {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    };
    let (monitors, primary) = available_work_areas(app);
    let clamped = if is_valid_runtime_window_bounds(pos.x, pos.y, size.width, size.height) {
        clamp_physical_bounds_to_monitors(
            current,
            min_logical_width,
            min_logical_height,
            min_logical_width.max(320),
            min_logical_height.max(340),
            0,
            &monitors,
            primary,
        )
    } else {
        fallback_bounds
    };
    if clamped != current {
        apply_window_bounds(app, label, clamped)?;
    }
    Ok(())
}

fn active_monitor(app: &AppHandle) -> Result<Monitor, String> {
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

pub fn active_work_area(app: &AppHandle) -> Result<WorkAreaMonitor, String> {
    let monitor = active_monitor(app)?;
    Ok(monitor_to_work_area(&monitor))
}

pub fn default_cascade_bounds_for_monitor(
    monitor: WorkAreaMonitor,
    default_logical_w: u32,
    default_logical_h: u32,
    min_logical_w: u32,
    min_logical_h: u32,
    cascade_index: usize,
) -> ShellBounds {
    let min_w = scaled_px(min_logical_w, monitor.scale_factor);
    let min_h = scaled_px(min_logical_h, monitor.scale_factor);
    let target_w = scaled_px(default_logical_w, monitor.scale_factor);
    let target_h = scaled_px(default_logical_h, monitor.scale_factor);

    let max_w = monitor.bounds.width.saturating_sub(24).max(min_w);
    let max_h = monitor.bounds.height.saturating_sub(24).max(min_h);
    let safe_w = target_w.clamp(min_w.min(max_w), max_w);
    let safe_h = target_h.clamp(min_h.min(max_h), max_h);

    let step = scaled_px(((cascade_index % 6) * 28) as u32, monitor.scale_factor) as i32;
    let margin_right = scaled_px(96, monitor.scale_factor);
    let margin_top = scaled_px(72, monitor.scale_factor) as i32;

    let base_x = monitor.bounds.x
        + monitor
            .bounds
            .width
            .saturating_sub(safe_w.saturating_add(margin_right)) as i32
        - step;
    let base_y = monitor.bounds.y + margin_top + step;

    let max_x = monitor.bounds.x + monitor.bounds.width.saturating_sub(safe_w) as i32;
    let max_y = monitor.bounds.y + monitor.bounds.height.saturating_sub(safe_h) as i32;

    ShellBounds {
        x: base_x.clamp(monitor.bounds.x, max_x.max(monitor.bounds.x)),
        y: base_y.clamp(monitor.bounds.y, max_y.max(monitor.bounds.y)),
        width: safe_w,
        height: safe_h,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn clamp_physical_bounds_to_monitors(
    bounds: ShellBounds,
    min_logical_w: u32,
    min_logical_h: u32,
    fallback_logical_w: u32,
    fallback_logical_h: u32,
    cascade_index: usize,
    monitors: &[WorkAreaMonitor],
    primary: Option<WorkAreaMonitor>,
) -> ShellBounds {
    let fallback_monitor = primary.or_else(|| monitors.first().copied());
    let Some(default_mon) = fallback_monitor else {
        return ShellBounds {
            x: bounds.x.max(0),
            y: bounds.y.max(0),
            width: bounds.width.max(min_logical_w),
            height: bounds.height.max(min_logical_h),
        };
    };

    if bounds.x <= MINIMIZED_COORDINATE_THRESHOLD
        || bounds.y <= MINIMIZED_COORDINATE_THRESHOLD
        || bounds.width < 80
        || bounds.height < 80
    {
        return default_cascade_bounds_for_monitor(
            default_mon,
            fallback_logical_w,
            fallback_logical_h,
            min_logical_w,
            min_logical_h,
            cascade_index,
        );
    }

    let default_min_w = scaled_px(min_logical_w, default_mon.scale_factor);
    let max_default_w = default_mon
        .bounds
        .width
        .saturating_sub(24)
        .max(default_min_w);
    let initial_w = bounds
        .width
        .clamp(default_min_w.min(max_default_w), max_default_w);

    let title_visible_in = |mon: &WorkAreaMonitor| {
        let min_visible_w = initial_w.min(scaled_px(100, mon.scale_factor)) as i32;
        let min_visible_h = scaled_px(48, mon.scale_factor) as i32;
        let mon_right = mon.bounds.x + mon.bounds.width as i32;
        let mon_bottom = mon.bounds.y + mon.bounds.height as i32;
        bounds.x + initial_w as i32 >= mon.bounds.x + min_visible_w
            && bounds.x <= mon_right - min_visible_w
            && bounds.y >= mon.bounds.y
            && bounds.y <= mon_bottom - min_visible_h
    };

    let target_mon = monitors
        .iter()
        .find(|mon| title_visible_in(mon))
        .copied()
        .unwrap_or(default_mon);

    let min_w = scaled_px(min_logical_w, target_mon.scale_factor);
    let min_h = scaled_px(min_logical_h, target_mon.scale_factor);
    let max_w = target_mon.bounds.width.saturating_sub(16).max(min_w);
    let max_h = target_mon.bounds.height.saturating_sub(16).max(min_h);
    let width = bounds.width.clamp(min_w.min(max_w), max_w);
    let height = bounds.height.clamp(min_h.min(max_h), max_h);

    let min_x = target_mon.bounds.x;
    let max_x = target_mon.bounds.x + target_mon.bounds.width.saturating_sub(width) as i32;
    let min_y = target_mon.bounds.y;
    let max_y = target_mon.bounds.y + target_mon.bounds.height.saturating_sub(height) as i32;

    ShellBounds {
        x: bounds.x.clamp(min_x, max_x.max(min_x)),
        y: bounds.y.clamp(min_y, max_y.max(min_y)),
        width,
        height,
    }
}

struct CenteredBoundsSpec {
    width_ratio: f64,
    height_ratio: f64,
    min_logical_width: f64,
    min_logical_height: f64,
}

fn compute_centered_bounds_for_work_area(
    work_area: ShellBounds,
    scale_factor: f64,
    spec: CenteredBoundsSpec,
) -> ShellBounds {
    let safe_scale = scale_factor.max(1.0);
    let max_w = work_area.width.saturating_sub(32).max(1);
    let max_h = work_area.height.saturating_sub(32).max(1);
    let min_w = ((spec.min_logical_width * safe_scale).round() as u32).min(max_w);
    let min_h = ((spec.min_logical_height * safe_scale).round() as u32).min(max_h);

    let width = ((work_area.width as f64) * spec.width_ratio)
        .round()
        .clamp(min_w as f64, max_w as f64) as u32;
    let height = ((work_area.height as f64) * spec.height_ratio)
        .round()
        .clamp(min_h as f64, max_h as f64) as u32;

    ShellBounds {
        x: work_area.x + ((work_area.width.saturating_sub(width)) / 2) as i32,
        y: work_area.y + ((work_area.height.saturating_sub(height)) / 2) as i32,
        width,
        height,
    }
}

pub fn compute_todo_bounds_for_work_area(
    work_x: i32,
    work_y: i32,
    work_width: u32,
    work_height: u32,
    scale_factor: f64,
) -> ShellBounds {
    compute_centered_bounds_for_work_area(
        ShellBounds {
            x: work_x,
            y: work_y,
            width: work_width,
            height: work_height,
        },
        scale_factor,
        CenteredBoundsSpec {
            width_ratio: 0.76,
            height_ratio: 0.84,
            min_logical_width: 900.0,
            min_logical_height: 640.0,
        },
    )
}

pub fn todo_window_bounds(app: &AppHandle) -> Result<ShellBounds, String> {
    let work = active_work_area(app)?;
    Ok(compute_todo_bounds_for_work_area(
        work.bounds.x,
        work.bounds.y,
        work.bounds.width,
        work.bounds.height,
        work.scale_factor,
    ))
}

pub fn capture_window_bounds(app: &AppHandle) -> Result<ShellBounds, String> {
    let work = active_work_area(app)?;
    Ok(compute_centered_bounds_for_work_area(
        work.bounds,
        work.scale_factor,
        CenteredBoundsSpec {
            width_ratio: 0.52,
            height_ratio: 0.78,
            min_logical_width: 720.0,
            min_logical_height: 620.0,
        },
    ))
}

const HANDLE_LOGICAL_WIDTH: u32 = 56;
const HANDLE_LOGICAL_HEIGHT: u32 = 228;
const HANDLE_RESERVE_WIDTH: u32 = 64;

pub fn compute_drawer_width_for_work_area(work_area: WorkAreaMonitor) -> u32 {
    let handle_reserve = scaled_px(HANDLE_RESERVE_WIDTH, work_area.scale_factor);
    let max_available = work_area.bounds.width.saturating_sub(handle_reserve).max(1);
    let min_w = scaled_px(360, work_area.scale_factor).min(max_available);
    let max_w = scaled_px(560, work_area.scale_factor).clamp(min_w, max_available);
    let target = ((work_area.bounds.width as f64) * 0.30).round() as u32;
    target.clamp(min_w, max_w)
}

pub fn compute_drawer_bounds_for_work_area(work_area: WorkAreaMonitor) -> ShellBounds {
    let width = compute_drawer_width_for_work_area(work_area);
    ShellBounds {
        x: work_area.bounds.x + work_area.bounds.width as i32 - width as i32,
        y: work_area.bounds.y,
        width,
        height: work_area.bounds.height,
    }
}

pub fn compute_handle_bounds_for_work_area(
    work_area: WorkAreaMonitor,
    expanded: bool,
) -> ShellBounds {
    let drawer_width = if expanded {
        compute_drawer_width_for_work_area(work_area)
    } else {
        0
    };
    let width =
        scaled_px(HANDLE_LOGICAL_WIDTH, work_area.scale_factor).min(work_area.bounds.width.max(1));
    let height = scaled_px(HANDLE_LOGICAL_HEIGHT, work_area.scale_factor)
        .min(work_area.bounds.height.max(1));
    ShellBounds {
        x: work_area.bounds.x + work_area.bounds.width as i32 - drawer_width as i32 - width as i32,
        y: work_area.bounds.y + ((work_area.bounds.height.saturating_sub(height)) / 2) as i32,
        width,
        height,
    }
}

pub fn drawer_window_bounds(app: &AppHandle) -> Result<ShellBounds, String> {
    Ok(compute_drawer_bounds_for_work_area(active_work_area(app)?))
}

pub fn handle_window_bounds(app: &AppHandle, expanded: bool) -> Result<ShellBounds, String> {
    Ok(compute_handle_bounds_for_work_area(
        active_work_area(app)?,
        expanded,
    ))
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

    #[test]
    fn drawer_and_handle_respect_work_area_and_scale_factor() {
        let fhd = WorkAreaMonitor {
            bounds: ShellBounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1032,
            },
            scale_factor: 1.0,
        };
        let d_fhd = compute_drawer_bounds_for_work_area(fhd);
        assert_eq!(d_fhd.height, 1032);
        assert_eq!(d_fhd.width, 560);
        let h_fhd = compute_handle_bounds_for_work_area(fhd, true);
        assert_eq!((h_fhd.width, h_fhd.height), (56, 228));
        assert_eq!(h_fhd.x + h_fhd.width as i32, d_fhd.x);

        let uhd_200 = WorkAreaMonitor {
            bounds: ShellBounds {
                x: 0,
                y: 0,
                width: 3840,
                height: 2064,
            },
            scale_factor: 2.0,
        };
        let d_uhd = compute_drawer_bounds_for_work_area(uhd_200);
        assert_eq!(d_uhd.height, 2064);
        assert_eq!(d_uhd.width, 1120);
        let h_uhd = compute_handle_bounds_for_work_area(uhd_200, false);
        assert_eq!((h_uhd.width, h_uhd.height), (112, 456));
    }
}
