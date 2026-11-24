use super::monitor::{
    active_monitor, initial_sticker_bounds, normalize_rect, snip_open_monitor, SnipRectPayload,
};
use super::screen_gdi::{capture_monitor_region_png, encode_rgba_png_fast};
use super::SNIP_WINDOW_LABEL;
use crate::stickers::{
    create_sticker_from_png, ensure_storage, notify_sticker_message, CapturedSticker,
    StickerWindowBounds,
};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[derive(Debug, Clone)]
pub struct PendingSticker {
    image_path: PathBuf,
    bounds: StickerWindowBounds,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum SnipTarget {
    #[default]
    Sticker,
    TodoCard {
        card_id: String,
        subtask_id: Option<String>,
    },
}

#[derive(Default)]
pub struct SnipCaptureState {
    pub capture_in_flight: AtomicBool,
    pub snip_session_active: AtomicBool,
    pub frozen_image_version: AtomicU64,
    pub frozen_image_bytes: Mutex<Option<(u64, Arc<Vec<u8>>)>>,
    pub frozen_image_error: Mutex<Option<String>>,
    pub pending_sticker: Mutex<Option<PendingSticker>>,
    pub snip_target: Mutex<SnipTarget>,
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

pub fn clear_pending_sticker_cache(app: &AppHandle) {
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

pub fn open_snip_window(app: &AppHandle) -> Result<(), String> {
    open_snip_window_with_target(app, SnipTarget::Sticker)
}

pub fn open_snip_window_for_todo_card(
    app: &AppHandle,
    card_id: String,
    subtask_id: Option<String>,
) -> Result<(), String> {
    if is_snip_capture_in_flight(app) {
        return Err("截屏正在进行中，请先完成或取消当前截屏".to_string());
    }
    crate::tool_windows::hide_todo_window_for_snip(app)?;
    std::thread::sleep(Duration::from_millis(90));
    if let Err(err) = open_snip_window_with_target(
        app,
        SnipTarget::TodoCard {
            card_id,
            subtask_id,
        },
    ) {
        app.state::<SnipCaptureState>()
            .snip_session_active
            .store(false, Ordering::Release);
        let _ = take_snip_target(app);
        let _ = clear_frozen_background(app);
        let _ = crate::tool_windows::show_todo_window_after_snip(app);
        return Err(err);
    }
    Ok(())
}

fn open_snip_window_with_target(app: &AppHandle, target: SnipTarget) -> Result<(), String> {
    if is_snip_capture_in_flight(app) {
        return Err("A screenshot capture is already in progress".to_string());
    }

    let state = app.state::<SnipCaptureState>();
    {
        let mut target_guard = state
            .snip_target
            .lock()
            .map_err(|_| "failed to lock snip target".to_string())?;
        *target_guard = target;
    }
    state.snip_session_active.store(true, Ordering::Release);

    // 在打开窗口之前，先静默截取全屏
    let monitor = snip_open_monitor(app)?;
    let rect = SnipRectPayload {
        x: 0.0,
        y: 0.0,
        width: monitor.width as f64 / monitor.scale_factor,
        height: monitor.height as f64 / monitor.scale_factor,
    };
    match capture_monitor_region_png(&monitor, &rect) {
        Ok(png) => {
            let version = state.frozen_image_version.fetch_add(1, Ordering::Relaxed) + 1;
            let mut frozen = state
                .frozen_image_bytes
                .lock()
                .map_err(|_| "failed to lock snip background image".to_string())?;
            let mut error = state
                .frozen_image_error
                .lock()
                .map_err(|_| "failed to lock snip background error".to_string())?;
            *frozen = Some((version, Arc::new(png)));
            *error = None;
        }
        Err(err) => {
            let mut frozen = state
                .frozen_image_bytes
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
    if label == SNIP_WINDOW_LABEL {
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
        .frozen_image_bytes
        .lock()
        .map_err(|_| "failed to lock snip background image".to_string())?;
    if let Some((version, _)) = frozen.as_ref() {
        let image_url = crate::asset_protocol::asset_url(&format!("snip/current?v={version}"));
        Ok(json!({
            "success": true,
            "imageUrl": image_url
        }))
    } else {
        let error = state
            .frozen_image_error
            .lock()
            .map_err(|_| "failed to lock snip background error".to_string())?;
        Ok(json!({
            "success": false,
            "imageUrl": Value::Null,
            "error": error.as_deref().unwrap_or("No screenshot background is available")
        }))
    }
}

fn take_snip_target(app: &AppHandle) -> SnipTarget {
    let state = app.state::<SnipCaptureState>();
    let Ok(mut target) = state.snip_target.lock() else {
        return SnipTarget::Sticker;
    };
    std::mem::take(&mut *target)
}

#[tauri::command]
pub async fn snip_complete_selection(
    window: WebviewWindow,
    app: AppHandle,
    payload: SnipRectPayload,
) -> Result<Value, String> {
    require_snip_window(&window, "snip_complete_selection")?;
    begin_snip_capture(&app)?;
    app.state::<SnipCaptureState>()
        .snip_session_active
        .store(false, Ordering::Release);
    let target = take_snip_target(&app);
    let is_todo_target = matches!(target, SnipTarget::TodoCard { .. });
    let app_handle = app.clone();
    let capture_result = tauri::async_runtime::spawn_blocking(move || {
        capture_selection(&app_handle, payload, target)
    })
    .await;
    finish_snip_capture(&app);
    let result = capture_result
        .map_err(|err| err.to_string())
        .and_then(|result| result);
    if is_todo_target {
        if let Err(err) = &result {
            if let Some(todo_win) = app.get_webview_window("todos") {
                let _ = todo_win.emit("todo-snip-error", json!({ "error": err }));
            }
        }
    }
    if let Err(cleanup_err) = cleanup_after_snip_selection(&app, is_todo_target) {
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

fn restore_window_after_snip_abort(app: &AppHandle, target: &SnipTarget) -> Result<(), String> {
    if matches!(target, SnipTarget::TodoCard { .. }) {
        crate::tool_windows::show_todo_window_after_snip(app)
    } else {
        crate::shell::recover_shell_windows(app)
    }
}

#[tauri::command]
pub fn snip_cancel(app: AppHandle) -> Result<Value, String> {
    let was_active = app
        .state::<SnipCaptureState>()
        .snip_session_active
        .swap(false, Ordering::AcqRel);
    if !was_active {
        return Ok(json!({ "success": true }));
    }
    let target = take_snip_target(&app);
    crate::tool_windows::close_snip_window(&app)?;
    clear_frozen_background(&app)?;
    finish_snip_capture(&app);
    restore_window_after_snip_abort(&app, &target)?;
    Ok(json!({ "success": true }))
}

/// Recover target window state if the snip overlay window was closed externally by OS/Alt+F4.
pub fn handle_snip_window_aborted(app: &AppHandle) {
    let was_active = app
        .state::<SnipCaptureState>()
        .snip_session_active
        .swap(false, Ordering::AcqRel);
    if !was_active {
        return;
    }
    let target = take_snip_target(app);
    let _ = clear_frozen_background(app);
    finish_snip_capture(app);
    let _ = restore_window_after_snip_abort(app, &target);
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

fn capture_selection(
    app: &AppHandle,
    payload: SnipRectPayload,
    target: SnipTarget,
) -> Result<CapturedSticker, String> {
    let monitor = active_monitor(app)?;
    let normalized = normalize_rect(payload, &monitor)?;

    let state = app.state::<SnipCaptureState>();
    let png = {
        let mut frozen = state
            .frozen_image_bytes
            .lock()
            .map_err(|_| "failed to lock snip background image".to_string())?;
        if let Some((_, png_bytes)) = frozen.take() {
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
            let rgba = cropped.to_rgba8();
            encode_rgba_png_fast(rgba.as_raw(), crop_width, crop_height)?
        } else {
            crate::tool_windows::close_snip_window(app)?;
            std::thread::sleep(Duration::from_millis(140));
            capture_monitor_region_png(&monitor, &normalized)?
        }
    };

    crate::tool_windows::close_snip_window(app)?;
    clear_frozen_background(app)?;

    if let SnipTarget::TodoCard {
        card_id,
        subtask_id,
    } = target
    {
        crate::todos::attach_png_to_todo_card(
            app,
            &card_id,
            subtask_id.as_deref(),
            "screenshot.png",
            &png,
        )?;
        return Ok(CapturedSticker {
            sticker_id: None,
            pasted: false,
        });
    }

    ensure_storage(app)?;
    let bounds = initial_sticker_bounds(&monitor, &normalized);
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
        .frozen_image_bytes
        .lock()
        .map_err(|_| "failed to lock snip background image".to_string())?;
    let mut error = state
        .frozen_image_error
        .lock()
        .map_err(|_| "failed to lock snip background error".to_string())?;
    frozen.take();
    *error = None;
    Ok(())
}

fn cleanup_after_snip_selection(app: &AppHandle, is_todo_target: bool) -> Result<(), String> {
    let mut errors = Vec::new();
    if let Err(err) = crate::tool_windows::close_snip_window(app) {
        errors.push(err);
    }
    if let Err(err) = clear_frozen_background(app) {
        errors.push(err);
    }
    let recover_result = if is_todo_target {
        crate::tool_windows::show_todo_window_after_snip(app)
    } else {
        crate::shell::recover_shell_windows(app)
    };
    if let Err(err) = recover_result {
        errors.push(err);
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn begin_snip_capture(app: &AppHandle) -> Result<(), String> {
    app.state::<SnipCaptureState>()
        .capture_in_flight
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map(|_| ())
        .map_err(|_| "A screenshot capture is already in progress".to_string())
}

fn finish_snip_capture(app: &AppHandle) {
    app.state::<SnipCaptureState>()
        .capture_in_flight
        .store(false, Ordering::Release);
}

pub fn is_snip_capture_in_flight(app: &AppHandle) -> bool {
    app.state::<SnipCaptureState>()
        .capture_in_flight
        .load(Ordering::Acquire)
}
