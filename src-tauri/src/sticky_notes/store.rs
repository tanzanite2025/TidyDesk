use super::model::{
    normalize_sticky_color, RawStickyNoteRecord, StickyNoteRecord, StickyNotesState,
    StickyWindowBounds, StoredStickyNotesFile, WritableStickyNotesFile, DEFAULT_STICKY_HEIGHT,
    DEFAULT_STICKY_WIDTH, MIN_STICKY_HEIGHT, MIN_STICKY_WIDTH, STICKY_NOTES_VERSION,
};
use crate::shell::{
    available_work_areas, clamp_physical_bounds_to_monitors, default_cascade_bounds_for_monitor,
    scaled_px, ShellBounds, WorkAreaMonitor,
};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const STICKY_NOTES_FILE_NAME: &str = "sticky-notes.json";

#[derive(Debug, Default)]
pub struct StickyNotesStoreState(pub Mutex<()>);

pub fn with_sticky_notes_store_lock<T>(
    app: &AppHandle,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<StickyNotesStoreState>();
    let _guard = state
        .0
        .lock()
        .map_err(|_| "failed to lock sticky notes store".to_string())?;
    operation()
}

pub fn sticky_notes_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::accounts::account_quick_notes_root(app)?.join(STICKY_NOTES_FILE_NAME))
}

fn ensure_storage_root_unlocked(app: &AppHandle) -> Result<(), String> {
    fs::create_dir_all(crate::accounts::account_quick_notes_root(app)?)
        .map_err(|err| format!("failed to create sticky notes storage root: {err}"))
}

pub fn clamp_sticky_bounds_for_monitors(
    bounds: StickyWindowBounds,
    monitors: &[WorkAreaMonitor],
    primary: Option<WorkAreaMonitor>,
) -> StickyWindowBounds {
    clamp_physical_bounds_to_monitors(
        ShellBounds::from(bounds),
        MIN_STICKY_WIDTH,
        MIN_STICKY_HEIGHT,
        DEFAULT_STICKY_WIDTH,
        DEFAULT_STICKY_HEIGHT,
        0,
        monitors,
        primary,
    )
    .into()
}

pub fn default_sticky_bounds_for_monitor(
    monitor: WorkAreaMonitor,
    cascade_index: usize,
) -> StickyWindowBounds {
    default_cascade_bounds_for_monitor(
        monitor,
        DEFAULT_STICKY_WIDTH,
        DEFAULT_STICKY_HEIGHT,
        MIN_STICKY_WIDTH,
        MIN_STICKY_HEIGHT,
        cascade_index,
    )
    .into()
}

fn normalize_sticky_record(
    raw: RawStickyNoteRecord,
    monitors: &[WorkAreaMonitor],
    primary: Option<WorkAreaMonitor>,
    seen_ids: &mut HashSet<String>,
) -> Option<StickyNoteRecord> {
    let note_id = raw.note_id?.trim().to_string();
    if note_id.is_empty() || !seen_ids.insert(note_id.clone()) {
        return None;
    }

    let fallback_scale = primary
        .or_else(|| monitors.first().copied())
        .map(|m| m.scale_factor)
        .unwrap_or(1.0);
    let raw_bounds = raw.bounds.unwrap_or(StickyWindowBounds {
        x: 0,
        y: 0,
        width: scaled_px(DEFAULT_STICKY_WIDTH, fallback_scale),
        height: scaled_px(DEFAULT_STICKY_HEIGHT, fallback_scale),
    });
    let clamped_bounds = clamp_sticky_bounds_for_monitors(raw_bounds, monitors, primary);
    let updated_at = raw
        .updated_at
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(crate::timestamp_string);

    Some(StickyNoteRecord {
        note_id,
        bounds: clamped_bounds,
        always_on_top: raw.always_on_top.unwrap_or(false),
        color: normalize_sticky_color(raw.color.as_deref()),
        updated_at,
    })
}

pub(super) fn read_sticky_notes_from_path(
    path: &PathBuf,
    monitors: &[WorkAreaMonitor],
    primary: Option<WorkAreaMonitor>,
) -> Result<(Vec<StickyNoteRecord>, bool), String> {
    let raw = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok((Vec::new(), false));
        }
        Err(err) => return Err(format!("failed to read sticky notes: {err}")),
    };

    let (stored, recovered) = match serde_json::from_str::<StoredStickyNotesFile>(&raw) {
        Ok(value) => (value, false),
        Err(err) => {
            let backup_path = crate::persistence::backup_corrupt_file(path, "sticky notes")?;
            eprintln!(
                "[TIDYDESK] Backed up corrupt sticky notes file to {}: {err}",
                backup_path.display()
            );
            (
                StoredStickyNotesFile {
                    _version: STICKY_NOTES_VERSION,
                    stickies: Vec::new(),
                },
                true,
            )
        }
    };

    let mut seen_ids = HashSet::new();
    let stickies = stored
        .stickies
        .into_iter()
        .filter_map(|item| normalize_sticky_record(item, monitors, primary, &mut seen_ids))
        .collect::<Vec<_>>();
    let needs_rewrite = recovered || stored._version != STICKY_NOTES_VERSION;
    Ok((stickies, needs_rewrite))
}

