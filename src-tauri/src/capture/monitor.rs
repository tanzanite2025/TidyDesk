use super::SNIP_WINDOW_LABEL;
use crate::stickers::StickerWindowBounds;
use serde::Deserialize;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::POINT;
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

#[derive(Debug, Clone)]
pub struct MonitorSnapshot {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnipRectPayload {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn active_monitor(app: &AppHandle) -> Result<MonitorSnapshot, String> {
    for label in [SNIP_WINDOW_LABEL, "handle", "main"] {
        if let Some(window) = app.get_webview_window(label) {
            if let Some(monitor) = window.current_monitor().map_err(|err| err.to_string())? {
                let position = monitor.position();
                let size = monitor.size();
                return Ok(MonitorSnapshot {
                    x: position.x,
                    y: position.y,
                    width: size.width,
                    height: size.height,
                    scale_factor: monitor.scale_factor(),
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
    Ok(MonitorSnapshot {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        scale_factor: monitor.scale_factor(),
    })
}

pub fn snip_open_monitor(app: &AppHandle) -> Result<MonitorSnapshot, String> {
    #[cfg(target_os = "windows")]
    if let Some(monitor) = cursor_monitor_snapshot(app)? {
        return Ok(monitor);
    }

    active_monitor(app)
}

#[cfg(target_os = "windows")]
fn cursor_monitor_snapshot(app: &AppHandle) -> Result<Option<MonitorSnapshot>, String> {
    unsafe {
        let mut point = POINT::default();
        GetCursorPos(&mut point).map_err(|err| format!("failed to read cursor position: {err}"))?;

        let monitors = app.available_monitors().map_err(|err| err.to_string())?;
        if let Some(monitor) = monitors.into_iter().find(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            point.x >= position.x
                && point.y >= position.y
                && point.x < position.x + size.width as i32
                && point.y < position.y + size.height as i32
        }) {
            let position = monitor.position();
            let size = monitor.size();
            return Ok(Some(MonitorSnapshot {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
                scale_factor: monitor.scale_factor(),
            }));
        }

        let monitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
        if monitor.0.is_null() {
            return Ok(None);
        }

        let mut monitor_info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut monitor_info as *mut MONITORINFO).as_bool() {
            return Err("failed to read cursor monitor info".to_string());
        }

        let width = (monitor_info.rcMonitor.right - monitor_info.rcMonitor.left).max(0) as u32;
        let height = (monitor_info.rcMonitor.bottom - monitor_info.rcMonitor.top).max(0) as u32;
        if width == 0 || height == 0 {
            return Ok(None);
        }

        Ok(Some(MonitorSnapshot {
            x: monitor_info.rcMonitor.left,
            y: monitor_info.rcMonitor.top,
            width,
            height,
            scale_factor: 1.0,
        }))
    }
}

pub fn normalize_rect(
    payload: SnipRectPayload,
    monitor: &MonitorSnapshot,
) -> Result<SnipRectPayload, String> {
    if !payload.x.is_finite()
        || !payload.y.is_finite()
        || !payload.width.is_finite()
        || !payload.height.is_finite()
    {
        return Err("Invalid snip rectangle".to_string());
    }
    if payload.width < 8.0 || payload.height < 8.0 {
        return Err("Snip rectangle is too small".to_string());
    }
    let max_width = monitor.width as f64 / monitor.scale_factor;
    let max_height = monitor.height as f64 / monitor.scale_factor;
    let width = payload.width.round().min(max_width).max(1.0);
    let height = payload.height.round().min(max_height).max(1.0);
    let x = payload.x.round().clamp(0.0, (max_width - width).max(0.0));
    let y = payload.y.round().clamp(0.0, (max_height - height).max(0.0));

    Ok(SnipRectPayload {
        x,
        y,
        width,
        height,
    })
}

pub fn initial_sticker_bounds(
    monitor: &MonitorSnapshot,
    rect: &SnipRectPayload,
) -> StickerWindowBounds {
    let min_width = (48.0 * monitor.scale_factor).round() as u32;
    let min_height = (32.0 * monitor.scale_factor).round() as u32;
    let max_width = ((monitor.width as f64) * 0.45).round() as u32;
    let max_height = ((monitor.height as f64) * 0.45).round() as u32;
    let rect_width = (rect.width * monitor.scale_factor).round() as u32;
    let rect_height = (rect.height * monitor.scale_factor).round() as u32;
    let ratio = f64::min(
        max_width as f64 / rect_width.max(1) as f64,
        max_height as f64 / rect_height.max(1) as f64,
    )
    .min(1.0);
    let width = ((rect_width as f64) * ratio).round() as u32;
    let height = ((rect_height as f64) * ratio).round() as u32;
    let width = width.max(min_width).min(monitor.width.saturating_sub(48));
    let height = height
        .max(min_height)
        .min(monitor.height.saturating_sub(48));
    let preferred_x = monitor.x + ((rect.x * monitor.scale_factor).round() as i32) + 24;
    let preferred_y = monitor.y + ((rect.y * monitor.scale_factor).round() as i32) + 24;
    let max_x = monitor.x + monitor.width as i32 - width as i32 - 24;
    let max_y = monitor.y + monitor.height as i32 - height as i32 - 24;

    StickerWindowBounds {
        x: preferred_x.clamp(monitor.x + 24, max_x.max(monitor.x + 24)),
        y: preferred_y.clamp(monitor.y + 24, max_y.max(monitor.y + 24)),
        width,
        height,
    }
}
