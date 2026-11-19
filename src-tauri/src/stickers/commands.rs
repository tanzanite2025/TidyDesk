use super::model::{
    sanitize_sticker_id, StickerDataPayload, StickerPinResultPayload, StickerRecord,
    StickerUpdatedPayload, StickerWindowBounds, STICKER_UPDATED_EVENT,
};
use super::native_window::{
    close_native_sticker, ensure_native_sticker, update_native_sticker_pin,
};
use super::store::{
    ensure_storage, images_root, mutate_sticker_state, pictures_dir, read_sticker_state,
    upsert_sticker,
};
use arboard::{Clipboard, ImageData};
use rfd::FileDialog;
use serde_json::{json, Value};
use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

pub fn notify_sticker_message(app: &AppHandle, title: &str, body: &str) {
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

pub fn schedule_restore_stickers(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        let stickers = match mutate_sticker_state(&app, |state| {
            state
                .stickers
                .retain(|sticker| Path::new(&sticker.image_path).exists());
            Ok(state.stickers.clone())
        }) {
            Ok(list) => list,
            Err(err) => {
                eprintln!("[TIDYDESK] Failed to read stickers for delayed restore: {err}");
                return;
            }
        };

        for sticker in &stickers {
            if let Err(err) = ensure_native_sticker(&app, sticker) {
                eprintln!("[TIDYDESK] Failed to restore sticker {}: {err}", sticker.id);
            }
        }
    });
}

pub fn create_sticker_from_png(
    app: &AppHandle,
    png: &[u8],
    bounds: StickerWindowBounds,
) -> Result<String, String> {
    let sticker_id = format!(
        "sticker-{}-{}",
        crate::timestamp_string(),
        std::process::id()
    );
    let image_path = images_root(app)?.join(format!("{sticker_id}.png"));
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
    if let Err(err) = ensure_native_sticker(app, &sticker) {
        let _ = mutate_sticker_state(app, |state| {
            state.stickers.retain(|item| item.id != sticker_id);
            Ok(())
        });
        let _ = fs::remove_file(&image_path);
        return Err(err);
    }
    Ok(sticker_id)
}

pub fn toggle_sticker_pin_by_id(app: &AppHandle, sticker_id: &str) -> Result<Option<bool>, String> {
    ensure_storage(app)?;
    let Some(always_on_top) = mutate_sticker_state(app, |state| {
        let Some(sticker) = state.stickers.iter_mut().find(|item| item.id == sticker_id) else {
            return Ok(None);
        };
        sticker.always_on_top = !sticker.always_on_top;
        Ok(Some(sticker.always_on_top))
    })?
    else {
        return Ok(None);
    };

    update_native_sticker_pin(sticker_id, always_on_top)?;

    app.emit(
        STICKER_UPDATED_EVENT,
        StickerUpdatedPayload {
            id: sticker_id.to_string(),
            always_on_top,
        },
    )
    .map_err(|err| err.to_string())?;

    Ok(Some(always_on_top))
}

pub fn copy_sticker_by_id(app: &AppHandle, sticker_id: &str) -> Result<(), String> {
    ensure_storage(app)?;
    let state = read_sticker_state(app)?;
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
    Ok(())
}

pub fn save_sticker_as_by_id(app: &AppHandle, sticker_id: &str) -> Result<Option<PathBuf>, String> {
    ensure_storage(app)?;
    let state = read_sticker_state(app)?;
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
        return Ok(None);
    };

    fs::copy(&source_path, &file_path)
        .map_err(|err| format!("failed to save sticker image: {err}"))?;
    Ok(Some(file_path))
}

pub fn close_sticker_by_id(app: &AppHandle, sticker_id: &str) -> Result<(), String> {
    ensure_storage(app)?;
    let state = read_sticker_state(app)?;
    let sticker = state
        .stickers
        .iter()
        .find(|item| item.id == sticker_id)
        .cloned();

    close_native_sticker(sticker_id)?;
    let Some(sticker) = sticker else {
        return Ok(());
    };

    let image_path = PathBuf::from(&sticker.image_path);
    let staged_delete_path = if image_path.exists() {
        let delete_path = staged_sticker_delete_path(&image_path, sticker_id);
        fs::rename(&image_path, &delete_path)
            .map_err(|err| format!("failed to stage sticker image deletion: {err}"))?;
        Some(delete_path)
    } else {
        None
    };

    if let Err(err) = mutate_sticker_state(app, |state| {
        state.stickers.retain(|item| item.id != sticker_id);
        Ok(())
    }) {
        if let Some(delete_path) = &staged_delete_path {
            let _ = fs::rename(delete_path, &image_path);
        }
        let _ = ensure_native_sticker(app, &sticker);
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
    Ok(())
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
    match toggle_sticker_pin_by_id(&app, &sticker_id)? {
        Some(always_on_top) => Ok(StickerPinResultPayload {
            success: true,
            always_on_top: Some(always_on_top),
        }),
        None => Ok(StickerPinResultPayload {
            success: false,
            always_on_top: None,
        }),
    }
}

#[tauri::command]
pub fn sticker_copy(app: AppHandle, sticker_id: String) -> Result<Value, String> {
    copy_sticker_by_id(&app, &sticker_id)?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub fn sticker_save_as(app: AppHandle, sticker_id: String) -> Result<Value, String> {
    match save_sticker_as_by_id(&app, &sticker_id)? {
        Some(file_path) => Ok(json!({
            "success": true,
            "filePath": file_path.display().to_string(),
        })),
        None => Ok(json!({ "success": false, "canceled": true })),
    }
}

#[tauri::command]
pub fn sticker_close(app: AppHandle, sticker_id: String) -> Result<Value, String> {
    close_sticker_by_id(&app, &sticker_id)?;
    Ok(json!({ "success": true }))
}

fn staged_sticker_delete_path(image_path: &Path, sticker_id: &str) -> PathBuf {
    let file_name = image_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("sticker.png");
    image_path.with_file_name(format!(
        "{file_name}.{}.{}.deleting",
        sanitize_sticker_id(sticker_id),
        crate::timestamp_string()
    ))
}
