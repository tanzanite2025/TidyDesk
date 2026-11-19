use super::repair::shortcuts_validate_all_internal;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Condvar, Mutex,
};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const TARGET_FILE_DELETED_EVENT: &str = "target-file-deleted";
const TARGET_FILE_RESTORED_EVENT: &str = "target-file-restored";
const SHORTCUTS_VALIDATED_EVENT: &str = "shortcuts-validated";
const SHORTCUT_WATCH_MIN_INTERVAL: Duration = Duration::from_secs(10);
const SHORTCUT_WATCH_MAX_INTERVAL: Duration = Duration::from_secs(60);
const SHORTCUT_WATCH_EMPTY_INTERVAL: Duration = Duration::from_secs(5 * 60);
const SHORTCUT_WATCH_PAUSED_INTERVAL: Duration = Duration::from_secs(60);
const SHORTCUT_VALIDATION_INTERVAL: Duration = Duration::from_secs(30 * 60);

#[derive(Debug)]
pub struct ShortcutWatcherState {
    enabled: AtomicBool,
    wake_mutex: Mutex<()>,
    wake_signal: Condvar,
}

impl Default for ShortcutWatcherState {
    fn default() -> Self {
        Self {
            enabled: AtomicBool::new(true),
            wake_mutex: Mutex::new(()),
            wake_signal: Condvar::new(),
        }
    }
}

impl ShortcutWatcherState {
    fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Relaxed);
        self.wake_signal.notify_all();
    }
}

#[derive(Debug)]
struct ShortcutWatchSync {
    changed: bool,
    watched_target_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ShortcutWatchEntry {
    shortcut_count: usize,
    exists: bool,
}

#[derive(Debug, Clone)]
struct CachedShortcutMeta {
    len: u64,
    modified_ms: u128,
    target_path: Option<String>,
}

fn collect_shortcut_watch_entries(
    app: &AppHandle,
    target_cache: &mut HashMap<String, CachedShortcutMeta>,
) -> Result<HashMap<String, ShortcutWatchEntry>, String> {
    crate::prepare_drawer_storage(app)?;
    let drawer_root = crate::drawer_root(app)?;
    let mut resolver: Option<crate::ShortcutResolver> = None;
    let mut entries = HashMap::new();
    let mut seen_shortcuts = HashSet::new();

    let drawer_items =
        fs::read_dir(&drawer_root).map_err(|err| format!("failed to read drawer root: {err}"))?;

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

            let shortcut_key = shortcut_path.display().to_string();
            seen_shortcuts.insert(shortcut_key.clone());

            let meta_fingerprint = entry.metadata().ok().map(|meta| {
                let modified_ms = meta
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|duration| duration.as_millis())
                    .unwrap_or_default();
                (meta.len(), modified_ms)
            });

            let cached_target = meta_fingerprint.and_then(|(len, modified_ms)| {
                target_cache.get(&shortcut_key).and_then(|cached| {
                    if cached.len == len && cached.modified_ms == modified_ms {
                        Some(cached.target_path.clone())
                    } else {
                        None
                    }
                })
            });

            let target_path = if let Some(hit) = cached_target {
                hit
            } else {
                if resolver.is_none() {
                    resolver = crate::ShortcutResolver::new().ok();
                }
                let resolved = resolver
                    .as_ref()
                    .and_then(|active| active.resolve_target(&shortcut_key).ok())
                    .flatten()
                    .filter(|value| !value.is_empty());
                if let Some((len, modified_ms)) = meta_fingerprint {
                    target_cache.insert(
                        shortcut_key,
                        CachedShortcutMeta {
                            len,
                            modified_ms,
                            target_path: resolved.clone(),
                        },
                    );
                }
                resolved
            };

            let Some(target_path) = target_path else {
                continue;
            };

            let target_exists = Path::new(&target_path).exists();
            let watched = entries.entry(target_path).or_insert(ShortcutWatchEntry {
                shortcut_count: 0,
                exists: target_exists,
            });
            watched.shortcut_count += 1;
            watched.exists = watched.exists || target_exists;
        }
    }

    target_cache.retain(|path, _| seen_shortcuts.contains(path));
    Ok(entries)
}

fn sync_shortcut_watch_events(
    app: &AppHandle,
    previous: &mut HashMap<String, ShortcutWatchEntry>,
    target_cache: &mut HashMap<String, CachedShortcutMeta>,
) -> Result<ShortcutWatchSync, String> {
    let current = collect_shortcut_watch_entries(app, target_cache)?;
    let changed = *previous != current;
    let watched_target_count = current.len();

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
    Ok(ShortcutWatchSync {
        changed,
        watched_target_count,
    })
}

