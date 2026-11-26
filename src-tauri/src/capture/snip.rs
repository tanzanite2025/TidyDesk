use super::monitor::{
    active_monitor, initial_sticker_bounds, normalize_rect, snip_open_monitor, MonitorSnapshot,
    SnipRectPayload,
};
use super::output::{copy_png_bytes_to_clipboard, save_png_bytes_with_dialog, validate_png_bytes};
use super::screen_gdi::{capture_monitor_region_png, encode_rgba_png_fast};
use super::SNIP_WINDOW_LABEL;
use crate::stickers::{
    create_sticker_from_png, ensure_storage, notify_sticker_message, StickerWindowBounds,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SnipOutputAction {
    #[default]
    Default,
    Copy,
    PinSticker,
    SaveAs,
    StashPending,
    AttachTodo,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnipCompletePayload {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub action: SnipOutputAction,
    #[serde(default)]
    pub has_annotations: bool,
    #[serde(default)]
    pub composited_png_base64: Option<String>,
    #[serde(default)]
    pub composited_png_bytes: Option<Vec<u8>>,
    #[serde(default)]
    pub session_id: Option<u64>,
}

#[derive(Debug, Clone)]
struct SnipCompleteResult {
    action: SnipOutputAction,
    sticker_id: Option<String>,
    pasted: bool,
    saved_path: Option<String>,
    canceled: bool,
}

#[derive(Default)]
pub struct SnipCaptureState {
    pub capture_in_flight: AtomicBool,
    pub snip_session_active: AtomicBool,
    pub frozen_image_version: AtomicU64,
    pub frozen_image_bytes: Mutex<Option<(u64, Arc<Vec<u8>>)>>,
    pub frozen_monitor: Mutex<Option<MonitorSnapshot>>,
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
    std::thread::sleep(Duration::from_millis(50));
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

    let is_sticker_target = matches!(target, SnipTarget::Sticker);
    let monitor = snip_open_monitor(app)?;
    if is_sticker_target {
        crate::shell::hide_shell_windows_for_snip(app)?;
        std::thread::sleep(Duration::from_millis(50));
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
            let mut frozen_monitor = state
                .frozen_monitor
                .lock()
                .map_err(|_| "failed to lock snip monitor snapshot".to_string())?;
            let mut error = state
                .frozen_image_error
                .lock()
                .map_err(|_| "failed to lock snip background error".to_string())?;
            *frozen = Some((version, Arc::new(png)));
            *frozen_monitor = Some(monitor);
            *error = None;
        }
        Err(err) => {
            let mut frozen = state
                .frozen_image_bytes
                .lock()
                .map_err(|_| "failed to lock snip background image".to_string())?;
            let mut frozen_monitor = state
                .frozen_monitor
                .lock()
                .map_err(|_| "failed to lock snip monitor snapshot".to_string())?;
            let mut error = state
                .frozen_image_error
                .lock()
                .map_err(|_| "failed to lock snip background error".to_string())?;
            *frozen = None;
            *frozen_monitor = Some(monitor);
            *error = Some(err);
        }
    }

    if let Err(err) = crate::tool_windows::open_snip_window(app) {
        state.snip_session_active.store(false, Ordering::Release);
        let recovered_target = take_snip_target(app);
        let _ = clear_frozen_background(app);
        if is_sticker_target || matches!(recovered_target, SnipTarget::Sticker) {
            let _ = crate::shell::recover_shell_windows(app);
        }
        return Err(err);
    }
    Ok(())
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
    let target_kind = {
        let guard = state
            .snip_target
            .lock()
            .map_err(|_| "failed to lock snip target".to_string())?;
        match &*guard {
            SnipTarget::TodoCard { .. } => "todo_card",
            SnipTarget::Sticker => "standard",
        }
    };
    let monitor_json = {
        let guard = state
            .frozen_monitor
            .lock()
            .map_err(|_| "failed to lock snip monitor snapshot".to_string())?;
        guard.as_ref().map(|m| {
            json!({
                "width": m.width,
                "height": m.height,
                "logicalWidth": m.width as f64 / m.scale_factor.max(0.1),
                "logicalHeight": m.height as f64 / m.scale_factor.max(0.1),
                "scaleFactor": m.scale_factor,
            })
        })
    };
    let frozen = state
        .frozen_image_bytes
        .lock()
        .map_err(|_| "failed to lock snip background image".to_string())?;
    if let Some((version, _)) = frozen.as_ref() {
        let image_url = crate::asset_protocol::asset_url(&format!("snip/current?v={version}"));
        Ok(json!({
            "success": true,
            "sessionId": version,
            "imageUrl": image_url,
            "targetKind": target_kind,
            "monitor": monitor_json,
            "snapRects": [],
        }))
    } else {
        let error = state
            .frozen_image_error
            .lock()
            .map_err(|_| "failed to lock snip background error".to_string())?;
        Ok(json!({
            "success": false,
            "sessionId": Value::Null,
            "imageUrl": Value::Null,
            "targetKind": target_kind,
            "monitor": monitor_json,
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
    payload: SnipCompletePayload,
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
        "action": result.action,
        "stickerId": result.sticker_id,
        "pasted": result.pasted,
        "savedPath": result.saved_path,
        "canceled": result.canceled,
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
pub async fn snip_cancel(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|err| format!("snip cancel task failed: {err}"))?
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
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = restore_window_after_snip_abort(&app_handle, &target);
    });
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

fn resolve_effective_action(
    requested: SnipOutputAction,
    target: &SnipTarget,
    auto_stick_after_snip: bool,
) -> SnipOutputAction {
    match requested {
        SnipOutputAction::Default => match target {
            SnipTarget::TodoCard { .. } => SnipOutputAction::AttachTodo,
            SnipTarget::Sticker => {
                if auto_stick_after_snip {
                    SnipOutputAction::PinSticker
                } else {
                    SnipOutputAction::StashPending
                }
            }
        },
        other => other,
    }
}

fn resolve_composited_or_guard(
    has_annotations: bool,
    composited_png_base64: Option<String>,
    composited_png_bytes: Option<Vec<u8>>,
) -> Result<Option<Vec<u8>>, String> {
    let decoded = if let Some(b64) = composited_png_base64 {
        let bytes = BASE64_STANDARD
            .decode(b64.as_bytes())
            .map_err(|err| format!("[CRITICAL] Failed to decode composited PNG base64: {err}"))?;
        Some(bytes)
    } else {
        composited_png_bytes
    };

    match decoded {
        Some(bytes) => {
            validate_png_bytes(&bytes)?;
            Ok(Some(bytes))
        }
        None if has_annotations => Err(
            "[CRITICAL] Annotated screenshot requires valid composited PNG payload; refusing raw crop fallback"
                .to_string(),
        ),
        None => Ok(None),
    }
}

fn capture_selection(
    app: &AppHandle,
    payload: SnipCompletePayload,
    target: SnipTarget,
) -> Result<SnipCompleteResult, String> {
    // Validate annotated payload first before consuming monitor or frozen session state.
    let composited = resolve_composited_or_guard(
        payload.has_annotations,
        payload.composited_png_base64,
        payload.composited_png_bytes,
    )?;

    let state = app.state::<SnipCaptureState>();
    let monitor = {
        let mut frozen_monitor = state
            .frozen_monitor
            .lock()
            .map_err(|_| "failed to lock snip monitor snapshot".to_string())?;
        match frozen_monitor.take() {
            Some(snapshot) => snapshot,
            None => active_monitor(app)?,
        }
    };
    let rect_payload = SnipRectPayload {
        x: payload.x,
        y: payload.y,
        width: payload.width,
        height: payload.height,
    };
    let normalized = normalize_rect(rect_payload, &monitor)?;

    let png = {
        let mut frozen = state
            .frozen_image_bytes
            .lock()
            .map_err(|_| "failed to lock snip background image".to_string())?;
        let frozen_entry = frozen.take();
        if let (Some(req_session), Some((frozen_version, _))) =
            (payload.session_id, frozen_entry.as_ref())
        {
            if req_session != *frozen_version {
                return Err(
                    "[CRITICAL] Screenshot session mismatch; please retry screenshot".to_string(),
                );
            }
        }

        if let Some(png_bytes) = composited {
            png_bytes
        } else if let Some((_, png_bytes)) = frozen_entry {
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

    // Always close the topmost overlay and purge cached frozen buffer before any OS dialog or output sink runs.
    crate::tool_windows::close_snip_window(app)?;
    clear_frozen_background(app)?;

    let auto_stick = crate::resident::read_resident_settings(app).auto_stick_after_snip;
    let action = resolve_effective_action(payload.action, &target, auto_stick);

    match action {
        SnipOutputAction::AttachTodo => {
            let SnipTarget::TodoCard {
                card_id,
                subtask_id,
            } = target
            else {
                return Err(
                    "[CRITICAL] attach_todo action requires active TodoCard snip target"
                        .to_string(),
                );
            };
            crate::todos::attach_png_to_todo_card(
                app,
                &card_id,
                subtask_id.as_deref(),
                "screenshot.png",
                &png,
            )?;
            Ok(SnipCompleteResult {
                action,
                sticker_id: None,
                pasted: false,
                saved_path: None,
                canceled: false,
            })
        }
        SnipOutputAction::Copy => {
            copy_png_bytes_to_clipboard(&png)?;
            notify_sticker_message(
                app,
                "截图已复制到剪贴板",
                "可以直接粘贴到聊天窗口或文档中。",
            );
            Ok(SnipCompleteResult {
                action,
                sticker_id: None,
                pasted: false,
                saved_path: None,
                canceled: false,
            })
        }
        SnipOutputAction::SaveAs => {
            let suggested_name = format!("TidyDesk-{}.png", crate::timestamp_string());
            match save_png_bytes_with_dialog(&png, "保存截图", &suggested_name)? {
                Some(file_path) => {
                    notify_sticker_message(
                        app,
                        "截图已保存",
                        &format!("已保存到 {}", file_path.display()),
                    );
                    Ok(SnipCompleteResult {
                        action,
                        sticker_id: None,
                        pasted: false,
                        saved_path: Some(file_path.display().to_string()),
                        canceled: false,
                    })
                }
                None => Ok(SnipCompleteResult {
                    action,
                    sticker_id: None,
                    pasted: false,
                    saved_path: None,
                    canceled: true,
                }),
            }
        }
        SnipOutputAction::PinSticker => {
            ensure_storage(app)?;
            let bounds = initial_sticker_bounds(&monitor, &normalized);
            let sticker_id = create_sticker_from_png(app, &png, bounds)?;
            Ok(SnipCompleteResult {
                action,
                sticker_id: Some(sticker_id),
                pasted: true,
                saved_path: None,
                canceled: false,
            })
        }
        SnipOutputAction::StashPending => {
            ensure_storage(app)?;
            let bounds = initial_sticker_bounds(&monitor, &normalized);
            save_pending_sticker(app, &png, bounds)?;
            notify_sticker_message(
                app,
                "截图已保存为待贴",
                "按 Ctrl+Alt+V 时才会把这张截图贴到桌面。",
            );
            Ok(SnipCompleteResult {
                action,
                sticker_id: None,
                pasted: false,
                saved_path: None,
                canceled: false,
            })
        }
        SnipOutputAction::Default => unreachable!("Default must resolve before output dispatch"),
    }
}

fn clear_frozen_background(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<SnipCaptureState>();
    let mut frozen = state
        .frozen_image_bytes
        .lock()
        .map_err(|_| "failed to lock snip background image".to_string())?;
    let mut frozen_monitor = state
        .frozen_monitor
        .lock()
        .map_err(|_| "failed to lock snip monitor snapshot".to_string())?;
    let mut error = state
        .frozen_image_error
        .lock()
        .map_err(|_| "failed to lock snip background error".to_string())?;
    frozen.take();
    frozen_monitor.take();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_effective_action_preserves_explicit_or_legacy_defaults() {
        let todo_target = SnipTarget::TodoCard {
            card_id: "c1".to_string(),
            subtask_id: None,
        };
        assert_eq!(
            resolve_effective_action(SnipOutputAction::Default, &todo_target, false),
            SnipOutputAction::AttachTodo
        );
        assert_eq!(
            resolve_effective_action(SnipOutputAction::Copy, &todo_target, false),
            SnipOutputAction::Copy
        );
        assert_eq!(
            resolve_effective_action(SnipOutputAction::Default, &SnipTarget::Sticker, true),
            SnipOutputAction::PinSticker
        );
        assert_eq!(
            resolve_effective_action(SnipOutputAction::Default, &SnipTarget::Sticker, false),
            SnipOutputAction::StashPending
        );
        assert_eq!(
            resolve_effective_action(SnipOutputAction::SaveAs, &SnipTarget::Sticker, false),
            SnipOutputAction::SaveAs
        );
    }

    #[test]
    fn resolve_composited_or_guard_fails_loudly_when_annotated_bytes_missing_or_corrupt() {
        let err = resolve_composited_or_guard(true, None, None)
            .expect_err("annotated snip without bytes must fail loudly");
        assert!(err.contains("[CRITICAL]"));

        let corrupt = resolve_composited_or_guard(true, None, Some(b"bad-png".to_vec()))
            .expect_err("corrupt PNG bytes must fail loudly");
        assert!(corrupt.contains("[CRITICAL]"));

        let corrupt_b64 =
            resolve_composited_or_guard(true, Some("!!!not-base64!!!".to_string()), None)
                .expect_err("corrupt base64 must fail loudly");
        assert!(corrupt_b64.contains("[CRITICAL]"));

        assert!(resolve_composited_or_guard(false, None, None)
            .expect("raw fast path should succeed")
            .is_none());

        let png = encode_rgba_png_fast(&[255u8; 16], 2, 2).expect("valid rgba png");
        let b64 = BASE64_STANDARD.encode(&png);
        let resolved_b64 = resolve_composited_or_guard(true, Some(b64), None)
            .expect("valid annotated base64 png should pass");
        assert_eq!(resolved_b64.as_deref(), Some(png.as_slice()));

        let resolved = resolve_composited_or_guard(true, None, Some(png.clone()))
            .expect("valid annotated png should pass");
        assert_eq!(resolved.as_deref(), Some(png.as_slice()));
    }
}