pub fn write_sticky_notes_unlocked(
    app: &AppHandle,
    stickies: &[StickyNoteRecord],
) -> Result<(), String> {
    ensure_storage_root_unlocked(app)?;
    let path = sticky_notes_path(app)?;
    let payload = WritableStickyNotesFile {
        version: STICKY_NOTES_VERSION,
        stickies,
    };
    crate::persistence::atomic_write_json_fast(&path, &payload, "sticky notes")
}

pub fn read_sticky_notes_unlocked(app: &AppHandle) -> Result<Vec<StickyNoteRecord>, String> {
    ensure_storage_root_unlocked(app)?;
    let path = sticky_notes_path(app)?;
    let (monitors, primary) = available_work_areas(app);
    let (stickies, needs_rewrite) = read_sticky_notes_from_path(&path, &monitors, primary)?;
    if needs_rewrite || !path.exists() {
        write_sticky_notes_unlocked(app, &stickies)?;
    }
    Ok(stickies)
}

pub fn sticky_notes_state(app: &AppHandle) -> Result<StickyNotesState, String> {
    with_sticky_notes_store_lock(app, || {
        Ok(StickyNotesState {
            stickies: read_sticky_notes_unlocked(app)?,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sticky_notes::model::reconcile_stickies_with_notes;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("tidydesk-sticky-{name}-{nanos}"));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn clamp_recovers_from_minimized_and_disconnected_monitor() {
        let primary = WorkAreaMonitor {
            bounds: ShellBounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1040,
            },
            scale_factor: 1.0,
        };
        let monitors = vec![primary];

        let minimized = clamp_sticky_bounds_for_monitors(
            StickyWindowBounds {
                x: -32000,
                y: -32000,
                width: 320,
                height: 340,
            },
            &monitors,
            Some(primary),
        );
        assert!(minimized.x >= 0 && minimized.y >= 0);
        assert_eq!(minimized.width, DEFAULT_STICKY_WIDTH);

        let offscreen = clamp_sticky_bounds_for_monitors(
            StickyWindowBounds {
                x: 3100,
                y: 220,
                width: 320,
                height: 340,
            },
            &monitors,
            Some(primary),
        );
        assert!(offscreen.x + offscreen.width as i32 <= 1920);
        assert!(offscreen.x >= 0);

        let hidpi = WorkAreaMonitor {
            bounds: ShellBounds {
                x: 0,
                y: 0,
                width: 3840,
                height: 2080,
            },
            scale_factor: 2.0,
        };
        let scaled_default = default_sticky_bounds_for_monitor(hidpi, 0);
        assert_eq!(scaled_default.width, DEFAULT_STICKY_WIDTH * 2);
        assert_eq!(scaled_default.height, DEFAULT_STICKY_HEIGHT * 2);
    }

    #[test]
    fn reconcile_prunes_missing_quick_notes() {
        let mut stickies = vec![
            StickyNoteRecord {
                note_id: "note-a".to_string(),
                bounds: StickyWindowBounds {
                    x: 100,
                    y: 100,
                    width: 320,
                    height: 340,
                },
                always_on_top: false,
                color: "amber".to_string(),
                updated_at: "1".to_string(),
            },
            StickyNoteRecord {
                note_id: "note-deleted".to_string(),
                bounds: StickyWindowBounds {
                    x: 140,
                    y: 140,
                    width: 320,
                    height: 340,
                },
                always_on_top: true,
                color: "sky".to_string(),
                updated_at: "2".to_string(),
            },
        ];
        let existing = HashSet::from(["note-a".to_string()]);
        assert!(reconcile_stickies_with_notes(&mut stickies, &existing));
        assert_eq!(stickies.len(), 1);
        assert_eq!(stickies[0].note_id, "note-a");
    }

    #[test]
    fn corrupt_sticky_notes_file_is_backed_up_and_recovered() {
        let dir = test_temp_dir("corrupt");
        let path = dir.join("sticky-notes.json");
        fs::write(&path, "{bad json").unwrap();
        let primary = WorkAreaMonitor {
            bounds: ShellBounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1040,
            },
            scale_factor: 1.0,
        };
        let (stickies, needs_rewrite) =
            read_sticky_notes_from_path(&path, &[primary], Some(primary)).unwrap();
        assert!(stickies.is_empty());
        assert!(needs_rewrite);
        assert!(!path.exists());
        let has_backup = fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains("corrupt"));
        assert!(has_backup);
        let _ = fs::remove_dir_all(&dir);
    }
}