pub fn set_shortcut_background_monitoring(app: &AppHandle, enabled: bool) {
    app.state::<ShortcutWatcherState>().set_enabled(enabled);
}

fn next_shortcut_watch_interval(
    current: Duration,
    changed: bool,
    watched_target_count: usize,
) -> Duration {
    if watched_target_count == 0 {
        SHORTCUT_WATCH_EMPTY_INTERVAL
    } else if changed {
        SHORTCUT_WATCH_MIN_INTERVAL
    } else {
        (current * 2).min(SHORTCUT_WATCH_MAX_INTERVAL)
    }
}

fn wait_for_next_cycle(watcher_state: &ShortcutWatcherState, duration: Duration) {
    let Ok(guard) = watcher_state.wake_mutex.lock() else {
        std::thread::sleep(duration);
        return;
    };
    let _ = watcher_state.wake_signal.wait_timeout(guard, duration);
}

pub fn start_shortcut_background_services(app: AppHandle) {
    std::thread::spawn(move || {
        let watcher_state = app.state::<ShortcutWatcherState>();
        let mut target_cache: HashMap<String, CachedShortcutMeta> = HashMap::new();
        let mut previous = match collect_shortcut_watch_entries(&app, &mut target_cache) {
            Ok(entries) => entries,
            Err(err) => {
                eprintln!("[TIDYDESK] Failed to initialize shortcut watcher state: {err}");
                HashMap::new()
            }
        };
        let mut last_validation = Instant::now();
        let mut watch_interval = SHORTCUT_WATCH_MIN_INTERVAL;
        let mut was_enabled = watcher_state.is_enabled();

        loop {
            if !watcher_state.is_enabled() {
                previous.clear();
                target_cache.clear();
                was_enabled = false;
                wait_for_next_cycle(&watcher_state, SHORTCUT_WATCH_PAUSED_INTERVAL);
                continue;
            }

            if !was_enabled {
                previous = match collect_shortcut_watch_entries(&app, &mut target_cache) {
                    Ok(entries) => entries,
                    Err(err) => {
                        eprintln!("[TIDYDESK] Failed to resume shortcut watcher state: {err}");
                        HashMap::new()
                    }
                };
                last_validation = Instant::now();
                watch_interval = SHORTCUT_WATCH_MIN_INTERVAL;
                was_enabled = true;
            }

            match sync_shortcut_watch_events(&app, &mut previous, &mut target_cache) {
                Ok(sync) => {
                    watch_interval = next_shortcut_watch_interval(
                        watch_interval,
                        sync.changed,
                        sync.watched_target_count,
                    );

                    if sync.watched_target_count > 0
                        && last_validation.elapsed() >= SHORTCUT_VALIDATION_INTERVAL
                    {
                        match shortcuts_validate_all_internal(&app) {
                            Ok(stats) => {
                                if stats.repaired > 0 || stats.invalid > 0 {
                                    if let Err(err) = app.emit(SHORTCUTS_VALIDATED_EVENT, stats) {
                                        eprintln!(
                                            "[TIDYDESK] Failed to emit shortcut validation stats: {err}"
                                        );
                                    }
                                }
                            }
                            Err(err) => {
                                eprintln!("[TIDYDESK] Periodic shortcut validation failed: {err}");
                            }
                        }
                        last_validation = Instant::now();
                    }
                }
                Err(err) => {
                    eprintln!("[TIDYDESK] Shortcut watcher sync failed: {err}");
                    watch_interval = SHORTCUT_WATCH_MIN_INTERVAL;
                }
            }

            wait_for_next_cycle(&watcher_state, watch_interval);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_shortcut_watch_uses_idle_interval() {
        assert_eq!(
            next_shortcut_watch_interval(SHORTCUT_WATCH_MIN_INTERVAL, false, 0),
            SHORTCUT_WATCH_EMPTY_INTERVAL
        );
    }

    #[test]
    fn active_shortcut_watch_backs_off_until_max_interval() {
        assert_eq!(
            next_shortcut_watch_interval(SHORTCUT_WATCH_MIN_INTERVAL, false, 1),
            Duration::from_secs(20)
        );
        assert_eq!(
            next_shortcut_watch_interval(SHORTCUT_WATCH_MAX_INTERVAL, false, 1),
            SHORTCUT_WATCH_MAX_INTERVAL
        );
    }

    #[test]
    fn changed_shortcut_watch_resets_to_min_interval() {
        assert_eq!(
            next_shortcut_watch_interval(SHORTCUT_WATCH_MAX_INTERVAL, true, 1),
            SHORTCUT_WATCH_MIN_INTERVAL
        );
    }
}
