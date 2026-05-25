use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use image::{DynamicImage, ImageFormat, RgbaImage};
use std::ffi::c_void;
use std::io::Cursor;
use std::path::Path;
use windows::core::PCWSTR;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL};

const ICON_SIZE: i32 = 32;

#[cfg(windows)]
pub fn extract_icon_data_url(path: &Path) -> Option<String> {
    if !path.exists() {
        return None;
    }

    let wide: Vec<u16> = path
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .chain(Some(0))
        .collect();

    unsafe {
        let mut info = SHFILEINFOW::default();
        let result = SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        );
        if result == 0 || info.hIcon.is_invalid() {
            return None;
        }

        let encoded = icon_handle_to_data_url(info.hIcon).ok();
        let _ = DestroyIcon(info.hIcon);
        encoded
    }
}

#[cfg(not(windows))]
pub fn extract_icon_data_url(_path: &Path) -> Option<String> {
    None
}

#[cfg(windows)]
fn icon_handle_to_data_url(hicon: windows::Win32::UI::WindowsAndMessaging::HICON) -> Result<String, String> {
    unsafe {
        let screen_dc = GetDC(None);
        if screen_dc.0 == std::ptr::null_mut() {
            return Err("failed to get screen device context for icon extraction".to_string());
        }

        let memory_dc = CreateCompatibleDC(Some(screen_dc));
        if memory_dc.0 == std::ptr::null_mut() {
            let _ = ReleaseDC(None, screen_dc);
            return Err("failed to create memory device context for icon extraction".to_string());
        }

        let mut bitmap_info = BITMAPINFO::default();
        bitmap_info.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: ICON_SIZE,
            biHeight: -ICON_SIZE,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };

        let mut bits: *mut c_void = std::ptr::null_mut();
        let bitmap = CreateDIBSection(
            Some(screen_dc),
            &bitmap_info,
            DIB_RGB_COLORS,
            &mut bits,
            Some(HANDLE::default()),
            0,
        )
        .map_err(|err| format!("failed to create icon bitmap: {err}"))?;

        if bits.is_null() {
            let _ = DeleteDC(memory_dc);
            let _ = ReleaseDC(None, screen_dc);
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            return Err("failed to allocate icon bitmap bits".to_string());
        }

        std::ptr::write_bytes(bits, 0, (ICON_SIZE * ICON_SIZE * 4) as usize);
        let old_object = SelectObject(memory_dc, HGDIOBJ(bitmap.0));

        let draw_result = DrawIconEx(memory_dc, 0, 0, hicon, ICON_SIZE, ICON_SIZE, 0, None, DI_NORMAL);
        if let Err(err) = draw_result {
            let _ = SelectObject(memory_dc, old_object);
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            let _ = DeleteDC(memory_dc);
            let _ = ReleaseDC(None, screen_dc);
            return Err(format!("failed to draw icon: {err}"));
        }

        let pixels = std::slice::from_raw_parts(bits.cast::<u8>(), (ICON_SIZE * ICON_SIZE * 4) as usize).to_vec();

        let _ = SelectObject(memory_dc, old_object);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory_dc);
        let _ = ReleaseDC(None, screen_dc);

        let mut rgba = pixels;
        for pixel in rgba.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }

        let image = RgbaImage::from_raw(ICON_SIZE as u32, ICON_SIZE as u32, rgba)
            .ok_or_else(|| "failed to build icon image".to_string())?;
        let mut cursor = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut cursor, ImageFormat::Png)
            .map_err(|err| format!("failed to encode icon png: {err}"))?;

        Ok(format!(
            "data:image/png;base64,{}",
            BASE64_STANDARD.encode(cursor.into_inner())
        ))
    }
}
