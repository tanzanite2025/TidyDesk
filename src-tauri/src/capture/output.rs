use arboard::{Clipboard, ImageData};
use image::GenericImageView;
use rfd::FileDialog;
use std::borrow::Cow;
use std::fs;
use std::path::PathBuf;

pub const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// Validate raw PNG bytes by signature and decodable dimensions before any persistence or export.
pub fn validate_png_bytes(png: &[u8]) -> Result<(u32, u32), String> {
    if png.is_empty() {
        return Err("[CRITICAL] Empty PNG byte buffer cannot be exported".to_string());
    }
    if !png.starts_with(&PNG_SIGNATURE) {
        return Err("[CRITICAL] Invalid PNG signature in exported image payload".to_string());
    }
    let decoded = image::load_from_memory(png)
        .map_err(|err| format!("[CRITICAL] Failed to decode exported PNG payload: {err}"))?;
    let (width, height) = decoded.dimensions();
    if width == 0 || height == 0 {
        return Err("[CRITICAL] Exported PNG has zero width or height".to_string());
    }
    Ok((width, height))
}

/// Write encoded PNG bytes to the OS clipboard as RGBA image data.
pub fn copy_png_bytes_to_clipboard(png: &[u8]) -> Result<(), String> {
    let decoded = image::load_from_memory(png)
        .map_err(|err| format!("failed to decode PNG for clipboard: {err}"))?;
    let rgba = decoded.to_rgba8();
    let (width, height) = rgba.dimensions();
    if width == 0 || height == 0 {
        return Err("[CRITICAL] Cannot copy empty image to clipboard".to_string());
    }

    let mut clipboard =
        Clipboard::new().map_err(|err| format!("failed to access system clipboard: {err}"))?;
    clipboard
        .set_image(ImageData {
            width: width as usize,
            height: height as usize,
            bytes: Cow::Owned(rgba.into_raw()),
        })
        .map_err(|err| format!("failed to copy image to clipboard: {err}"))?;
    Ok(())
}

/// Prompt a native save dialog and write PNG bytes to the chosen path.
pub fn save_png_bytes_with_dialog(
    png: &[u8],
    title: &str,
    suggested_file_name: &str,
) -> Result<Option<PathBuf>, String> {
    validate_png_bytes(png)?;
    let default_dir = crate::stickers::store::pictures_dir();
    let Some(file_path) = FileDialog::new()
        .set_title(title)
        .set_directory(&default_dir)
        .add_filter("PNG Image", &["png"])
        .set_file_name(suggested_file_name)
        .save_file()
    else {
        return Ok(None);
    };

    fs::write(&file_path, png).map_err(|err| format!("failed to save PNG image: {err}"))?;
    Ok(Some(file_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::screen_gdi::encode_rgba_png_fast;

    #[test]
    fn validate_png_bytes_rejects_empty_and_corrupt_payloads() {
        assert!(validate_png_bytes(&[]).is_err());
        assert!(validate_png_bytes(b"not-a-png").is_err());
        let mut truncated = PNG_SIGNATURE.to_vec();
        truncated.extend_from_slice(&[0u8; 8]);
        assert!(validate_png_bytes(&truncated).is_err());
    }

    #[test]
    fn validate_png_bytes_accepts_encoded_png_and_reports_dimensions() {
        let rgba = [255u8; 4 * 3 * 2];
        let png = encode_rgba_png_fast(&rgba, 3, 2).expect("encoding should succeed");
        let (width, height) = validate_png_bytes(&png).expect("valid PNG should pass");
        assert_eq!((width, height), (3, 2));
    }
}
