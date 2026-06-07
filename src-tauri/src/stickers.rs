use arboard::{Clipboard, ImageData};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use image::{DynamicImage, ImageFormat, RgbaImage};
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::borrow::Cow;
use std::ffi::c_void;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use url::Url;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS,
    HGDIOBJ, SRCCOPY,
};

const SNIP_WINDOW_LABEL: &str = "snip";
const STICKER_WINDOW_PREFIX: &str = "sticker-";
const STICKER_UPDATED_EVENT: &str = "sticker-updated";

#[derive(Debug, Clone)]
struct MonitorSnapshot {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StickerStateFile {
    stickers: Vec<StickerRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StickerRecord {
    id: String,
    image_path: String,
    bounds: StickerWindowBounds,
    always_on_top: bool,
    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StickerWindowBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnipRectPayload {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerDataPayload {
    id: String,
    image_data_url: String,
    always_on_top: bool,
    created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerPinResultPayload {
    success: bool,
    always_on_top: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StickerUpdatedPayload {
    id: String,
    always_on_top: bool,
}

#[derive(Debug)]
struct CapturedSticker {
    sticker_id: String,
}

pub fn ensure_storage(app: &AppHandle) -> Result<(), String> {
    fs::create_dir_all(images_root(app)?)
        .map_err(|err| format!("failed to create sticker image root: {err}"))?;
    let state_path = sticker_state_path(app)?;
    if !state_path.exists() {
        write_sticker_state(
            app,
            &StickerStateFile {
                stickers: Vec::new(),
            },
        )?;
    }
    Ok(())
}

pub fn restore_stickers(app: &AppHandle) -> Result<(), String> {
    ensure_storage(app)?;
    let mut state = read_sticker_state(app)?;
    let original_len = state.stickers.len();
    state
        .stickers
        .retain(|sticker| Path::new(&sticker.image_path).exists());
    if state.stickers.len() != original_len {
        write_sticker_state(app, &state)?;
    }

    for sticker in &state.stickers {
        ensure_sticker_window(app, sticker)?;
    }
    Ok(())
}

pub fn open_snip_window(app: &AppHandle) -> Result<(), String> {
    let monitor = active_monitor(app)?;
    if let Some(window) = app.get_webview_window(SNIP_WINDOW_LABEL) {
        prepare_snip_window(&window, &monitor)?;
        window.show().map_err(|err| err.to_string())?;
        window.set_focus().map_err(|err| err.to_string())?;
        return Ok(());
    }

    let window =
        WebviewWindowBuilder::new(app, SNIP_WINDOW_LABEL, crate::webview_url_for_mode("snip")?)
            .title("TidyDesk Snip")
            .inner_size(monitor.width as f64, monitor.height as f64)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .build()
            .map_err(|err| err.to_string())?;
    prepare_snip_window(&window, &monitor)?;
    window.show().map_err(|err| err.to_string())?;
    window.set_focus().map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn snip_complete_selection(
    app: AppHandle,
    payload: SnipRectPayload,
) -> Result<Value, String> {
    let app_handle = app.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || capture_selection(&app_handle, payload))
            .await
            .map_err(|err| err.to_string())??;
    Ok(json!({
        "success": true,
        "stickerId": result.sticker_id,
    }))
}

#[tauri::command]
pub fn snip_cancel(app: AppHandle) -> Result<Value, String> {
    close_snip_window(&app)?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub fn sticker_get(
    app: AppHandle,
    sticker_id: String,
) -> Result<Option<StickerDataPayload>, String> {
    ensure_storage(&app)?;
    let state = read_sticker_state(&app)?;
    let Some(sticker) = state.stickers.iter().find(|item| item.id == sticker_id) else {
        return Ok(None);
    };
    let image_path = PathBuf::from(&sticker.image_path);
    if !image_path.exists() {
        return Ok(None);
    }

    let bytes =
        fs::read(&image_path).map_err(|err| format!("failed to read sticker image: {err}"))?;
    Ok(Some(StickerDataPayload {
        id: sticker.id.clone(),
        image_data_url: format!("data:image/png;base64,{}", BASE64_STANDARD.encode(bytes)),
        always_on_top: sticker.always_on_top,
        created_at: sticker.created_at.clone(),
    }))
}

#[tauri::command]
pub fn sticker_toggle_pin(
    app: AppHandle,
    sticker_id: String,
) -> Result<StickerPinResultPayload, String> {
    ensure_storage(&app)?;
    let mut state = read_sticker_state(&app)?;
    let Some(sticker) = state.stickers.iter_mut().find(|item| item.id == sticker_id) else {
        return Ok(StickerPinResultPayload {
            success: false,
            always_on_top: None,
        });
    };

    sticker.always_on_top = !sticker.always_on_top;
    let always_on_top = sticker.always_on_top;
    write_sticker_state(&app, &state)?;

    if let Some(window) = app.get_webview_window(&sticker_window_label(&sticker_id)) {
        window
            .set_always_on_top(always_on_top)
            .map_err(|err| err.to_string())?;
    }

    app.emit(
        STICKER_UPDATED_EVENT,
        StickerUpdatedPayload {
            id: sticker_id,
            always_on_top,
        },
    )
    .map_err(|err| err.to_string())?;

    Ok(StickerPinResultPayload {
        success: true,
        always_on_top: Some(always_on_top),
    })
}

#[tauri::command]
pub fn sticker_copy(app: AppHandle, sticker_id: String) -> Result<Value, String> {
    ensure_storage(&app)?;
    let state = read_sticker_state(&app)?;
    let Some(sticker) = state.stickers.iter().find(|item| item.id == sticker_id) else {
        return Err("Sticker not found".to_string());
    };
    let rgba = image::open(&sticker.image_path)
        .map_err(|err| format!("failed to load sticker image: {err}"))?
        .to_rgba8();
    let (width, height) = rgba.dimensions();
    let bytes = rgba.into_raw();

    let mut clipboard =
        Clipboard::new().map_err(|err| format!("failed to access system clipboard: {err}"))?;
    clipboard
        .set_image(ImageData {
            width: width as usize,
            height: height as usize,
            bytes: Cow::Owned(bytes),
        })
        .map_err(|err| format!("failed to copy sticker image: {err}"))?;

    Ok(json!({ "success": true }))
}

#[tauri::command]
pub fn sticker_save_as(app: AppHandle, sticker_id: String) -> Result<Value, String> {
    ensure_storage(&app)?;
    let state = read_sticker_state(&app)?;
    let Some(sticker) = state.stickers.iter().find(|item| item.id == sticker_id) else {
        return Err("Sticker not found".to_string());
    };
    let source_path = PathBuf::from(&sticker.image_path);
    if !source_path.exists() {
        return Err("Sticker image does not exist".to_string());
    }

    let default_path = pictures_dir().join(format!("TidyDesk-{}.png", sticker.id));
    let Some(file_path) = FileDialog::new()
        .set_title("保存截图贴纸")
        .add_filter("PNG Image", &["png"])
        .set_file_name(
            default_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("TidyDesk-sticker.png"),
        )
        .save_file()
    else {
        return Ok(json!({ "success": false, "canceled": true }));
    };

    fs::copy(&source_path, &file_path)
        .map_err(|err| format!("failed to save sticker image: {err}"))?;
    Ok(json!({
        "success": true,
        "filePath": file_path.display().to_string(),
    }))
}

#[tauri::command]
pub fn sticker_close(app: AppHandle, sticker_id: String) -> Result<Value, String> {
    ensure_storage(&app)?;
    let mut state = read_sticker_state(&app)?;
    let removed = state
        .stickers
        .iter()
        .find(|item| item.id == sticker_id)
        .cloned();
    state.stickers.retain(|item| item.id != sticker_id);
    write_sticker_state(&app, &state)?;

    if let Some(window) = app.get_webview_window(&sticker_window_label(&sticker_id)) {
        window.close().map_err(|err| err.to_string())?;
    }

    if let Some(sticker) = removed {
        let image_path = PathBuf::from(sticker.image_path);
        if image_path.exists() {
            fs::remove_file(&image_path)
                .map_err(|err| format!("failed to delete sticker image: {err}"))?;
        }
    }

    Ok(json!({ "success": true }))
}

fn capture_selection(app: &AppHandle, payload: SnipRectPayload) -> Result<CapturedSticker, String> {
    ensure_storage(app)?;
    let monitor = active_monitor(app)?;
    let normalized = normalize_rect(payload)?;
    close_snip_window(app)?;
    std::thread::sleep(Duration::from_millis(140));

    let png = capture_monitor_region_png(&monitor, &normalized)?;
    let sticker_id = format!(
        "sticker-{}-{}",
        crate::timestamp_string(),
        std::process::id()
    );
    let image_path = images_root(app)?.join(format!("{sticker_id}.png"));
    fs::write(&image_path, &png).map_err(|err| format!("failed to write sticker image: {err}"))?;

    let sticker = StickerRecord {
        id: sticker_id.clone(),
        image_path: image_path.display().to_string(),
        bounds: initial_sticker_bounds(&monitor, &normalized),
        always_on_top: false,
        created_at: crate::timestamp_string(),
    };

    let mut state = read_sticker_state(app)?;
    upsert_sticker(&mut state, sticker.clone());
    write_sticker_state(app, &state)?;
    ensure_sticker_window(app, &sticker)?;

    Ok(CapturedSticker { sticker_id })
}

fn normalize_rect(payload: SnipRectPayload) -> Result<SnipRectPayload, String> {
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

fn initial_sticker_bounds(
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

fn ensure_sticker_window(app: &AppHandle, sticker: &StickerRecord) -> Result<(), String> {
    if !Path::new(&sticker.image_path).exists() {
        return Ok(());
    }

    let label = sticker_window_label(&sticker.id);
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|err| err.to_string())?;
        window
            .set_always_on_top(sticker.always_on_top)
            .map_err(|err| err.to_string())?;
        window
            .set_size(PhysicalSize::new(
                sticker.bounds.width,
                sticker.bounds.height,
            ))
            .map_err(|err| err.to_string())?;
        window
            .set_position(PhysicalPosition::new(sticker.bounds.x, sticker.bounds.y))
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(app, &label, sticker_webview_url(&sticker.id)?)
        .title("TidyDesk Sticker")
        .inner_size(sticker.bounds.width as f64, sticker.bounds.height as f64)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .always_on_top(sticker.always_on_top)
        .skip_taskbar(true)
        .build()
        .map_err(|err| err.to_string())?;
    window
        .set_size(PhysicalSize::new(
            sticker.bounds.width,
            sticker.bounds.height,
        ))
        .map_err(|err| err.to_string())?;
    window
        .set_position(PhysicalPosition::new(sticker.bounds.x, sticker.bounds.y))
        .map_err(|err| err.to_string())?;
    register_sticker_window_lifecycle(&window, app.clone(), sticker.id.clone());
    Ok(())
}

fn register_sticker_window_lifecycle(window: &WebviewWindow, app: AppHandle, sticker_id: String) {
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            let _ = persist_sticker_window_bounds(&app, &sticker_id);
        }
        _ => {}
    });
}

fn persist_sticker_window_bounds(app: &AppHandle, sticker_id: &str) -> Result<(), String> {
    let label = sticker_window_label(sticker_id);
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(());
    };
    let position = window.outer_position().map_err(|err| err.to_string())?;
    let size = window.outer_size().map_err(|err| err.to_string())?;

    let mut state = read_sticker_state(app)?;
    if let Some(sticker) = state.stickers.iter_mut().find(|item| item.id == sticker_id) {
        sticker.bounds = StickerWindowBounds {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        };
        write_sticker_state(app, &state)?;
    }
    Ok(())
}

fn prepare_snip_window(window: &WebviewWindow, monitor: &MonitorSnapshot) -> Result<(), String> {
    window
        .set_ignore_cursor_events(false)
        .map_err(|err| err.to_string())?;
    window
        .set_focusable(true)
        .map_err(|err| err.to_string())?;
    window
        .set_always_on_top(true)
        .map_err(|err| err.to_string())?;
    window
        .set_skip_taskbar(true)
        .map_err(|err| err.to_string())?;
    window
        .set_size(PhysicalSize::new(monitor.width, monitor.height))
        .map_err(|err| err.to_string())?;
    window
        .set_position(PhysicalPosition::new(monitor.x, monitor.y))
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn dispose_snip_window(window: &WebviewWindow) {
    let _ = window.set_ignore_cursor_events(true);
    let _ = window.set_focusable(false);
    let _ = window.set_always_on_top(false);
    let _ = window.hide();
    let _ = window.destroy().or_else(|_| window.close());
}

fn close_snip_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(SNIP_WINDOW_LABEL) {
        dispose_snip_window(&window);
    }
    Ok(())
}

fn sticker_window_label(sticker_id: &str) -> String {
    format!("{STICKER_WINDOW_PREFIX}{}", sanitize_sticker_id(sticker_id))
}

fn sanitize_sticker_id(value: &str) -> String {
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

fn sticker_webview_url(sticker_id: &str) -> Result<WebviewUrl, String> {
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

fn upsert_sticker(state: &mut StickerStateFile, sticker: StickerRecord) {
    if let Some(existing) = state.stickers.iter_mut().find(|item| item.id == sticker.id) {
        *existing = sticker;
    } else {
        state.stickers.push(sticker);
    }
}

fn read_sticker_state(app: &AppHandle) -> Result<StickerStateFile, String> {
    ensure_storage(app)?;
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

fn write_sticker_state(app: &AppHandle, state: &StickerStateFile) -> Result<(), String> {
    ensure_storage_dirs(app)?;
    let path = sticker_state_path(app)?;
    let content = serde_json::to_string_pretty(state)
        .map_err(|err| format!("failed to serialize sticker state: {err}"))?;
    fs::write(path, content).map_err(|err| format!("failed to write sticker state: {err}"))
}

fn ensure_storage_dirs(app: &AppHandle) -> Result<(), String> {
    fs::create_dir_all(sticker_root(app)?)
        .map_err(|err| format!("failed to create sticker root: {err}"))?;
    fs::create_dir_all(images_root(app)?)
        .map_err(|err| format!("failed to create sticker images root: {err}"))?;
    Ok(())
}

fn sticker_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("stickers"))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

fn images_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(sticker_root(app)?.join("images"))
}

fn sticker_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(sticker_root(app)?.join("stickers.json"))
}

fn pictures_dir() -> PathBuf {
    std::env::var("USERPROFILE")
        .map(|profile| Path::new(&profile).join("Pictures"))
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn active_monitor(app: &AppHandle) -> Result<MonitorSnapshot, String> {
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

#[cfg(windows)]
fn capture_monitor_region_png(
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

#[cfg(not(windows))]
fn capture_monitor_region_png(
    _monitor: &MonitorSnapshot,
    _rect: &SnipRectPayload,
) -> Result<Vec<u8>, String> {
    Err("Native screenshot capture is only implemented for Windows".to_string())
}
