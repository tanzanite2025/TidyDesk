use arboard::{Clipboard, ImageData};
use rfd::FileDialog;
use serde_json::{json, Value};
use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_notification::NotificationExt;

pub use crate::stickers_rules::{
    ensure_storage, mutate_sticker_state, read_sticker_state, upsert_sticker, CapturedSticker,
    SnipRectPayload, StickerDataPayload, StickerPinResultPayload, StickerRecord,
    StickerUpdatedPayload, StickerWindowBounds,
};

#[derive(Debug, Default)]
pub struct StickerStoreState(pub Mutex<()>);

#[derive(Debug, Clone)]
pub struct PendingSticker {
    image_path: PathBuf,
    bounds: StickerWindowBounds,
}

#[derive(Default)]
pub struct SnipCaptureState {
    pub capture_in_flight: AtomicBool,
    pub frozen_image_path: Mutex<Option<PathBuf>>,
    pub frozen_image_error: Mutex<Option<String>>,
    pub pending_sticker: Mutex<Option<PendingSticker>>,
}

fn frozen_background_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|err| format!("failed to resolve snip cache dir: {err}"))?
        .join("snip");
    fs::create_dir_all(&dir).map_err(|err| format!("failed to create snip cache dir: {err}"))?;
    Ok(dir.join("background.png"))
}

fn pending_sticker_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|err| format!("failed to resolve pending sticker cache dir: {err}"))?
        .join("snip");
    fs::create_dir_all(&dir)
        .map_err(|err| format!("failed to create pending sticker cache dir: {err}"))?;
    Ok(dir.join("pending-sticker.png"))
}

pub(crate) fn clear_pending_sticker_cache(app: &AppHandle) {
    if let Ok(path) = pending_sticker_path(app) {
        let _ = fs::remove_file(path);
    }
    let previous = {
        let state = app.state::<SnipCaptureState>();
        state
            .pending_sticker
            .lock()
            .ok()
            .and_then(|mut pending| pending.take())
    };
    if let Some(previous) = previous {
        let _ = fs::remove_file(previous.image_path);
    }
}

pub(crate) fn notify_sticker_message(app: &AppHandle, title: &str, body: &str) {
    if let Err(err) = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .auto_cancel()
        .show()
    {
        eprintln!("[TIDYDESK] Failed to show sticker notification: {err}");
    }
}

pub fn restore_stickers(app: &AppHandle) -> Result<(), String> {
    let stickers = mutate_sticker_state(app, |state| {
        state
            .stickers
            .retain(|sticker| Path::new(&sticker.image_path).exists());
        Ok(state.stickers.clone())
    })?;

    for sticker in &stickers {
        crate::tool_windows::ensure_sticker_window(app, sticker)?;
    }
    Ok(())
}

pub fn open_snip_window(app: &AppHandle) -> Result<(), String> {
    if is_snip_capture_in_flight(app) {
        return Ok(());
    }

    // 在打开窗口之前，先静默截取全屏
    let monitor = crate::stickers_rules::snip_open_monitor(app)?;
    let rect = SnipRectPayload {
        x: 0.0,
        y: 0.0,
        width: monitor.width as f64 / monitor.scale_factor,
        height: monitor.height as f64 / monitor.scale_factor,
    };
    let state = app.state::<SnipCaptureState>();
    match crate::stickers_rules::capture_monitor_region_png(&monitor, &rect) {
        Ok(png) => {
            let image_path = frozen_background_path(app)?;
            fs::write(&image_path, png)
                .map_err(|err| format!("failed to write snip background: {err}"))?;
            let mut frozen = state
                .frozen_image_path
                .lock()
                .map_err(|_| "failed to lock snip background image".to_string())?;
            let mut error = state
                .frozen_image_error
                .lock()
                .map_err(|_| "failed to lock snip background error".to_string())?;
            *frozen = Some(image_path);
            *error = None;
        }
        Err(err) => {
            let mut frozen = state
                .frozen_image_path
                .lock()
                .map_err(|_| "failed to lock snip background image".to_string())?;
            let mut error = state
                .frozen_image_error
                .lock()
                .map_err(|_| "failed to lock snip background error".to_string())?;
            *frozen = None;
            *error = Some(err);
        }
    }

    crate::tool_windows::open_snip_window(app)
}

fn require_snip_window(window: &WebviewWindow, command: &str) -> Result<(), String> {
    let label = window.label();
    if label == "snip" {
        Ok(())
    } else {
        Err(format!("{command} is not available from window `{label}`"))
    }
}

