use crate::shell::ShellBounds;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const STICKY_NOTES_VERSION: u8 = 1;
pub const STICKY_NOTES_UPDATED_EVENT: &str = "sticky-notes-updated";
pub const STICKY_WINDOW_LABEL_PREFIX: &str = "sticky-note-";

pub const DEFAULT_STICKY_WIDTH: u32 = 320;
pub const DEFAULT_STICKY_HEIGHT: u32 = 340;
pub const MIN_STICKY_WIDTH: u32 = 240;
pub const MIN_STICKY_HEIGHT: u32 = 220;
pub const MAX_RESTORE_STICKY_NOTES: usize = 16;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StickyWindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl From<ShellBounds> for StickyWindowBounds {
    fn from(value: ShellBounds) -> Self {
        Self {
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
        }
    }
}

impl From<StickyWindowBounds> for ShellBounds {
    fn from(value: StickyWindowBounds) -> Self {
        Self {
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StickyNoteRecord {
    pub note_id: String,
    pub bounds: StickyWindowBounds,
    pub always_on_top: bool,
    pub color: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickyNotesState {
    pub stickies: Vec<StickyNoteRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStickyNoteOptionsPayload {
    pub note_id: String,
    pub always_on_top: Option<bool>,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RawStickyNoteRecord {
    pub note_id: Option<String>,
    pub bounds: Option<StickyWindowBounds>,
    pub always_on_top: Option<bool>,
    pub color: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct StoredStickyNotesFile {
    #[serde(rename = "version", default = "default_sticky_notes_version")]
    pub _version: u8,
    #[serde(default)]
    pub stickies: Vec<RawStickyNoteRecord>,
}

fn default_sticky_notes_version() -> u8 {
    STICKY_NOTES_VERSION
}

pub fn normalize_sticky_color(color: Option<&str>) -> String {
    match color
        .map(|value| value.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("slate") => "slate".to_string(),
        Some("sky") => "sky".to_string(),
        Some("mint") => "mint".to_string(),
        _ => "amber".to_string(),
    }
}

pub fn sticky_window_label(note_id: &str) -> String {
    let mut safe = String::with_capacity(note_id.len());
    let mut altered = false;
    for ch in note_id.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            safe.push(ch);
        } else {
            safe.push('_');
            altered = true;
        }
    }
    if altered || safe.is_empty() {
        let mut hash: u32 = 0x811c_9dc5;
        for byte in note_id.as_bytes() {
            hash ^= u32::from(*byte);
            hash = hash.wrapping_mul(0x0100_0193);
        }
        format!("{STICKY_WINDOW_LABEL_PREFIX}{safe}-{hash:08x}")
    } else {
        format!("{STICKY_WINDOW_LABEL_PREFIX}{safe}")
    }
}

/// Remove sticky viewport records whose parent QuickNote no longer exists.
/// Returns `true` if any orphan record was pruned.
pub fn reconcile_stickies_with_notes(
    stickies: &mut Vec<StickyNoteRecord>,
    existing_note_ids: &HashSet<String>,
) -> bool {
    let original_len = stickies.len();
    stickies.retain(|record| existing_note_ids.contains(&record.note_id));
    stickies.len() != original_len
}
