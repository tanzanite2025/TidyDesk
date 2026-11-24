use super::model::{create_todo_id, safe_todo_title};
use crate::capture::screen_gdi::encode_rgba_png_fast;
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};
use serde_json::{json, Value};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

pub const MAX_TODO_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;
pub const THUMB_MAX_EDGE_PX: u32 = 480;

pub fn todo_attachments_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::accounts::account_todos_root(app)?.join("attachments"))
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

pub(crate) fn card_attachments_dir(app: &AppHandle, card_id: &str) -> Result<PathBuf, String> {
    let root = todo_attachments_root(app)?;
    let safe_id = sanitize_card_id_segment(card_id)?;
    let dir = root.join(safe_id);
    if !crate::is_path_inside(&dir, &root) {
        return Err("Unsafe todo attachment directory".to_string());
    }
    Ok(dir)
}

const SHA256_INITIAL_STATE: [u32; 8] = [
    0x6a09_e667,
    0xbb67_ae85,
    0x3c6e_f372,
    0xa54f_f53a,
    0x510e_527f,
    0x9b05_688c,
    0x1f83_d9ab,
    0x5be0_cd19,
];

const SHA256_ROUND_CONSTANTS: [u32; 64] = [
    0x428a_2f98,
    0x7137_4491,
    0xb5c0_fbcf,
    0xe9b5_dba5,
    0x3956_c25b,
    0x59f1_11f1,
    0x923f_82a4,
    0xab1c_5ed5,
    0xd807_aa98,
    0x1283_5b01,
    0x2431_85be,
    0x550c_7dc3,
    0x72be_5d74,
    0x80de_b1fe,
    0x9bdc_06a7,
    0xc19b_f174,
    0xe49b_69c1,
    0xefbe_4786,
    0x0fc1_9dc6,
    0x240c_a1cc,
    0x2de9_2c6f,
    0x4a74_84aa,
    0x5cb0_a9dc,
    0x76f9_88da,
    0x983e_5152,
    0xa831_c66d,
    0xb003_27c8,
    0xbf59_7fc7,
    0xc6e0_0bf3,
    0xd5a7_9147,
    0x06ca_6351,
    0x1429_2967,
    0x27b7_0a85,
    0x2e1b_2138,
    0x4d2c_6dfc,
    0x5338_0d13,
    0x650a_7354,
    0x766a_0abb,
    0x81c2_c92e,
    0x9272_2c85,
    0xa2bf_e8a1,
    0xa81a_664b,
    0xc24b_8b70,
    0xc76c_51a3,
    0xd192_e819,
    0xd699_0624,
    0xf40e_3585,
    0x106a_a070,
    0x19a4_c116,
    0x1e37_6c08,
    0x2748_774c,
    0x34b0_bcb5,
    0x391c_0cb3,
    0x4ed8_aa4a,
    0x5b9c_ca4f,
    0x682e_6ff3,
    0x748f_82ee,
    0x78a5_636f,
    0x84c8_7814,
    0x8cc7_0208,
    0x90be_fffa,
    0xa450_6ceb,
    0xbef9_a3f7,
    0xc671_78f2,
];

