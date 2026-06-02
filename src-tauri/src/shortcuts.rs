use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const TARGET_FILE_DELETED_EVENT: &str = "target-file-deleted";
const TARGET_FILE_RESTORED_EVENT: &str = "target-file-restored";
const SHORTCUTS_VALIDATED_EVENT: &str = "shortcuts-validated";
const SHORTCUT_WATCH_POLL_INTERVAL: Duration = Duration::from_secs(10);
const SHORTCUT_VALIDATION_INTERVAL: Duration = Duration::from_secs(30 * 60);

#[derive(Debug)]
struct ShortcutValidationResult {
    is_valid: bool,
    target_path: Option<String>,
}

#[derive(Debug, Clone)]
struct ShortcutWatchEntry {
    shortcut_count: usize,
    exists: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairShortcutPayload {
    shortcut_path: String,
    target_path: String,
}

#[derive(Debug, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutValidationStats {
    total: usize,
    valid: usize,
    invalid: usize,
    repaired: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairShortcutResult {
    repaired: bool,
    new_path: Option<String>,
}

fn validate_shortcut(shortcut_path: &Path) -> ShortcutValidationResult {
    let target_path = crate::resolve_shortcut_target(&shortcut_path.display().to_string())
        .ok()
        .flatten()
        .filter(|value| !value.is_empty());

    match target_path {
        Some(target_path) => ShortcutValidationResult {
            is_valid: Path::new(&target_path).exists(),
            target_path: Some(target_path),
        },
        None => ShortcutValidationResult {
            is_valid: false,
            target_path: None,
        },
    }
}

fn attempt_shortcut_repair(
    shortcut_path: &Path,
    target_path: &str,
) -> Result<RepairShortcutResult, String> {
    if target_path.trim().is_empty() {
        return Ok(RepairShortcutResult {
            repaired: false,
            new_path: None,
        });
    }

    let Some(file_name) = Path::new(target_path).file_name() else {
        return Ok(RepairShortcutResult {
            repaired: false,
            new_path: None,
        });
    };

    for search_path in shortcut_repair_search_paths() {
        let possible_path = search_path.join(file_name);
        if !possible_path.exists() {
            continue;
        }

        let description = format!(
            "TidyDesk shortcut for {} (auto-repaired)",
            possible_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("file")
        );

        match crate::write_shortcut_link(shortcut_path, &possible_path, &description) {
            Ok(()) => {
                return Ok(RepairShortcutResult {
                    repaired: true,
                    new_path: Some(possible_path.display().to_string()),
                });
            }
            Err(err) => {
                eprintln!(
                    "[TIDYDESK] Failed to repair shortcut {} with {}: {}",
                    shortcut_path.display(),
                    possible_path.display(),
                    err
                );
            }
        }
    }

    Ok(RepairShortcutResult {
        repaired: false,
        new_path: None,
    })
}

fn shortcut_repair_search_paths() -> Vec<PathBuf> {
    let Ok(profile) = std::env::var("USERPROFILE") else {
        return Vec::new();
    };
    let mut paths = Vec::new();
    paths.push(PathBuf::from(format!("{profile}\\Desktop")));
    paths.push(PathBuf::from(format!("{profile}\\Documents")));
    paths.push(PathBuf::from(format!("{profile}\\Downloads")));
    paths.push(PathBuf::from(format!("{profile}\\Pictures")));
    paths.push(PathBuf::from(format!("{profile}\\Videos")));
    if let Ok(programs) = std::env::var("ProgramFiles") {
        paths.push(PathBuf::from(programs));
    }
    if let Ok(programs) = std::env::var("ProgramFiles(x86)") {
        paths.push(PathBuf::from(programs));
    }
    paths
}

#[tauri::command]
pub fn shortcuts_validate_all(app: AppHandle) -> Result<ShortcutValidationStats, String> {
    shortcuts_validate_all_internal(&app)
}

fn shortcuts_validate_all_internal(app: &AppHandle) -> Result<ShortcutValidationStats, String> {
    crate::prepare_drawer_storage(&app)?;
    let drawer_root = crate::drawer_root(&app)?;
    let mut stats = ShortcutValidationStats::default();

    let drawer_items = fs::read_dir(&drawer_root)
        .map_err(|err| format!("failed to read drawer root: {err}"))?;

    for drawer_item in drawer_items {
        let Ok(drawer_item) = drawer_item else {
            continue;
        };
        let Ok(file_type) = drawer_item.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }

        let drawer_path = drawer_item.path();
        let Ok(entries) = fs::read_dir(&drawer_path) else {
            continue;
        };

        for entry in entries {
            let Ok(entry) = entry else {
                continue;
            };
            let Ok(entry_type) = entry.file_type() else {
                continue;
            };
            if !entry_type.is_file() {
                continue;
            }

            let shortcut_path = entry.path();
            if shortcut_path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case("lnk"))
                != Some(true)
            {
                continue;
            }

            stats.total += 1;
            let validation = validate_shortcut(&shortcut_path);
            if validation.is_valid {
                stats.valid += 1;
                continue;
            }

            if let Some(target_path) = validation.target_path {
                let repair = attempt_shortcut_repair(&shortcut_path, &target_path)?;
                if repair.repaired {
                    stats.repaired += 1;
                    stats.valid += 1;
                } else {
                    stats.invalid += 1;
                }
            } else {
                stats.invalid += 1;
            }
        }
    }

    Ok(stats)
}

