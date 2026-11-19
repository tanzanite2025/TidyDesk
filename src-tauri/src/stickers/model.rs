use serde::{Deserialize, Serialize};

pub const STICKER_UPDATED_EVENT: &str = "sticker-updated";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StickerStateFile {
    pub stickers: Vec<StickerRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StickerRecord {
    pub id: String,
    pub image_path: String,
    pub bounds: StickerWindowBounds,
    pub always_on_top: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StickerWindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerDataPayload {
    pub id: String,
    pub image_path: String,
    pub always_on_top: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerPinResultPayload {
    pub success: bool,
    pub always_on_top: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickerUpdatedPayload {
    pub id: String,
    pub always_on_top: bool,
}

#[derive(Debug)]
pub struct CapturedSticker {
    pub sticker_id: Option<String>,
    pub pasted: bool,
}

pub fn sanitize_sticker_id(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}
