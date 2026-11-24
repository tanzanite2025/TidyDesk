use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

const QUICK_NOTES_VERSION: u8 = 2;
const QUICK_NOTES_FILE_NAME: &str = "quick-notes.json";
const QUICK_NOTE_FALLBACK_TITLE: &str = "Untitled Note";

#[derive(Debug, Default)]
pub struct QuickNotesStoreState(Mutex<()>);

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

fn with_quick_notes_store_lock<T>(
    app: &AppHandle,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<QuickNotesStoreState>();
    let _guard = state
        .0
        .lock()
        .map_err(|_| "failed to lock quick notes store".to_string())?;
    operation()
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

static QUICK_NOTE_ID_SEQ: AtomicU64 = AtomicU64::new(0);

fn create_quick_note_id() -> String {
    let seq = QUICK_NOTE_ID_SEQ.fetch_add(1, Ordering::Relaxed);
    format!(
        "note-{}-{}-{}",
        crate::timestamp_string(),
        std::process::id(),
        seq
    )
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
    Ok(crate::accounts::account_quick_notes_root(app)?.join(QUICK_NOTES_FILE_NAME))
}

fn ensure_quick_notes_storage_unlocked(app: &AppHandle) -> Result<(), String> {
    fs::create_dir_all(crate::accounts::account_quick_notes_root(app)?)
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
            QUICK_NOTE_FALLBACK_TITLE,
        ),
        content,
        pinned: note.pinned.unwrap_or(false),
        favorite: note.favorite.unwrap_or(false),
        created_at,
        updated_at,
    })
}

fn read_quick_notes_unlocked(app: &AppHandle) -> Result<Vec<QuickNote>, String> {
    ensure_quick_notes_storage_unlocked(app)?;
    let path = quick_notes_path(app)?;
    let raw = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            write_quick_notes_unlocked(app, &[])?;
            return Ok(Vec::new());
        }
        Err(err) => return Err(format!("failed to read quick notes: {err}")),
    };
    let (stored, recovered) = match serde_json::from_str::<StoredQuickNotesFile>(&raw) {
        Ok(value) => (value, false),
        Err(_) => {
            crate::persistence::backup_corrupt_file(&path, "quick notes")?;
            (
                StoredQuickNotesFile {
                    _version: QUICK_NOTES_VERSION,
                    notes: Vec::new(),
                },
                true,
            )
        }
    };
    let version_changed = stored._version != QUICK_NOTES_VERSION;
    let mut notes = stored
        .notes
        .into_iter()
        .filter_map(normalize_quick_note)
        .collect::<Vec<_>>();
    sort_quick_notes(&mut notes);
    let expected_json = serde_json::to_value(WritableQuickNotesFile {
        version: QUICK_NOTES_VERSION,
        notes: notes.clone(),
    })
    .ok();
    let raw_json = serde_json::from_str::<serde_json::Value>(&raw).ok();
    if recovered || version_changed || expected_json != raw_json {
        write_quick_notes_unlocked(app, &notes)?;
    }
    Ok(notes)
}

fn write_quick_notes_unlocked(app: &AppHandle, notes: &[QuickNote]) -> Result<(), String> {
    ensure_quick_notes_storage_unlocked(app)?;
    let payload = WritableQuickNotesFile {
        version: QUICK_NOTES_VERSION,
        notes: notes.to_vec(),
    };
    crate::persistence::atomic_write_json_fast(&quick_notes_path(app)?, &payload, "quick notes")
}

fn quick_notes_state(app: &AppHandle) -> Result<QuickNotesState, String> {
    with_quick_notes_store_lock(app, || {
        Ok(QuickNotesState {
            notes: read_quick_notes_unlocked(app)?,
        })
    })
}

pub(crate) fn existing_quick_note_titles(
    app: &AppHandle,
) -> Result<std::collections::HashMap<String, String>, String> {
    with_quick_notes_store_lock(app, || {
        let notes = read_quick_notes_unlocked(app)?;
        Ok(notes
            .into_iter()
            .map(|note| (note.id, note.title))
            .collect())
    })
}

fn emit_quick_notes_updated(app: &AppHandle, state: &QuickNotesState) {
    let _ = app.emit("quick-notes-updated", state);
}

pub(crate) fn refresh_and_emit_active_quick_notes_state(app: &AppHandle) -> Result<(), String> {
    let state = quick_notes_state(app)?;
    emit_quick_notes_updated(app, &state);
    Ok(())
}

#[tauri::command]
pub async fn quick_notes_read_state(app: AppHandle) -> Result<QuickNotesState, String> {
    tauri::async_runtime::spawn_blocking(move || quick_notes_state(&app))
        .await
        .map_err(|err| format!("quick notes read task failed: {err}"))?
}