#[tauri::command]
pub fn shortcuts_repair(
    app: AppHandle,
    payload: RepairShortcutPayload,
) -> Result<RepairShortcutResult, String> {
    crate::prepare_drawer_storage(&app)?;
    if payload.shortcut_path.trim().is_empty() || payload.target_path.trim().is_empty() {
        return Err("Missing shortcutPath or targetPath".to_string());
    }

    let shortcut_path = PathBuf::from(&payload.shortcut_path);
    let drawer_root = crate::drawer_root(&app)?;
    if !crate::is_path_inside(&shortcut_path, &drawer_root) {
        return Err("Only drawer shortcuts can be repaired".to_string());
    }
    if !shortcut_path.exists() {
        return Err("Shortcut does not exist".to_string());
    }
    if shortcut_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("lnk"))
        != Some(true)
    {
        return Err("Only .lnk shortcuts can be repaired".to_string());
    }

    attempt_shortcut_repair(&shortcut_path, &payload.target_path)
}

fn collect_shortcut_watch_entries(app: &AppHandle) -> Result<HashMap<String, ShortcutWatchEntry>, String> {
    crate::prepare_drawer_storage(app)?;
    let drawer_root = crate::drawer_root(app)?;
    let mut entries = HashMap::new();

    let drawer_items = fs::read_dir(&drawer_root)
        .map_err(|err| format!("failed to read drawer root: {err}"))?;

    for drawer_item in drawer_items {
        let Ok(drawer_item) = drawer_item else {
            continue;
        };
        let Ok(file_type) = drawer_item.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }

        let Ok(entries_in_drawer) = fs::read_dir(drawer_item.path()) else {
            continue;
        };

        for entry in entries_in_drawer {
            let Ok(entry) = entry else {
                continue;
            };
            let Ok(entry_type) = entry.file_type() else {
                continue;
            };
            if !entry_type.is_file() {
                continue;
            }

            let shortcut_path = entry.path();
            if shortcut_path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case("lnk"))
                != Some(true)
            {
                continue;
            }

            let validation = validate_shortcut(&shortcut_path);
            let Some(target_path) = validation.target_path else {
                continue;
            };

            let watched = entries.entry(target_path).or_insert(ShortcutWatchEntry {
                shortcut_count: 0,
                exists: validation.is_valid,
            });
            watched.shortcut_count += 1;
            watched.exists = watched.exists || validation.is_valid;
        }
    }

    Ok(entries)
}

fn sync_shortcut_watch_events(
    app: &AppHandle,
    previous: &mut HashMap<String, ShortcutWatchEntry>,
) -> Result<(), String> {
    let current = collect_shortcut_watch_entries(app)?;

    for (target_path, snapshot) in &current {
        if let Some(prev) = previous.get(target_path) {
            if prev.exists && !snapshot.exists {
                app.emit(
                    TARGET_FILE_DELETED_EVENT,
                    json!({
                        "targetPath": target_path,
                        "shortcutCount": snapshot.shortcut_count,
                    }),
                )
                .map_err(|err| err.to_string())?;
            } else if !prev.exists && snapshot.exists {
                app.emit(
                    TARGET_FILE_RESTORED_EVENT,
                    json!({
                        "targetPath": target_path,
                        "shortcutCount": snapshot.shortcut_count,
                    }),
                )
                .map_err(|err| err.to_string())?;
            }
        }
    }

    *previous = current;
    Ok(())
}

pub fn start_shortcut_background_services(app: AppHandle) {
    std::thread::spawn(move || {
        let mut previous = match collect_shortcut_watch_entries(&app) {
            Ok(entries) => entries,
            Err(err) => {
                eprintln!("[TIDYDESK] Failed to initialize shortcut watcher state: {err}");
                HashMap::new()
            }
        };
        let mut last_validation = Instant::now();

        loop {
            if let Err(err) = sync_shortcut_watch_events(&app, &mut previous) {
                eprintln!("[TIDYDESK] Shortcut watcher sync failed: {err}");
            }

            if last_validation.elapsed() >= SHORTCUT_VALIDATION_INTERVAL {
                match shortcuts_validate_all_internal(&app) {
                    Ok(stats) => {
                        if stats.repaired > 0 || stats.invalid > 0 {
                            if let Err(err) = app.emit(SHORTCUTS_VALIDATED_EVENT, stats) {
                                eprintln!("[TIDYDESK] Failed to emit shortcut validation stats: {err}");
                            }
                        }
                    }
                    Err(err) => {
                        eprintln!("[TIDYDESK] Periodic shortcut validation failed: {err}");
                    }
                }
                last_validation = Instant::now();
            }

            std::thread::sleep(SHORTCUT_WATCH_POLL_INTERVAL);
        }
    });
}
