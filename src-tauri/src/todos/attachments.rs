use super::model::{create_todo_id, safe_todo_title};
use crate::capture::screen_gdi::encode_rgba_png_fast;
use image::ImageFormat;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const MAX_TODO_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;
pub const THUMB_MAX_EDGE_PX: u32 = 360;

pub fn todo_attachments_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("todos").join("attachments"))
        .map_err(|err| format!("failed to resolve todo attachments root: {err}"))
}

pub(super) fn sanitize_card_id_segment(card_id: &str) -> Result<String, String> {
    let trimmed = card_id.trim();
    if trimmed.is_empty()
        || !trimmed
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("Invalid todo card identifier".to_string());
    }
    Ok(trimmed.to_string())
}

pub(super) fn card_attachments_dir(app: &AppHandle, card_id: &str) -> Result<PathBuf, String> {
    let root = todo_attachments_root(app)?;
    let safe_id = sanitize_card_id_segment(card_id)?;
    let dir = root.join(safe_id);
    if !crate::is_path_inside(&dir, &root) {
        return Err("Unsafe todo attachment directory".to_string());
    }
    Ok(dir)
}

fn validate_and_encode_image_pair(bytes: &[u8]) -> Result<PreparedImagePair, String> {
    if bytes.is_empty() {
        return Err("图片内容为空".to_string());
    }
    if bytes.len() > MAX_TODO_ATTACHMENT_BYTES {
        return Err(format!(
            "图片超过大小限制（最大 {} MB）",
            MAX_TODO_ATTACHMENT_BYTES / (1024 * 1024)
        ));
    }

    let decoded =
        image::load_from_memory(bytes).map_err(|err| format!("不支持或损坏的图片格式: {err}"))?;
    let width = decoded.width();
    let height = decoded.height();
    if width == 0 || height == 0 {
        return Err("图片尺寸无效".to_string());
    }

    let (ext, mime_type, original_bytes) = match image::guess_format(bytes) {
        Ok(ImageFormat::Png) => ("png", "image/png", bytes.to_vec()),
        Ok(ImageFormat::Jpeg) => ("jpg", "image/jpeg", bytes.to_vec()),
        Ok(ImageFormat::WebP) => ("webp", "image/webp", bytes.to_vec()),
        _ => {
            let rgba = decoded.to_rgba8();
            let normalized_png = encode_rgba_png_fast(rgba.as_raw(), width, height)?;
            ("png", "image/png", normalized_png)
        }
    };

    let thumb = if width > THUMB_MAX_EDGE_PX || height > THUMB_MAX_EDGE_PX {
        decoded.thumbnail(THUMB_MAX_EDGE_PX, THUMB_MAX_EDGE_PX)
    } else {
        decoded
    };
    let thumb_rgba = thumb.to_rgba8();
    let (thumb_w, thumb_h) = thumb_rgba.dimensions();
    let thumb_png = encode_rgba_png_fast(thumb_rgba.as_raw(), thumb_w.max(1), thumb_h.max(1))?;

    Ok(PreparedImagePair {
        ext,
        mime_type,
        width,
        height,
        original_bytes,
        thumb_png,
    })
}

struct PreparedImagePair {
    ext: &'static str,
    mime_type: &'static str,
    width: u32,
    height: u32,
    original_bytes: Vec<u8>,
    thumb_png: Vec<u8>,
}

/// Validate image payload, write both original file and 360px thumbnail, and return attachment metadata.
pub(super) fn save_image_attachment(
    app: &AppHandle,
    card_id: &str,
    original_name: &str,
    bytes: &[u8],
) -> Result<Value, String> {
    let dir = card_attachments_dir(app, card_id)?;
    save_image_attachment_to_dir(&dir, original_name, bytes)
}

fn save_image_attachment_to_dir(
    dir: &Path,
    original_name: &str,
    bytes: &[u8],
) -> Result<Value, String> {
    let prepared = validate_and_encode_image_pair(bytes)?;
    fs::create_dir_all(dir)
        .map_err(|err| format!("failed to create todo attachment directory: {err}"))?;

    let attachment_id = create_todo_id("att");
    let file_name = format!("{attachment_id}.{}", prepared.ext);
    let thumb_file_name = format!("thumb_{attachment_id}.png");
    let original_path = dir.join(&file_name);
    let thumb_path = dir.join(&thumb_file_name);

    fs::write(&original_path, &prepared.original_bytes)
        .map_err(|err| format!("failed to write todo attachment file: {err}"))?;
    if let Err(err) = fs::write(&thumb_path, &prepared.thumb_png) {
        let _ = fs::remove_file(&original_path);
        return Err(format!("failed to write todo thumbnail file: {err}"));
    }

    let safe_name = safe_todo_title(original_name, &file_name);
    Ok(json!({
        "id": attachment_id,
        "kind": "image",
        "originalName": safe_name,
        "fileName": file_name,
        "thumbFileName": thumb_file_name,
        "width": prepared.width,
        "height": prepared.height,
        "sizeBytes": prepared.original_bytes.len(),
        "mimeType": prepared.mime_type,
        "createdAt": crate::timestamp_string(),
    }))
}

