use super::model::{
    normalize_sticky_color, RawStickyNoteRecord, StickyNoteRecord, StickyNotesState,
    StickyWindowBounds, StoredStickyNotesFile, DEFAULT_STICKY_HEIGHT, DEFAULT_STICKY_WIDTH,
    MIN_STICKY_HEIGHT, MIN_STICKY_WIDTH, STICKY_NOTES_VERSION,
};
use crate::shell::{
    available_work_areas, clamp_physical_bounds_to_monitors, default_cascade_bounds_for_monitor,
    scaled_px, ShellBounds, WorkAreaMonitor,
};
use rusqlite::Connection;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
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

pub(crate) fn migrate_sticky_notes_json_if_needed(
    conn: &mut Connection,
    legacy_path: &Path,
    monitors: &[WorkAreaMonitor],
    primary: Option<WorkAreaMonitor>,
) -> Result<(), String> {
    if crate::local_db::get_meta_flag(conn, "migrated_sticky_notes")?.is_some() {
        return Ok(());
    }
    if !legacy_path.is_file() {
        crate::local_db::set_meta_flag(conn, "migrated_sticky_notes", "none")?;
        return Ok(());
    }

    let (stickies, _) = read_sticky_notes_from_path(&legacy_path.to_path_buf(), monitors, primary)?;
    {
        let tx = conn
            .transaction()
            .map_err(|err| format!("开启 sticky_notes 迁移事务失败: {err}"))?;
        let existing: i64 = tx
            .query_row("SELECT COUNT(*) FROM sticky_notes", [], |r| r.get(0))
            .map_err(|err| format!("统计 sticky_notes 行数失败: {err}"))?;
        if existing == 0 {
            for (idx, item) in stickies.iter().enumerate() {
                tx.execute(
                    "INSERT OR REPLACE INTO sticky_notes
                     (note_id, x, y, width, height, always_on_top, color, updated_at, sort_order)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    rusqlite::params![
                        item.note_id,
                        item.bounds.x,
                        item.bounds.y,
                        i64::from(item.bounds.width),
                        i64::from(item.bounds.height),
                        if item.always_on_top { 1 } else { 0 },
                        item.color,
                        item.updated_at,
                        i64::try_from(idx).unwrap_or(i64::MAX)
                    ],
                )
                .map_err(|err| format!("迁移写入 sticky_notes 失败: {err}"))?;
            }
        }
        tx.execute(
            "INSERT OR REPLACE INTO db_meta (key, value) VALUES ('migrated_sticky_notes', ?1)",
            [crate::timestamp_string()],
        )
        .map_err(|err| format!("写入 migrated_sticky_notes 标记失败: {err}"))?;
        tx.commit()
            .map_err(|err| format!("提交 sticky_notes 迁移事务失败: {err}"))?;
    }

    crate::local_db::archive_legacy_file_once(legacy_path)?;
    Ok(())
}

fn read_sticky_notes_from_conn(
    conn: &Connection,
    monitors: &[WorkAreaMonitor],
    primary: Option<WorkAreaMonitor>,
) -> Result<(Vec<StickyNoteRecord>, bool), String> {
    let mut stmt = conn
        .prepare(
            "SELECT note_id, x, y, width, height, always_on_top, color, updated_at
             FROM sticky_notes
             ORDER BY sort_order ASC",
        )
        .map_err(|err| format!("查询 sticky_notes 失败: {err}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(RawStickyNoteRecord {
                note_id: Some(row.get::<_, String>(0)?),
                bounds: Some(StickyWindowBounds {
                    x: row.get::<_, i32>(1)?,
                    y: row.get::<_, i32>(2)?,
                    width: u32::try_from(row.get::<_, i64>(3)?.max(1))
                        .unwrap_or(DEFAULT_STICKY_WIDTH),
                    height: u32::try_from(row.get::<_, i64>(4)?.max(1))
                        .unwrap_or(DEFAULT_STICKY_HEIGHT),
                }),
                always_on_top: Some(row.get::<_, i64>(5)? != 0),
                color: Some(row.get::<_, String>(6)?),
                updated_at: Some(row.get::<_, String>(7)?),
            })
        })
        .map_err(|err| format!("读取 sticky_notes 行失败: {err}"))?;

    let mut raw_records = Vec::new();
    for r in rows {
        raw_records.push(r.map_err(|err| format!("解析 sticky_notes 行失败: {err}"))?);
    }
    let raw_count = raw_records.len();
    let mut seen_ids = HashSet::new();
    let mut stickies = Vec::with_capacity(raw_count);
    let mut bounds_adjusted = false;

    for raw in raw_records {
        let orig_bounds = raw.bounds;
        if let Some(norm) = normalize_sticky_record(raw, monitors, primary, &mut seen_ids) {
            if let Some(ob) = orig_bounds {
                if ob.x != norm.bounds.x
                    || ob.y != norm.bounds.y
                    || ob.width != norm.bounds.width
                    || ob.height != norm.bounds.height
                {
                    bounds_adjusted = true;
                }
            }
            stickies.push(norm);
        } else {
            bounds_adjusted = true;
        }
    }
    let needs_rewrite = bounds_adjusted || stickies.len() != raw_count;
    Ok((stickies, needs_rewrite))
}

