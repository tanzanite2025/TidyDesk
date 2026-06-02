use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

const QUICK_NOTES_VERSION: u8 = 2;
const QUICK_NOTES_FILE_NAME: &str = "quick-notes.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNote {
    id: String,
    title: String,
    content: String,
    pinned: bool,
    favorite: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickNotesState {
    notes: Vec<QuickNote>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateQuickNotePayload {
    title: Option<String>,
    content: Option<String>,
    pinned: Option<bool>,
    favorite: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateQuickNotePayload {
    id: String,
    title: Option<String>,
    content: Option<String>,
    pinned: Option<bool>,
    favorite: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawQuickNote {
    id: Option<String>,
    title: Option<String>,
    content: Option<String>,
    pinned: Option<bool>,
    favorite: Option<bool>,
    created_at: Option<String>,
    updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StoredQuickNotesFile {
    #[serde(rename = "version", default = "default_quick_notes_version")]
    _version: u8,
    #[serde(default)]
    notes: Vec<RawQuickNote>,
}

#[derive(Debug, Serialize)]
struct WritableQuickNotesFile {
    version: u8,
    notes: Vec<QuickNote>,
}

fn default_quick_notes_version() -> u8 {
    QUICK_NOTES_VERSION
}

fn safe_quick_note_title(title: &str, content: &str, fallback: &str) -> String {
    let normalized = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let value = if normalized.is_empty() {
        content
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .unwrap_or(fallback)
    } else {
        normalized.as_str()
    };
    value.chars().take(80).collect()
}

fn create_quick_note_id() -> String {
    format!("note-{}-{}", crate::timestamp_string(), std::process::id())
}

fn sort_quick_notes(notes: &mut [QuickNote]) {
    notes.sort_by(|left, right| {
        right
            .pinned
            .cmp(&left.pinned)
            .then_with(|| right.favorite.cmp(&left.favorite))
            .then_with(|| right.updated_at.cmp(&left.updated_at))
            .then_with(|| right.created_at.cmp(&left.created_at))
    });
}

fn quick_notes_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::files::file_storage_root(app)?.join(QUICK_NOTES_FILE_NAME))
}

fn ensure_quick_notes_storage(app: &AppHandle) -> Result<(), String> {
    fs::create_dir_all(crate::files::file_storage_root(app)?)
        .map_err(|err| format!("failed to create quick notes storage root: {err}"))
}

fn normalize_quick_note(note: RawQuickNote) -> Option<QuickNote> {
    let id = note.id?.trim().to_string();
    if id.is_empty() {
        return None;
    }

    let content = note.content.unwrap_or_default();
    let created_at = note
        .created_at
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(crate::timestamp_string);
    let updated_at = note
        .updated_at
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| created_at.clone());

    Some(QuickNote {
        id,
        title: safe_quick_note_title(
            note.title.as_deref().unwrap_or(""),
            &content,
            "未命名记录",
        ),
        content,
        pinned: note.pinned.unwrap_or(false),
        favorite: note.favorite.unwrap_or(false),
        created_at,
        updated_at,
    })
}

fn read_quick_notes(app: &AppHandle) -> Result<Vec<QuickNote>, String> {
    ensure_quick_notes_storage(app)?;
    let raw = fs::read_to_string(quick_notes_path(app)?).unwrap_or_default();
    let stored = serde_json::from_str::<StoredQuickNotesFile>(&raw).unwrap_or(StoredQuickNotesFile {
        _version: QUICK_NOTES_VERSION,
        notes: Vec::new(),
    });

    let mut notes = stored
        .notes
        .into_iter()
        .filter_map(normalize_quick_note)
        .collect::<Vec<_>>();
    sort_quick_notes(&mut notes);
    write_quick_notes(app, &notes)?;
    Ok(notes)
}

fn write_quick_notes(app: &AppHandle, notes: &[QuickNote]) -> Result<(), String> {
    ensure_quick_notes_storage(app)?;
    let payload = WritableQuickNotesFile {
        version: QUICK_NOTES_VERSION,
        notes: notes.to_vec(),
    };
    let content = serde_json::to_string_pretty(&payload)
        .map_err(|err| format!("failed to serialize quick notes: {err}"))?;
    fs::write(quick_notes_path(app)?, content)
        .map_err(|err| format!("failed to write quick notes: {err}"))
}

fn quick_notes_state(app: &AppHandle) -> Result<QuickNotesState, String> {
    Ok(QuickNotesState {
        notes: read_quick_notes(app)?,
    })
}

#[tauri::command]
pub fn quick_notes_read_state(app: AppHandle) -> Result<QuickNotesState, String> {
    quick_notes_state(&app)
}

#[tauri::command]
pub fn quick_notes_create_note(
    app: AppHandle,
    payload: CreateQuickNotePayload,
) -> Result<QuickNotesState, String> {
    let mut notes = read_quick_notes(&app)?;
    let content = payload.content.unwrap_or_default();
    let now = crate::timestamp_string();
    notes.insert(
        0,
        QuickNote {
            id: create_quick_note_id(),
            title: safe_quick_note_title(
                payload.title.as_deref().unwrap_or(""),
                &content,
                "未命名记录",
            ),
            content,
            pinned: payload.pinned.unwrap_or(false),
            favorite: payload.favorite.unwrap_or(false),
            created_at: now.clone(),
            updated_at: now,
        },
    );
    sort_quick_notes(&mut notes);
    write_quick_notes(&app, &notes)?;
    quick_notes_state(&app)
}

#[tauri::command]
pub fn quick_notes_update_note(
    app: AppHandle,
    payload: UpdateQuickNotePayload,
) -> Result<QuickNotesState, String> {
    if payload.id.trim().is_empty() {
        return Err("Missing quick note id".to_string());
    }

    let mut notes = read_quick_notes(&app)?;
    let note = notes
        .iter_mut()
        .find(|note| note.id == payload.id)
        .ok_or_else(|| "Quick note not found".to_string())?;

    if let Some(content) = payload.content {
        note.content = content;
    }
    if let Some(title) = payload.title {
        note.title = safe_quick_note_title(&title, &note.content, "未命名记录");
    }
    if let Some(pinned) = payload.pinned {
        note.pinned = pinned;
    }
    if let Some(favorite) = payload.favorite {
        note.favorite = favorite;
    }
    note.updated_at = crate::timestamp_string();
    sort_quick_notes(&mut notes);
    write_quick_notes(&app, &notes)?;
    quick_notes_state(&app)
}

#[tauri::command]
pub fn quick_notes_delete_note(app: AppHandle, note_id: String) -> Result<QuickNotesState, String> {
    let mut notes = read_quick_notes(&app)?;
    notes.retain(|note| note.id != note_id);
    write_quick_notes(&app, &notes)?;
    quick_notes_state(&app)
}