pub(super) fn attachment_asset_url(card_id: &str, file_name: &str) -> String {
    crate::asset_protocol::asset_url(&format!("todos/{card_id}/{file_name}"))
}

pub(super) fn enrich_attachment_view(card_id: &str, attachment: &Value) -> Value {
    let mut view = attachment.clone();
    if let Some(file_name) = attachment["fileName"].as_str() {
        view["assetUrl"] = json!(attachment_asset_url(card_id, file_name));
    }
    if let Some(thumb_name) = attachment["thumbFileName"].as_str() {
        view["thumbUrl"] = json!(attachment_asset_url(card_id, thumb_name));
    } else if let Some(file_name) = attachment["fileName"].as_str() {
        view["thumbUrl"] = json!(attachment_asset_url(card_id, file_name));
    }
    view
}

pub(super) fn remove_attachment_files(
    app: &AppHandle,
    card_id: &str,
    attachment: &Value,
) -> Result<(), String> {
    let dir = card_attachments_dir(app, card_id)?;
    for key in ["fileName", "thumbFileName"] {
        if let Some(name) = attachment[key].as_str().filter(|v| !v.is_empty()) {
            let path = dir.join(name);
            if path.parent() == Some(dir.as_path()) {
                match fs::remove_file(&path) {
                    Ok(()) => {}
                    Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                    Err(err) => {
                        return Err(format!("failed to remove todo attachment {name}: {err}"))
                    }
                }
            }
        }
    }
    Ok(())
}

pub(super) fn stage_card_attachments_delete(
    app: &AppHandle,
    card_id: &str,
) -> Result<Option<(PathBuf, PathBuf)>, String> {
    let dir = card_attachments_dir(app, card_id)?;
    match fs::metadata(&dir) {
        Ok(meta) if meta.is_dir() => {
            let suffix = sanitize_card_id_segment(card_id)?;
            let staged =
                dir.with_file_name(format!("{suffix}.{}.deleting", crate::timestamp_string()));
            fs::rename(&dir, &staged)
                .map_err(|err| format!("failed to stage todo attachments deletion: {err}"))?;
            Ok(Some((dir, staged)))
        }
        Ok(_) => Err("todo attachment directory path is not a directory".to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("failed to inspect todo attachments dir: {err}")),
    }
}

pub(super) fn rollback_card_attachments_delete(staged: Option<&(PathBuf, PathBuf)>) {
    if let Some((original, staged_dir)) = staged {
        if let Err(err) = fs::rename(staged_dir, original) {
            eprintln!(
                "[TIDYDESK] Failed to rollback todo attachments dir {}: {err}",
                original.display()
            );
        }
    }
}

pub(super) fn finalize_card_attachments_delete(staged: Option<&(PathBuf, PathBuf)>) {
    if let Some((_, staged_dir)) = staged {
        if let Err(err) = fs::remove_dir_all(staged_dir) {
            eprintln!(
                "[TIDYDESK] Failed to delete staged todo attachments dir {}: {err}",
                staged_dir.display()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("tidydesk-todo-att-{name}-{nanos}"))
    }

    #[test]
    fn save_image_attachment_generates_bounded_thumbnail_and_metadata() {
        let dir = temp_test_dir("thumb");
        let big_width = 720u32;
        let big_height = 360u32;
        let pixels = vec![120u8; (big_width * big_height * 4) as usize];
        let png_bytes = encode_rgba_png_fast(&pixels, big_width, big_height).unwrap();

        let saved = save_image_attachment_to_dir(&dir, "board-photo.png", &png_bytes).unwrap();
        let file_name = saved["fileName"].as_str().unwrap();
        let thumb_name = saved["thumbFileName"].as_str().unwrap();

        assert_eq!(saved["width"], json!(720));
        assert_eq!(saved["height"], json!(360));
        assert_eq!(saved["mimeType"], json!("image/png"));
        assert!(dir.join(file_name).is_file());
        assert!(dir.join(thumb_name).is_file());

        let thumb_img = image::open(dir.join(thumb_name)).unwrap();
        assert!(thumb_img.width() <= THUMB_MAX_EDGE_PX);
        assert!(thumb_img.height() <= THUMB_MAX_EDGE_PX);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_image_attachment_rejects_corrupt_bytes() {
        let dir = temp_test_dir("invalid");
        let err = save_image_attachment_to_dir(&dir, "bad.png", b"not-an-image").unwrap_err();
        assert!(err.contains("不支持或损坏的图片格式"));
        assert!(!dir.exists());
    }
}
