use crate::capture::SnipCaptureState;
use std::fs;
use tauri::http::{header, Response, StatusCode};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AssetRoute {
    SnipCurrent,
    IconPng(String),
    StickerPng(String),
}

/// Build the platform-appropriate URL for TidyDesk's custom read-only asset protocol.
pub fn asset_url(route: &str) -> String {
    let clean = route.trim_start_matches('/');
    if cfg!(target_os = "windows") {
        format!("http://tidydesk-asset.localhost/{clean}")
    } else {
        format!("tidydesk-asset://localhost/{clean}")
    }
}

pub(crate) fn parse_asset_route(raw_path: &str) -> Option<AssetRoute> {
    if raw_path.contains('\\')
        || raw_path.contains("..")
        || raw_path.contains('?')
        || raw_path.contains('#')
        || raw_path.contains("//")
        || raw_path.bytes().any(|b| b.is_ascii_control())
    {
        return None;
    }

    let trimmed = raw_path.trim_start_matches('/');
    if trimmed == "snip/current" {
        return Some(AssetRoute::SnipCurrent);
    }

    if let Some(filename) = trimmed.strip_prefix("icons/") {
        if let Some(stem) = filename.strip_suffix(".png") {
            let valid_hex =
                stem.len() == 32 && stem.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
            if valid_hex && !filename.contains('/') {
                return Some(AssetRoute::IconPng(filename.to_string()));
            }
        }
        return None;
    }

    if let Some(filename) = trimmed.strip_prefix("stickers/") {
        if let Some(stem) = filename.strip_suffix(".png") {
            let valid_id = !stem.is_empty()
                && !filename.contains('/')
                && stem
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
            if valid_id {
                return Some(AssetRoute::StickerPng(filename.to_string()));
            }
        }
        return None;
    }

    None
}

fn build_response(
    status: StatusCode,
    content_type: &str,
    cache_control: &str,
    body: Vec<u8>,
) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, cache_control)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn text_error(status: StatusCode, message: &'static str) -> Response<Vec<u8>> {
    build_response(
        status,
        "text/plain; charset=utf-8",
        "no-store",
        message.as_bytes().to_vec(),
    )
}

/// Serve read-only memory screenshots, cached app/file icons, and sticker PNGs.
pub fn handle_asset_request(app: &AppHandle, uri_path: &str) -> Response<Vec<u8>> {
    let Some(route) = parse_asset_route(uri_path) else {
        return text_error(StatusCode::FORBIDDEN, "Forbidden asset route");
    };

    match route {
        AssetRoute::SnipCurrent => {
            let state = app.state::<SnipCaptureState>();
            let snapshot = state
                .frozen_image_bytes
                .lock()
                .ok()
                .and_then(|guard| guard.as_ref().map(|(_, bytes)| bytes.clone()));
            match snapshot {
                Some(bytes) => build_response(
                    StatusCode::OK,
                    "image/png",
                    "no-store",
                    bytes.as_ref().clone(),
                ),
                None => text_error(StatusCode::NOT_FOUND, "No frozen screenshot available"),
            }
        }
        AssetRoute::IconPng(filename) => {
            let Ok(cache_dir) = app.path().app_cache_dir() else {
                return text_error(StatusCode::NOT_FOUND, "Icon cache directory unavailable");
            };
            let path = cache_dir.join("icons").join(&filename);
            match fs::read(path) {
                Ok(bytes) => {
                    build_response(StatusCode::OK, "image/png", "public, max-age=86400", bytes)
                }
                Err(_) => text_error(StatusCode::NOT_FOUND, "Cached icon not found"),
            }
        }
        AssetRoute::StickerPng(filename) => {
            let Ok(images_dir) = crate::stickers::store::images_root(app) else {
                return text_error(StatusCode::NOT_FOUND, "Sticker storage unavailable");
            };
            let path = images_dir.join(&filename);
            match fs::read(path) {
                Ok(bytes) => {
                    build_response(StatusCode::OK, "image/png", "public, max-age=86400", bytes)
                }
                Err(_) => text_error(StatusCode::NOT_FOUND, "Sticker image not found"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_asset_route_accepts_expected_paths() {
        assert_eq!(
            parse_asset_route("/snip/current"),
            Some(AssetRoute::SnipCurrent)
        );
        assert_eq!(
            parse_asset_route("/icons/0123456789abcdef0123456789abcdef.png"),
            Some(AssetRoute::IconPng(
                "0123456789abcdef0123456789abcdef.png".to_string()
            ))
        );
        assert_eq!(
            parse_asset_route("/stickers/sticker-123_abc.png"),
            Some(AssetRoute::StickerPng("sticker-123_abc.png".to_string()))
        );
    }

    #[test]
    fn parse_asset_route_rejects_traversal_and_unknown_routes() {
        assert_eq!(parse_asset_route("/../secret.png"), None);
        assert_eq!(parse_asset_route("/icons/..\\evil.png"), None);
        assert_eq!(parse_asset_route("/icons/nothex.png"), None);
        assert_eq!(parse_asset_route("/stickers/.png"), None);
        assert_eq!(parse_asset_route("/stickers/a/b.png"), None);
        assert_eq!(parse_asset_route("/other/file.png"), None);
    }
}