pub(crate) fn create_quick_note_sync(
    app: &AppHandle,
    payload: CreateQuickNotePayload,
) -> Result<(QuickNotesState, String), String> {
    let mut created_id_out = String::new();
    let next_state = with_quick_notes_store_lock(app, || {
        let mut notes = read_quick_notes_unlocked(app)?;
        let content = payload.content.unwrap_or_default();
        let now = crate::timestamp_string();

        let created_note = QuickNote {
            id: create_quick_note_id(),
            title: safe_quick_note_title(
                payload.title.as_deref().unwrap_or(""),
                &content,
                QUICK_NOTE_FALLBACK_TITLE,
            ),
            content,
            pinned: payload.pinned.unwrap_or(false),
            favorite: payload.favorite.unwrap_or(false),
            created_at: now.clone(),
            updated_at: now,
        };
        created_id_out = created_note.id.clone();
        let created_payload = serde_json::to_value(&created_note).unwrap_or_default();
        notes.insert(0, created_note);

        sort_quick_notes(&mut notes);
        write_quick_notes_unlocked(app, &notes)?;
        crate::sync::enqueue_outbox_event(
            app,
            crate::sync::OutboxEntityKind::QuickNote,
            &created_id_out,
            crate::sync::OutboxOperation::Upsert,
            created_payload,
        )?;
        Ok(QuickNotesState { notes })
    })?;
    emit_quick_notes_updated(app, &next_state);
    Ok((next_state, created_id_out))
}

pub(crate) fn create_blank_sticky_note(app: &AppHandle) -> Result<String, String> {
    let (_, note_id) = create_quick_note_sync(
        app,
        CreateQuickNotePayload {
            title: Some("新建便签".to_string()),
            content: Some(String::new()),
            pinned: Some(false),
            favorite: Some(false),
        },
    )?;
    Ok(note_id)
}

#[tauri::command]
pub async fn quick_notes_create_note(
    app: AppHandle,
    payload: CreateQuickNotePayload,
) -> Result<QuickNotesState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (next_state, _) = create_quick_note_sync(&app, payload)?;
        Ok(next_state)
    })
    .await
    .map_err(|err| format!("quick notes create task failed: {err}"))?
}

#[tauri::command]
pub async fn quick_notes_update_note(
    app: AppHandle,
    payload: UpdateQuickNotePayload,
) -> Result<QuickNotesState, String> {
    if payload.id.trim().is_empty() {
        return Err("Missing quick note id".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let next_state = with_quick_notes_store_lock(&app, || {
            let mut notes = read_quick_notes_unlocked(&app)?;
            let note = notes
                .iter_mut()
                .find(|note| note.id == payload.id)
                .ok_or_else(|| "Quick note not found".to_string())?;

            if let Some(content) = payload.content {
                note.content = content;
            }
            if let Some(title) = payload.title {
                note.title =
                    safe_quick_note_title(&title, &note.content, QUICK_NOTE_FALLBACK_TITLE);
            }
            if let Some(pinned) = payload.pinned {
                note.pinned = pinned;
            }
            if let Some(favorite) = payload.favorite {
                note.favorite = favorite;
            }

            note.updated_at = crate::timestamp_string();
            let updated_id = note.id.clone();
            let updated_payload = serde_json::to_value(&*note).unwrap_or_default();
            sort_quick_notes(&mut notes);
            write_quick_notes_unlocked(&app, &notes)?;
            crate::sync::enqueue_outbox_event(
                &app,
                crate::sync::OutboxEntityKind::QuickNote,
                &updated_id,
                crate::sync::OutboxOperation::Upsert,
                updated_payload,
            )?;
            Ok(QuickNotesState { notes })
        })?;
        emit_quick_notes_updated(&app, &next_state);
        Ok(next_state)
    })
    .await
    .map_err(|err| format!("quick notes update task failed: {err}"))?
}

#[tauri::command]
pub async fn quick_notes_delete_note(
    app: AppHandle,
    note_id: String,
) -> Result<QuickNotesState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let removed_id = note_id.clone();
        let next_state = with_quick_notes_store_lock(&app, || {
            let mut notes = read_quick_notes_unlocked(&app)?;
            notes.retain(|note| note.id != note_id);
            write_quick_notes_unlocked(&app, &notes)?;
            crate::sync::enqueue_outbox_event(
                &app,
                crate::sync::OutboxEntityKind::QuickNote,
                &note_id,
                crate::sync::OutboxOperation::Delete,
                serde_json::json!({ "id": note_id }),
            )?;
            Ok(QuickNotesState { notes })
        })?;
        crate::sticky_notes::handle_quick_notes_deleted(&app, &[removed_id]);
        emit_quick_notes_updated(&app, &next_state);
        Ok(next_state)
    })
    .await
    .map_err(|err| format!("quick notes delete task failed: {err}"))?
}

/// Apply remote QuickNote upserts and deletions pulled from the cloud sync server.
pub(crate) fn apply_pulled_quick_notes(
    app: &AppHandle,
    upserts: &[serde_json::Value],
    removed_ids: &[String],
) -> Result<(), String> {
    if upserts.is_empty() && removed_ids.is_empty() {
        return Ok(());
    }
    let next_state = with_quick_notes_store_lock(app, || {
        let mut notes = read_quick_notes_unlocked(app)?;
        for rid in removed_ids {
            notes.retain(|note| &note.id != rid);
        }
        for raw in upserts {
            let Ok(remote) = serde_json::from_value::<QuickNote>(raw.clone()) else {
                continue;
            };
            if let Some(existing) = notes.iter_mut().find(|n| n.id == remote.id) {
                if remote.updated_at >= existing.updated_at {
                    *existing = remote;
                }
            } else {
                notes.push(remote);
            }
        }
        sort_quick_notes(&mut notes);
        write_quick_notes_unlocked(app, &notes)?;
        Ok(QuickNotesState { notes })
    })?;
    if !removed_ids.is_empty() {
        crate::sticky_notes::handle_quick_notes_deleted(app, removed_ids);
    }
    emit_quick_notes_updated(app, &next_state);
    Ok(())
}