fn write_sticky_notes_in_conn(
    conn: &mut Connection,
    stickies: &[StickyNoteRecord],
) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|err| format!("开启 sticky_notes 写入事务失败: {err}"))?;
    tx.execute("DELETE FROM sticky_notes", [])
        .map_err(|err| format!("清理 sticky_notes 表失败: {err}"))?;
    for (idx, item) in stickies.iter().enumerate() {
        tx.execute(
            "INSERT INTO sticky_notes
             (note_id, x, y, width, height, always_on_top, color, updated_at, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                item.note_id,
                item.bounds.x,
                item.bounds.y,
                i64::from(item.bounds.width),
                i64::from(item.bounds.height),
                if item.always_on_top { 1 } else { 0 },
                item.color,
                item.updated_at,
                i64::try_from(idx).unwrap_or(i64::MAX)
            ],
        )
        .map_err(|err| format!("写入 sticky_notes 行失败: {err}"))?;
    }
    tx.commit()
        .map_err(|err| format!("提交 sticky_notes 事务失败: {err}"))?;
    Ok(())
}

pub fn write_sticky_notes_unlocked(
    app: &AppHandle,
    stickies: &[StickyNoteRecord],
) -> Result<(), String> {
    let db_path = crate::local_db::workspace_db_path(app)?;
    let legacy_path = sticky_notes_path(app)?;
    let (monitors, primary) = available_work_areas(app);
    let mut conn = crate::local_db::open_workspace_db_at(&db_path)?;
    migrate_sticky_notes_json_if_needed(&mut conn, &legacy_path, &monitors, primary)?;
    write_sticky_notes_in_conn(&mut conn, stickies)
}

pub fn read_sticky_notes_unlocked(app: &AppHandle) -> Result<Vec<StickyNoteRecord>, String> {
    let db_path = crate::local_db::workspace_db_path(app)?;
    let legacy_path = sticky_notes_path(app)?;
    let (monitors, primary) = available_work_areas(app);
    let mut conn = crate::local_db::open_workspace_db_at(&db_path)?;
    migrate_sticky_notes_json_if_needed(&mut conn, &legacy_path, &monitors, primary)?;
    let (stickies, needs_rewrite) = read_sticky_notes_from_conn(&conn, &monitors, primary)?;
    if needs_rewrite {
        write_sticky_notes_in_conn(&mut conn, &stickies)?;
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

    #[test]
    fn sticky_notes_sqlite_migrates_legacy_json_and_clamps_bounds() {
        let dir = test_temp_dir("sqlite-mig");
        let legacy_path = dir.join("sticky-notes.json");
        fs::write(
            &legacy_path,
            r#"{"version":1,"stickies":[{"noteId":"s1","bounds":{"x":-32000,"y":100,"width":320,"height":340},"alwaysOnTop":true,"color":"sky","updatedAt":"50"}]}"#,
        )
        .unwrap();

        let primary = WorkAreaMonitor {
            bounds: ShellBounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1040,
            },
            scale_factor: 1.0,
        };
        let db_path = dir.join("tidydesk-local.db");
        let mut conn = crate::local_db::open_workspace_db_at(&db_path).unwrap();
        migrate_sticky_notes_json_if_needed(&mut conn, &legacy_path, &[primary], Some(primary))
            .unwrap();
        assert!(!legacy_path.exists());
        assert!(dir.join("sticky-notes.json.pre-sqlite.bak").is_file());

        let (stickies, needs_rewrite) =
            read_sticky_notes_from_conn(&conn, &[primary], Some(primary)).unwrap();
        assert!(!needs_rewrite);
        assert_eq!(stickies.len(), 1);
        assert_eq!(stickies[0].note_id, "s1");
        assert!(stickies[0].bounds.x >= 0);
        assert!(stickies[0].always_on_top);
        assert_eq!(stickies[0].color, "sky");

        drop(conn);
        let _ = fs::remove_dir_all(&dir);
    }
}