/// Cross-platform pure-Rust FIPS 180-4 SHA-256 hex digest (replaces Win32 BCrypt for mobile portability).
pub(crate) fn compute_sha256_hex(bytes: &[u8]) -> Result<String, String> {
    let mut state = SHA256_INITIAL_STATE;
    let bit_len = (bytes.len() as u64).wrapping_mul(8);
    let mut padded = Vec::with_capacity(bytes.len() + 72);
    padded.extend_from_slice(bytes);
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (slot, word_bytes) in w[..16].iter_mut().zip(chunk.chunks_exact(4)) {
            *slot =
                u32::from_be_bytes([word_bytes[0], word_bytes[1], word_bytes[2], word_bytes[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = h
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(SHA256_ROUND_CONSTANTS[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        let next = [a, b, c, d, e, f, g, h];
        for (slot, delta) in state.iter_mut().zip(next.iter()) {
            *slot = slot.wrapping_add(*delta);
        }
    }

    let mut hex = String::with_capacity(64);
    for word in state {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{word:08x}");
    }
    Ok(hex)
}

fn orientation_exif_code(orientation: Orientation) -> u8 {
    match orientation {
        Orientation::NoTransforms => 1,
        Orientation::FlipHorizontal => 2,
        Orientation::Rotate180 => 3,
        Orientation::FlipVertical => 4,
        Orientation::Rotate90FlipH => 5,
        Orientation::Rotate90 => 6,
        Orientation::Rotate270FlipH => 7,
        Orientation::Rotate270 => 8,
    }
}

pub(super) fn classify_orientation_kind(width: u32, height: u32) -> &'static str {
    if height > width {
        "portrait"
    } else if width > height {
        "landscape"
    } else {
        "square"
    }
}

pub(super) fn default_focal_point(orientation_kind: &str) -> (f64, f64) {
    if orientation_kind == "portrait" {
        (0.5, 0.36)
    } else {
        (0.5, 0.5)
    }
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

    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|err| format!("识别图片格式失败: {err}"))?;
    let mut decode_limits = image::Limits::default();
    decode_limits.max_image_width = Some(16_384);
    decode_limits.max_image_height = Some(16_384);
    decode_limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(decode_limits);
    let guessed_format = reader.format();
    let mut decoder = reader
        .into_decoder()
        .map_err(|err| format!("不支持或损坏的图片格式: {err}"))?;
    let exif_orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let exif_code = orientation_exif_code(exif_orientation);
    let mut decoded = DynamicImage::from_decoder(decoder)
        .map_err(|err| format!("不支持或损坏的图片格式: {err}"))?;
    decoded.apply_orientation(exif_orientation);

    let width = decoded.width();
    let height = decoded.height();
    if width == 0 || height == 0 {
        return Err("图片尺寸无效".to_string());
    }

    let (ext, mime_type, original_bytes) = match guessed_format {
        Some(ImageFormat::Png) => ("png", "image/png", bytes.to_vec()),
        Some(ImageFormat::Jpeg) => ("jpg", "image/jpeg", bytes.to_vec()),
        Some(ImageFormat::WebP) => ("webp", "image/webp", bytes.to_vec()),
        _ => {
            let rgba = decoded.to_rgba8();
            let normalized_png = encode_rgba_png_fast(rgba.as_raw(), width, height)?;
            ("png", "image/png", normalized_png)
        }
    };

    let sha256 = compute_sha256_hex(&original_bytes)?;
    let orientation_kind = classify_orientation_kind(width, height);
    let aspect_ratio = ((width as f64 / height as f64) * 10000.0).round() / 10000.0;
    let (focal_x, focal_y) = default_focal_point(orientation_kind);

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
        aspect_ratio,
        orientation_kind,
        exif_code,
        focal_x,
        focal_y,
        sha256,
        original_bytes,
        thumb_png,
    })
}

struct PreparedImagePair {
    ext: &'static str,
    mime_type: &'static str,
    width: u32,
    height: u32,
    aspect_ratio: f64,
    orientation_kind: &'static str,
    exif_code: u8,
    focal_x: f64,
    focal_y: f64,
    sha256: String,
    original_bytes: Vec<u8>,
    thumb_png: Vec<u8>,
}

/// Validate image payload, write both original file and orientation-corrected thumbnail, and return attachment metadata.
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
        "aspectRatio": prepared.aspect_ratio,
        "orientation": prepared.orientation_kind,
        "exifOrientation": prepared.exif_code,
        "focalPoint": {
            "x": prepared.focal_x,
            "y": prepared.focal_y
        },
        "previewMode": "cover",
        "sha256": prepared.sha256,
        "syncState": "local",
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

    let w = view["width"].as_u64().unwrap_or(0) as u32;
    let h = view["height"].as_u64().unwrap_or(0) as u32;
    let orientation_kind = view["orientation"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| classify_orientation_kind(w.max(1), h.max(1)).to_string());
    view["orientation"] = json!(orientation_kind);
    if view["aspectRatio"].as_f64().is_none() && w > 0 && h > 0 {
        let ratio = ((w as f64 / h as f64) * 10000.0).round() / 10000.0;
        view["aspectRatio"] = json!(ratio);
    }
    if !view["focalPoint"].is_object() {
        let (fx, fy) = default_focal_point(&orientation_kind);
        view["focalPoint"] = json!({ "x": fx, "y": fy });
    }
    if view["previewMode"]
        .as_str()
        .filter(|m| *m == "cover" || *m == "contain")
        .is_none()
    {
        view["previewMode"] = json!("cover");
    }
    if view["syncState"].as_str().is_none() {
        view["syncState"] = json!("local");
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
    fn compute_sha256_hex_matches_rfc_vector() {
        assert_eq!(
            compute_sha256_hex(b"").unwrap(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            compute_sha256_hex(b"abc").unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            compute_sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")
                .unwrap(),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
    }

    #[test]
    fn save_image_attachment_generates_bounded_thumbnail_and_metadata() {
        let dir = temp_test_dir("thumb");
        let big_width = 960u32;
        let big_height = 480u32;
        let pixels = vec![120u8; (big_width * big_height * 4) as usize];
        let png_bytes = encode_rgba_png_fast(&pixels, big_width, big_height).unwrap();

        let saved = save_image_attachment_to_dir(&dir, "board-photo.png", &png_bytes).unwrap();
        let file_name = saved["fileName"].as_str().unwrap();
        let thumb_name = saved["thumbFileName"].as_str().unwrap();

        assert_eq!(saved["width"], json!(960));
        assert_eq!(saved["height"], json!(480));
        assert_eq!(saved["orientation"], json!("landscape"));
        assert_eq!(saved["previewMode"], json!("cover"));
        assert_eq!(saved["focalPoint"], json!({ "x": 0.5, "y": 0.5 }));
        assert_eq!(saved["sha256"].as_str().map(str::len), Some(64));
        assert_eq!(saved["mimeType"], json!("image/png"));
        assert!(dir.join(file_name).is_file());
        assert!(dir.join(thumb_name).is_file());

        let thumb_img = image::open(dir.join(thumb_name)).unwrap();
        assert!(thumb_img.width() <= THUMB_MAX_EDGE_PX);
        assert!(thumb_img.height() <= THUMB_MAX_EDGE_PX);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn portrait_image_uses_subject_biased_focal_point() {
        let dir = temp_test_dir("portrait");
        let pixels = vec![90u8; (300 * 600 * 4) as usize];
        let png_bytes = encode_rgba_png_fast(&pixels, 300, 600).unwrap();

        let saved = save_image_attachment_to_dir(&dir, "phone-shot.png", &png_bytes).unwrap();
        assert_eq!(saved["orientation"], json!("portrait"));
        assert_eq!(saved["focalPoint"], json!({ "x": 0.5, "y": 0.36 }));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_image_attachment_rejects_corrupt_bytes() {
        let dir = temp_test_dir("invalid");
        let err = save_image_attachment_to_dir(&dir, "bad.png", b"not-an-image").unwrap_err();
        assert!(err.contains("不支持或损坏的图片格式"));
        assert!(!dir.exists());
    }

    #[test]
    fn validate_and_encode_rejects_oversized_and_svg_payloads() {
        let dir = temp_test_dir("limits");
        let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"></svg>";
        let svg_err = save_image_attachment_to_dir(&dir, "vector.svg", svg).unwrap_err();
        assert!(svg_err.contains("不支持或损坏的图片格式"));
        assert!(!dir.exists());

        let too_big = vec![0u8; MAX_TODO_ATTACHMENT_BYTES + 1];
        let size_err = validate_and_encode_image_pair(&too_big).err().unwrap();
        assert!(size_err.contains("图片超过大小限制"));
    }
}
