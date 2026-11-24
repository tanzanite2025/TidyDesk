use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ColorType, ImageEncoder};
use std::collections::HashMap;
use std::ffi::c_void;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};
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
static ICON_DATA_URL_CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

fn icon_memory_cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    ICON_DATA_URL_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn stable_cache_digest(key: &str) -> String {
    let mut h1: u64 = 0xcbf29ce484222325;
    let mut h2: u64 = 0xaf63bd4c8601b7df;
    for &byte in key.as_bytes() {
        h1 ^= u64::from(byte);
        h1 = h1.wrapping_mul(0x100000001b3);
        h2 = h2.wrapping_mul(0x100000001b3) ^ u64::from(byte);
    }
    format!("{h1:016x}{h2:016x}")
}

fn disk_icon_cache_path_with_digest(app: &AppHandle, digest: &str) -> Option<PathBuf> {
    let cache_dir = app.path().app_cache_dir().ok()?.join("icons");
    Some(cache_dir.join(format!("{digest}.png")))
}

#[cfg(windows)]
pub fn extract_icon_data_url(path: &Path) -> Option<String> {
    extract_icon_data_url_internal(None, path)
}

#[cfg(windows)]
pub fn extract_icon_data_url_cached(app: &AppHandle, path: &Path) -> Option<String> {
    extract_icon_data_url_internal(Some(app), path)
}

const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

fn write_icon_cache_atomic(disk_path: &Path, bytes: &[u8]) -> bool {
    if let Some(parent) = disk_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let tmp_path = disk_path.with_extension(format!(
        "tmp-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    if fs::write(&tmp_path, bytes).is_ok() {
        if fs::rename(&tmp_path, disk_path).is_ok() {
            return true;
        }
        let _ = fs::remove_file(&tmp_path);
    }
    false
}

#[cfg(windows)]
fn extract_icon_data_url_internal(app: Option<&AppHandle>, path: &Path) -> Option<String> {
    if !path.exists() {
        return None;
    }
    if let Some(key) = icon_cache_key(path) {
        if let Ok(cache) = icon_memory_cache().lock() {
            if let Some(cached) = cache.get(&key) {
                return cached.clone();
            }
        }

        let digest = stable_cache_digest(&key);
        let disk_path = app.and_then(|handle| disk_icon_cache_path_with_digest(handle, &digest));

        if let Some(disk_path_ref) = disk_path.as_ref() {
            if let Ok(header_bytes) = fs::read(disk_path_ref) {
                if header_bytes.starts_with(&PNG_MAGIC) {
                    let asset_url =
                        crate::asset_protocol::asset_url(&format!("icons/{digest}.png"));
                    if let Ok(mut cache) = icon_memory_cache().lock() {
                        cache.insert(key, Some(asset_url.clone()));
                    }
                    return Some(asset_url);
                }
            }
        }

        let png_bytes = extract_icon_png_bytes_uncached(path);
        let resolved_url = png_bytes.as_ref().map(|bytes| {
            if let Some(disk_path_ref) = disk_path.as_ref() {
                if write_icon_cache_atomic(disk_path_ref, bytes) {
                    return crate::asset_protocol::asset_url(&format!("icons/{digest}.png"));
                }
            }
            format!("data:image/png;base64,{}", BASE64_STANDARD.encode(bytes))
        });

        if let Ok(mut cache) = icon_memory_cache().lock() {
            cache.insert(key, resolved_url.clone());
        }
        return resolved_url;
    }

    extract_icon_png_bytes_uncached(path)
        .map(|bytes| format!("data:image/png;base64,{}", BASE64_STANDARD.encode(bytes)))
}

#[cfg(windows)]
fn icon_cache_key(path: &Path) -> Option<String> {
    let metadata = path.metadata().ok()?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    Some(format!(
        "{}:{}:{}",
        path.to_string_lossy().to_lowercase(),
        metadata.len(),
        modified_ms
    ))
}

#[cfg(windows)]
fn extract_icon_png_bytes_uncached(path: &Path) -> Option<Vec<u8>> {
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

        let encoded = icon_handle_to_png_bytes(info.hIcon).ok();
        let _ = DestroyIcon(info.hIcon);
        encoded
    }
}

#[cfg(not(windows))]
pub fn extract_icon_data_url(_path: &Path) -> Option<String> {
    None
}

#[cfg(not(windows))]
pub fn extract_icon_data_url_cached(_app: &AppHandle, _path: &Path) -> Option<String> {
    None
}

#[cfg(windows)]
fn icon_handle_to_png_bytes(
    hicon: windows::Win32::UI::WindowsAndMessaging::HICON,
) -> Result<Vec<u8>, String> {
    unsafe {
        let screen_dc = GetDC(None);
        if screen_dc.0.is_null() {
            return Err("failed to get screen device context for icon extraction".to_string());
        }

        let memory_dc = CreateCompatibleDC(Some(screen_dc));
        if memory_dc.0.is_null() {
            let _ = ReleaseDC(None, screen_dc);
            return Err("failed to create memory device context for icon extraction".to_string());
        }

        let bitmap_info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: ICON_SIZE,
                biHeight: -ICON_SIZE,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
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

        let draw_result = DrawIconEx(
            memory_dc, 0, 0, hicon, ICON_SIZE, ICON_SIZE, 0, None, DI_NORMAL,
        );
        if let Err(err) = draw_result {
            let _ = SelectObject(memory_dc, old_object);
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
            let _ = DeleteDC(memory_dc);
            let _ = ReleaseDC(None, screen_dc);
            return Err(format!("failed to draw icon: {err}"));
        }

        let pixels =
            std::slice::from_raw_parts(bits.cast::<u8>(), (ICON_SIZE * ICON_SIZE * 4) as usize)
                .to_vec();

        let _ = SelectObject(memory_dc, old_object);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory_dc);
        let _ = ReleaseDC(None, screen_dc);

        let mut rgba = pixels;
        for pixel in rgba.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }

        let mut cursor = Cursor::new(Vec::new());
        let encoder =
            PngEncoder::new_with_quality(&mut cursor, CompressionType::Fast, FilterType::NoFilter);
        encoder
            .write_image(
                &rgba,
                ICON_SIZE as u32,
                ICON_SIZE as u32,
                ColorType::Rgba8.into(),
            )
            .map_err(|err| format!("failed to encode icon png: {err}"))?;

        Ok(cursor.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_cache_digest_is_deterministic_and_hex() {
        let first = stable_cache_digest(r"c:\program files\app\app.exe:1024:999");
        let second = stable_cache_digest(r"c:\program files\app\app.exe:1024:999");
        let other = stable_cache_digest(r"c:\program files\app\app.exe:1025:999");

        assert_eq!(first, second);
        assert_ne!(first, other);
        assert_eq!(first.len(), 32);
        assert!(first.chars().all(|ch| ch.is_ascii_hexdigit()));
    }
}
