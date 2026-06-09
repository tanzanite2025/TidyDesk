use image::{DynamicImage, ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, WebviewUrl};
use url::Url;

#[cfg(target_os = "windows")]
use std::ffi::c_void;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::POINT;
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    GetMonitorInfoW, MonitorFromPoint, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HGDIOBJ, MONITORINFO, MONITOR_DEFAULTTONEAREST, SRCCOPY,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

pub const SNIP_WINDOW_LABEL: &str = "snip";
pub const SNIP_RESET_EVENT: &str = "snip-reset";
pub const STICKER_WINDOW_PREFIX: &str = "sticker-";
pub const STICKER_UPDATED_EVENT: &str = "sticker-updated";

#[derive(Debug, Clone)]
pub struct MonitorSnapshot {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StickerStateFile {
    pub stickers: Vec<StickerRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StickerRecord {
    pub id: String,
    pub image_path: String,
    pub bounds: StickerWindowBounds,
    pub always_on_top: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StickerWindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnipRectPayload {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerDataPayload {
    pub id: String,
    pub image_data_url: String,
    pub always_on_top: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerPinResultPayload {
    pub success: bool,
    pub always_on_top: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerUpdatedPayload {
    pub id: String,
    pub always_on_top: bool,
}

#[derive(Debug)]
pub struct CapturedSticker {
    pub sticker_id: String,
}

pub fn ensure_storage(app: &AppHandle) -> Result<(), String> {
    with_sticker_store_lock(app, || ensure_storage_unlocked(app))
}

pub fn with_sticker_store_lock<T>(
    app: &AppHandle,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<crate::stickers::StickerStoreState>();
    let _guard = state
        .0
        .lock()
        .map_err(|_| "failed to lock sticker store".to_string())?;
    operation()
}

pub fn mutate_sticker_state<T>(
    app: &AppHandle,
    operation: impl FnOnce(&mut StickerStateFile) -> Result<T, String>,
) -> Result<T, String> {
    with_sticker_store_lock(app, || {
        ensure_storage_unlocked(app)?;
        let mut state = read_sticker_state_unlocked(app)?;
        let result = operation(&mut state)?;
        write_sticker_state_unlocked(app, &state)?;
        Ok(result)
    })
}

pub fn ensure_storage_unlocked(app: &AppHandle) -> Result<(), String> {
    fs::create_dir_all(images_root(app)?)
        .map_err(|err| format!("failed to create sticker image root: {err}"))?;
    let state_path = sticker_state_path(app)?;
    if !state_path.exists() {
        write_sticker_state_unlocked(
            app,
            &StickerStateFile {
                stickers: Vec::new(),
            },
        )?;
    }
    Ok(())
}

pub fn sanitize_sticker_id(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

pub fn sticker_window_label(sticker_id: &str) -> String {
    format!("{STICKER_WINDOW_PREFIX}{}", sanitize_sticker_id(sticker_id))
}

pub fn sticker_webview_url(sticker_id: &str) -> Result<WebviewUrl, String> {
    if cfg!(debug_assertions) {
        let mut url = Url::parse("http://127.0.0.1:3000/").map_err(|err| err.to_string())?;
        url.query_pairs_mut()
            .append_pair("mode", "sticker")
            .append_pair("id", sticker_id);
        Ok(WebviewUrl::External(url))
    } else {
        Ok(WebviewUrl::App(
            format!("index.html?mode=sticker&id={sticker_id}").into(),
        ))
    }
}

pub fn upsert_sticker(state: &mut StickerStateFile, sticker: StickerRecord) {
    if let Some(existing) = state.stickers.iter_mut().find(|item| item.id == sticker.id) {
        *existing = sticker;
    } else {
        state.stickers.push(sticker);
    }
}

pub fn read_sticker_state(app: &AppHandle) -> Result<StickerStateFile, String> {
    with_sticker_store_lock(app, || {
        ensure_storage_unlocked(app)?;
        read_sticker_state_unlocked(app)
    })
}

pub fn read_sticker_state_unlocked(app: &AppHandle) -> Result<StickerStateFile, String> {
    let path = sticker_state_path(app)?;
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content)
            .map_err(|err| format!("failed to parse sticker state: {err}")),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(StickerStateFile {
            stickers: Vec::new(),
        }),
        Err(err) => Err(format!("failed to read sticker state: {err}")),
    }
}

pub fn write_sticker_state_unlocked(app: &AppHandle, state: &StickerStateFile) -> Result<(), String> {
    ensure_storage_dirs(app)?;
    let path = sticker_state_path(app)?;
    let content = serde_json::to_string_pretty(state)
        .map_err(|err| format!("failed to serialize sticker state: {err}"))?;
    fs::write(path, content).map_err(|err| format!("failed to write sticker state: {err}"))
}

pub fn ensure_storage_dirs(app: &AppHandle) -> Result<(), String> {
    fs::create_dir_all(sticker_root(app)?)
        .map_err(|err| format!("failed to create sticker root: {err}"))?;
    fs::create_dir_all(images_root(app)?)
        .map_err(|err| format!("failed to create sticker images root: {err}"))?;
    Ok(())
}

pub fn sticker_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("stickers"))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

pub fn images_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(sticker_root(app)?.join("images"))
}

pub fn sticker_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(sticker_root(app)?.join("stickers.json"))
}

pub fn pictures_dir() -> PathBuf {
    std::env::var("USERPROFILE")
        .map(|profile| Path::new(&profile).join("Pictures"))
        .unwrap_or_else(|_| PathBuf::from("."))
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
    if let Some(monitor) = cursor_monitor_snapshot()? {
        return Ok(monitor);
    }

    active_monitor(app)
}

#[cfg(target_os = "windows")]
pub fn cursor_monitor_snapshot() -> Result<Option<MonitorSnapshot>, String> {
    unsafe {
        let mut point = POINT::default();
        GetCursorPos(&mut point).map_err(|err| format!("failed to read cursor position: {err}"))?;

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

pub fn normalize_rect(payload: SnipRectPayload) -> Result<SnipRectPayload, String> {
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
    Ok(SnipRectPayload {
        x: payload.x.round(),
        y: payload.y.round(),
        width: payload.width.round(),
        height: payload.height.round(),
    })
}

pub fn initial_sticker_bounds(
    monitor: &MonitorSnapshot,
    rect: &SnipRectPayload,
) -> StickerWindowBounds {
    let min_width = (160.0 * monitor.scale_factor).round() as u32;
    let min_height = (100.0 * monitor.scale_factor).round() as u32;
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

#[cfg(target_os = "windows")]
pub fn capture_monitor_region_png(
    monitor: &MonitorSnapshot,
    rect: &SnipRectPayload,
) -> Result<Vec<u8>, String> {
    let capture_x = monitor.x + ((rect.x * monitor.scale_factor).round() as i32);
    let capture_y = monitor.y + ((rect.y * monitor.scale_factor).round() as i32);
    let capture_width = ((rect.width * monitor.scale_factor).round() as i32).max(1);
    let capture_height = ((rect.height * monitor.scale_factor).round() as i32).max(1);

    unsafe {
        let screen_dc = GetDC(None);
        if screen_dc.0 == std::ptr::null_mut() {
            return Err("failed to get screen device context".to_string());
        }

        let memory_dc = CreateCompatibleDC(Some(screen_dc));
        if memory_dc.0 == std::ptr::null_mut() {
            let _ = ReleaseDC(None, screen_dc);
            return Err("failed to create memory device context".to_string());
        }

        let bitmap = CreateCompatibleBitmap(screen_dc, capture_width, capture_height);
        if bitmap.0 == std::ptr::null_mut() {
            let _ = DeleteDC(memory_dc);
            let _ = ReleaseDC(None, screen_dc);
            return Err("failed to create compatible bitmap".to_string());
        }

        let old_object = SelectObject(memory_dc, HGDIOBJ(bitmap.0));
        let copied = BitBlt(
            memory_dc,
            0,
            0,
            capture_width,
            capture_height,
            Some(screen_dc),
            capture_x,
            capture_y,
            SRCCOPY | CAPTUREBLT,
        );

        if copied.is_err() {
            let _ = SelectObject(memory_dc, old_object);
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            let _ = DeleteDC(memory_dc);
            let _ = ReleaseDC(None, screen_dc);
            return Err("failed to copy screen contents".to_string());
        }

        let mut bitmap_info = BITMAPINFO::default();
        bitmap_info.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: capture_width,
            biHeight: -capture_height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };

        let mut pixels = vec![0u8; (capture_width as usize) * (capture_height as usize) * 4];
        let rows = GetDIBits(
            memory_dc,
            bitmap,
            0,
            capture_height as u32,
            Some(pixels.as_mut_ptr().cast::<c_void>()),
            &mut bitmap_info,
            DIB_RGB_COLORS,
        );

        let _ = SelectObject(memory_dc, old_object);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory_dc);
        let _ = ReleaseDC(None, screen_dc);

        if rows == 0 {
            return Err("failed to read captured bitmap data".to_string());
        }

        for pixel in pixels.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }

        let image = RgbaImage::from_raw(capture_width as u32, capture_height as u32, pixels)
            .ok_or_else(|| "failed to build screenshot image".to_string())?;
        let mut cursor = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut cursor, ImageFormat::Png)
            .map_err(|err| format!("failed to encode screenshot png: {err}"))?;
        Ok(cursor.into_inner())
    }
}

#[cfg(not(target_os = "windows"))]
pub fn capture_monitor_region_png(
    _monitor: &MonitorSnapshot,
    _rect: &SnipRectPayload,
) -> Result<Vec<u8>, String> {
    Err("Native screenshot capture is only implemented for Windows".to_string())
}
