use super::monitor::{MonitorSnapshot, SnipRectPayload};
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ColorType, ImageEncoder};
use std::io::Cursor;

#[cfg(target_os = "windows")]
use std::ffi::c_void;
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS,
    HGDIOBJ, SRCCOPY,
};

#[cfg(target_os = "windows")]
const MAX_CAPTURE_PIXELS: i32 = 33_177_600;

pub fn encode_rgba_png_fast(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut cursor = Cursor::new(Vec::new());
    let encoder =
        PngEncoder::new_with_quality(&mut cursor, CompressionType::Fast, FilterType::NoFilter);
    encoder
        .write_image(rgba, width, height, ColorType::Rgba8.into())
        .map_err(|err| format!("failed to encode png: {err}"))?;
    Ok(cursor.into_inner())
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
    let pixels = capture_width.saturating_mul(capture_height);
    if pixels > MAX_CAPTURE_PIXELS {
        return Err("Screenshot area is too large to capture safely".to_string());
    }

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
            pixel[3] = 255;
        }

        encode_rgba_png_fast(&pixels, capture_width as u32, capture_height as u32)
    }
}

#[cfg(not(target_os = "windows"))]
pub fn capture_monitor_region_png(
    _monitor: &MonitorSnapshot,
    _rect: &SnipRectPayload,
) -> Result<Vec<u8>, String> {
    Err("Native screenshot capture is only implemented for Windows".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_rgba_png_fast_emits_valid_png_signature() {
        let rgba = [
            255u8, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
        ];
        let png = encode_rgba_png_fast(&rgba, 2, 2).expect("fast PNG encoding should succeed");
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]));
        let decoded = image::load_from_memory(&png).expect("encoded PNG should decode cleanly");
        assert_eq!((decoded.width(), decoded.height()), (2, 2));
    }
}