#[tauri::command]
pub fn snip_get_background_image(window: WebviewWindow, app: AppHandle) -> Result<Value, String> {
    require_snip_window(&window, "snip_get_background_image")?;
    let state = app.state::<SnipCaptureState>();
    let frozen = state
        .frozen_image_path
        .lock()
        .map_err(|_| "failed to lock snip background image".to_string())?;
    if let Some(image_path) = frozen.as_ref() {
        Ok(json!({
            "success": true,
            "imagePath": image_path.display().to_string()
        }))
    } else {
        let error = state
            .frozen_image_error
            .lock()
            .map_err(|_| "failed to lock snip background error".to_string())?;
        Ok(json!({
            "success": false,
            "imagePath": Value::Null,
            "error": error.as_deref().unwrap_or("No screenshot background is available")
        }))
    }
}

#[tauri::command]
pub async fn snip_complete_selection(
    window: WebviewWindow,
    app: AppHandle,
    payload: SnipRectPayload,
) -> Result<Value, String> {
    require_snip_window(&window, "snip_complete_selection")?;
    begin_snip_capture(&app)?;
    let app_handle = app.clone();
    let capture_result =
        tauri::async_runtime::spawn_blocking(move || capture_selection(&app_handle, payload)).await;
    finish_snip_capture(&app);
    let result = capture_result
        .map_err(|err| err.to_string())
        .and_then(|result| result);
    if let Err(cleanup_err) = cleanup_after_snip_selection(&app) {
        if result.is_ok() {
            return Err(cleanup_err);
        }
        eprintln!("[TIDYDESK] Failed to clean up snip selection: {cleanup_err}");
    }
    let result = result?;
    Ok(json!({
        "success": true,
        "stickerId": result.sticker_id,
        "pasted": result.pasted,
    }))
}

