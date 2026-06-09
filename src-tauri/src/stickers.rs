use arboard::{Clipboard, ImageData};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
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
use tauri::{AppHandle, Emitter, Manager};

// 重新导出底层规则和结构，确保对 main.rs 等外部调用 100% 兼容
pub use crate::stickers_rules::{
    ensure_storage, mutate_sticker_state, read_sticker_state, upsert_sticker,
    CapturedSticker, SnipRectPayload, StickerDataPayload, StickerPinResultPayload,
    StickerRecord, StickerUpdatedPayload,
};

#[derive(Debug, Default)]
pub struct StickerStoreState(pub Mutex<()>);

#[derive(Debug, Default)]
pub struct SnipCaptureState {
    pub capture_in_flight: AtomicBool,
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
    crate::tool_windows::open_snip_window(app)
}

#[tauri::command]
pub async fn snip_complete_selection(
    app: AppHandle,
    payload: SnipRectPayload,
) -> Result<Value, String> {
    begin_snip_capture(&app)?;
    let app_handle = app.clone();
    let capture_result =
        tauri::async_runtime::spawn_blocking(move || capture_selection(&app_handle, payload)).await;
    finish_snip_capture(&app);
    let result = capture_result.map_err(|err| err.to_string())??;
    crate::shell::recover_shell_windows(&app)?;
    Ok(json!({
        "success": true,
        "stickerId": result.sticker_id,
    }))
}

#[tauri::command]
pub fn snip_cancel(app: AppHandle) -> Result<Value, String> {
    crate::tool_windows::close_snip_window(&app)?;
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

    if let Some(window) = app.get_webview_window(&crate::stickers_rules::sticker_window_label(&sticker_id)) {
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

    let default_path = crate::stickers_rules::pictures_dir().join(format!("TidyDesk-{}.png", sticker.id));
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
    let removed = mutate_sticker_state(&app, |state| {
        let removed = state
            .stickers
            .iter()
            .find(|item| item.id == sticker_id)
            .cloned();
        state.stickers.retain(|item| item.id != sticker_id);
        Ok(removed)
    })?;

    if let Some(window) = app.get_webview_window(&crate::stickers_rules::sticker_window_label(&sticker_id)) {
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
    let monitor = crate::stickers_rules::active_monitor(app)?;
    let normalized = crate::stickers_rules::normalize_rect(payload)?;
    crate::tool_windows::close_snip_window(app)?;
    std::thread::sleep(Duration::from_millis(140));

    let png = crate::stickers_rules::capture_monitor_region_png(&monitor, &normalized)?;
    let sticker_id = format!(
        "sticker-{}-{}",
        crate::timestamp_string(),
        std::process::id()
    );
    let image_path = crate::stickers_rules::images_root(app)?.join(format!("{sticker_id}.png"));
    fs::write(&image_path, &png).map_err(|err| format!("failed to write sticker image: {err}"))?;

    let sticker = StickerRecord {
        id: sticker_id.clone(),
        image_path: image_path.display().to_string(),
        bounds: crate::stickers_rules::initial_sticker_bounds(&monitor, &normalized),
        always_on_top: false,
        created_at: crate::timestamp_string(),
    };

    mutate_sticker_state(app, |state| {
        upsert_sticker(state, sticker.clone());
        Ok(())
    })?;
    crate::tool_windows::ensure_sticker_window(app, &sticker)?;

    Ok(CapturedSticker { sticker_id })
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