#[tauri::command]
pub fn snip_cancel(app: AppHandle) -> Result<Value, String> {
    crate::tool_windows::close_snip_window(&app)?;
    clear_frozen_background(&app)?;
    finish_snip_capture(&app);
    crate::shell::recover_shell_windows(&app)?;
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

    Ok(Some(StickerDataPayload {
        id: sticker.id.clone(),
        image_path: image_path.display().to_string(),
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
    let Some(always_on_top) = mutate_sticker_state(&app, |state| {
        let Some(sticker) = state.stickers.iter_mut().find(|item| item.id == sticker_id) else {
            return Ok(None);
        };
        sticker.always_on_top = !sticker.always_on_top;
        Ok(Some(sticker.always_on_top))
    })?
    else {
        return Ok(StickerPinResultPayload {
            success: false,
            always_on_top: None,
        });
    };

    if let Some(window) =
        app.get_webview_window(&crate::stickers_rules::sticker_window_label(&sticker_id))
    {
        window
            .set_always_on_top(always_on_top)
            .map_err(|err| err.to_string())?;
    }

    app.emit(
        crate::stickers_rules::STICKER_UPDATED_EVENT,
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

    let default_path =
        crate::stickers_rules::pictures_dir().join(format!("TidyDesk-{}.png", sticker.id));
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
    let state = read_sticker_state(&app)?;
    let sticker = state
        .stickers
        .iter()
        .find(|item| item.id == sticker_id)
        .cloned();

    let Some(sticker) = sticker else {
        close_sticker_window_if_present(&app, &sticker_id)?;
        return Ok(json!({ "success": true }));
    };

    close_sticker_window_if_present(&app, &sticker_id)?;

    let image_path = PathBuf::from(&sticker.image_path);
    let staged_delete_path = if image_path.exists() {
        let delete_path = staged_sticker_delete_path(&image_path, &sticker_id);
        fs::rename(&image_path, &delete_path)
            .map_err(|err| format!("failed to stage sticker image deletion: {err}"))?;
        Some(delete_path)
    } else {
        None
    };

    if let Err(err) = mutate_sticker_state(&app, |state| {
        state.stickers.retain(|item| item.id != sticker_id);
        Ok(())
    }) {
        if let Some(delete_path) = &staged_delete_path {
            let _ = fs::rename(delete_path, &image_path);
        }
        let _ = crate::tool_windows::ensure_sticker_window(&app, &sticker);
        return Err(err);
    }

    if let Some(delete_path) = staged_delete_path {
        if let Err(err) = fs::remove_file(&delete_path) {
            eprintln!(
                "[TIDYDESK] Failed to remove staged sticker image {}: {err}",
                delete_path.display()
            );
        }
    }

    Ok(json!({ "success": true }))
}

fn close_sticker_window_if_present(app: &AppHandle, sticker_id: &str) -> Result<(), String> {
    if let Some(window) =
        app.get_webview_window(&crate::stickers_rules::sticker_window_label(sticker_id))
    {
        window.close().map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn staged_sticker_delete_path(image_path: &Path, sticker_id: &str) -> PathBuf {
    let file_name = image_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("sticker.png");
    image_path.with_file_name(format!(
        "{file_name}.{}.{}.deleting",
        crate::stickers_rules::sanitize_sticker_id(sticker_id),
        crate::timestamp_string()
    ))
}

pub fn paste_pending_sticker(app: &AppHandle) -> Result<Option<String>, String> {
    let pending = {
        let state = app.state::<SnipCaptureState>();
        let mut pending = state
            .pending_sticker
            .lock()
            .map_err(|_| "failed to lock pending sticker".to_string())?;
        pending.take()
    };
    let Some(pending) = pending else {
        notify_sticker_message(
            app,
            "没有待贴截图",
            "先框选截图，再按设置中的贴图快捷键贴到桌面。",
        );
        return Ok(None);
    };

    let result = (|| {
        let png = fs::read(&pending.image_path)
            .map_err(|err| format!("failed to read pending sticker image: {err}"))?;
        create_sticker_from_png(app, &png, pending.bounds.clone())
    })();

    match result {
        Ok(sticker_id) => {
            remove_pending_file_if_current_slot_empty(app, &pending.image_path)?;
            notify_sticker_message(app, "截图已贴到桌面", "最近一次截图已经生成桌面贴纸。");
            Ok(Some(sticker_id))
        }
        Err(err) => {
            restore_pending_sticker(app, pending)?;
            Err(err)
        }
    }
}

fn create_sticker_from_png(
    app: &AppHandle,
    png: &[u8],
    bounds: StickerWindowBounds,
) -> Result<String, String> {
    let sticker_id = format!(
        "sticker-{}-{}",
        crate::timestamp_string(),
        std::process::id()
    );
    let image_path = crate::stickers_rules::images_root(app)?.join(format!("{sticker_id}.png"));
    fs::write(&image_path, png).map_err(|err| format!("failed to write sticker image: {err}"))?;

    let sticker = StickerRecord {
        id: sticker_id.clone(),
        image_path: image_path.display().to_string(),
        bounds,
        always_on_top: false,
        created_at: crate::timestamp_string(),
    };

    mutate_sticker_state(app, |state| {
        upsert_sticker(state, sticker.clone());
        Ok(())
    })?;
    if let Err(err) = crate::tool_windows::ensure_sticker_window(app, &sticker) {
        let _ = mutate_sticker_state(app, |state| {
            state.stickers.retain(|item| item.id != sticker_id);
            Ok(())
        });
        let _ = fs::remove_file(&image_path);
        return Err(err);
    }
    Ok(sticker_id)
}

fn restore_pending_sticker(app: &AppHandle, pending_sticker: PendingSticker) -> Result<(), String> {
    let state = app.state::<SnipCaptureState>();
    let mut pending = state
        .pending_sticker
        .lock()
        .map_err(|_| "failed to lock pending sticker".to_string())?;
    if pending.is_none() {
        *pending = Some(pending_sticker);
    }
    Ok(())
}

fn remove_pending_file_if_current_slot_empty(
    app: &AppHandle,
    image_path: &Path,
) -> Result<(), String> {
    let state = app.state::<SnipCaptureState>();
    let pending = state
        .pending_sticker
        .lock()
        .map_err(|_| "failed to lock pending sticker".to_string())?;
    if pending.is_none() {
        let _ = fs::remove_file(image_path);
    }
    Ok(())
}

fn save_pending_sticker(
    app: &AppHandle,
    png: &[u8],
    bounds: StickerWindowBounds,
) -> Result<(), String> {
    let image_path = pending_sticker_path(app)?;
    fs::write(&image_path, png).map_err(|err| format!("failed to write pending sticker: {err}"))?;
    let state = app.state::<SnipCaptureState>();
    let mut pending = state
        .pending_sticker
        .lock()
        .map_err(|_| "failed to lock pending sticker".to_string())?;
    let stored_path = image_path.clone();
    if let Some(previous) = pending.replace(PendingSticker {
        image_path: stored_path,
        bounds,
    }) {
        if previous.image_path != image_path {
            let _ = fs::remove_file(previous.image_path);
        }
    }
    Ok(())
}

fn capture_selection(app: &AppHandle, payload: SnipRectPayload) -> Result<CapturedSticker, String> {
    ensure_storage(app)?;
    let monitor = crate::stickers_rules::active_monitor(app)?;
    let normalized = crate::stickers_rules::normalize_rect(payload, &monitor)?;

    let state = app.state::<SnipCaptureState>();
    let png = {
        let mut frozen = state
            .frozen_image_path
            .lock()
            .map_err(|_| "failed to lock snip background image".to_string())?;
        if let Some(image_path) = frozen.take() {
            let png_bytes = fs::read(&image_path)
                .map_err(|err| format!("failed to read frozen image: {err}"))?;
            let _ = fs::remove_file(&image_path);
            let img = image::load_from_memory(&png_bytes)
                .map_err(|err| format!("failed to load frozen image: {err}"))?;

            let image_width = img.width();
            let image_height = img.height();
            let crop_x = ((normalized.x * monitor.scale_factor).round() as u32)
                .min(image_width.saturating_sub(1));
            let crop_y = ((normalized.y * monitor.scale_factor).round() as u32)
                .min(image_height.saturating_sub(1));
            let crop_width = ((normalized.width * monitor.scale_factor).round() as u32)
                .max(1)
                .min(image_width.saturating_sub(crop_x));
            let crop_height = ((normalized.height * monitor.scale_factor).round() as u32)
                .max(1)
                .min(image_height.saturating_sub(crop_y));

            let cropped = img.crop_imm(crop_x, crop_y, crop_width, crop_height);
            let mut cursor = std::io::Cursor::new(Vec::new());
            cropped
                .write_to(&mut cursor, image::ImageFormat::Png)
                .map_err(|err| format!("failed to encode cropped png: {err}"))?;
            cursor.into_inner()
        } else {
            crate::tool_windows::close_snip_window(app)?;
            std::thread::sleep(Duration::from_millis(140));
            crate::stickers_rules::capture_monitor_region_png(&monitor, &normalized)?
        }
    };

    crate::tool_windows::close_snip_window(app)?;
    clear_frozen_background(app)?;

    let bounds = crate::stickers_rules::initial_sticker_bounds(&monitor, &normalized);
    if crate::resident::read_resident_settings(app).auto_stick_after_snip {
        let sticker_id = create_sticker_from_png(app, &png, bounds)?;
        Ok(CapturedSticker {
            sticker_id: Some(sticker_id),
            pasted: true,
        })
    } else {
        save_pending_sticker(app, &png, bounds)?;
        notify_sticker_message(
            app,
            "截图已保存为待贴",
            "按 Ctrl+Alt+V 时才会把这张截图贴到桌面。",
        );
        Ok(CapturedSticker {
            sticker_id: None,
            pasted: false,
        })
    }
}

fn clear_frozen_background(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<SnipCaptureState>();
    let mut frozen = state
        .frozen_image_path
        .lock()
        .map_err(|_| "failed to lock snip background image".to_string())?;
    let mut error = state
        .frozen_image_error
        .lock()
        .map_err(|_| "failed to lock snip background error".to_string())?;
    if let Some(image_path) = frozen.take() {
        let _ = fs::remove_file(image_path);
    }
    *error = None;
    Ok(())
}

fn cleanup_after_snip_selection(app: &AppHandle) -> Result<(), String> {
    let mut errors = Vec::new();
    if let Err(err) = crate::tool_windows::close_snip_window(app) {
        errors.push(err);
    }
    if let Err(err) = clear_frozen_background(app) {
        errors.push(err);
    }
    if let Err(err) = crate::shell::recover_shell_windows(app) {
        errors.push(err);
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

pub fn begin_snip_capture(app: &AppHandle) -> Result<(), String> {
    app.state::<SnipCaptureState>()
        .capture_in_flight
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map(|_| ())
        .map_err(|_| "A screenshot capture is already in progress".to_string())
}

pub fn finish_snip_capture(app: &AppHandle) {
    app.state::<SnipCaptureState>()
        .capture_in_flight
        .store(false, Ordering::Release);
}

pub fn is_snip_capture_in_flight(app: &AppHandle) -> bool {
    app.state::<SnipCaptureState>()
        .capture_in_flight
        .load(Ordering::Acquire)
}
