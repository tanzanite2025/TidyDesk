use super::model::{
    normalize_sticky_color, reconcile_stickies_with_notes, sticky_window_label, StickyNoteRecord,
    StickyNotesState, StickyWindowBounds, UpdateStickyNoteOptionsPayload, MAX_RESTORE_STICKY_NOTES,
    MIN_STICKY_HEIGHT, MIN_STICKY_WIDTH, STICKY_NOTES_UPDATED_EVENT, STICKY_WINDOW_LABEL_PREFIX,
};
use super::store::{
    clamp_sticky_bounds_for_monitors, default_sticky_bounds_for_monitor,
    read_sticky_notes_unlocked, sticky_notes_state, with_sticky_notes_store_lock,
    write_sticky_notes_unlocked,
};
use crate::shell::{
    available_work_areas, is_valid_runtime_window_bounds, webview_url_for_mode, ShellBounds,
    WorkAreaMonitor,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use url::form_urlencoded;

const BOUNDS_PERSIST_DEBOUNCE_MS: u64 = 350;
const STARTUP_RESTORE_DELAY_MS: u64 = 400;
const STARTUP_RESTORE_STEP_MS: u64 = 60;

static APP_EXITING: AtomicBool = AtomicBool::new(false);

pub fn mark_app_exiting(app: &AppHandle) {
    if APP_EXITING.swap(true, Ordering::SeqCst) {
        return;
    }
    let snapshot = {
        let runtime = app.state::<StickyRuntimeState>();
        runtime
            .0
            .lock()
            .map(|guard| guard.pending_bounds.clone())
            .unwrap_or_default()
    };
    if snapshot.is_empty() {
        return;
    }
    let (monitors, primary) = available_work_areas(app);
    let _ = with_sticky_notes_store_lock(app, || {
        let mut stickies = read_sticky_notes_unlocked(app)?;
        let mut changed = false;
        for record in &mut stickies {
            if let Some(pending) = snapshot.get(&record.note_id) {
                let safe = clamp_sticky_bounds_for_monitors(*pending, &monitors, primary);
                if record.bounds != safe {
                    record.bounds = safe;
                    record.updated_at = crate::timestamp_string();
                    changed = true;
                }
            }
        }
        if changed {
            write_sticky_notes_unlocked(app, &stickies)?;
        }
        Ok(())
    });
}

#[derive(Default)]
struct StickyRuntimeInner {
    next_instance_id: u64,
    active_instances: HashMap<String, u64>,
    debounce_generations: HashMap<String, u64>,
    pending_bounds: HashMap<String, StickyWindowBounds>,
}

#[derive(Default)]
pub struct StickyRuntimeState(Mutex<StickyRuntimeInner>);

fn emit_sticky_notes_updated(app: &AppHandle, state: &StickyNotesState) {
    let _ = app.emit(STICKY_NOTES_UPDATED_EVENT, state);
}

fn sticky_webview_url(note_id: &str) -> Result<tauri::WebviewUrl, String> {
    let encoded: String = form_urlencoded::byte_serialize(note_id.as_bytes()).collect();
    webview_url_for_mode(&format!("sticky&noteId={encoded}"))
}

fn flush_bounds_if_current(
    app: &AppHandle,
    note_id: &str,
    expected_generation: u64,
) -> Result<(), String> {
    let maybe_bounds = {
        let runtime = app.state::<StickyRuntimeState>();
        let guard = runtime
            .0
            .lock()
            .map_err(|_| "failed to lock sticky runtime state".to_string())?;
        if guard.debounce_generations.get(note_id).copied() != Some(expected_generation) {
            return Ok(());
        }
        guard.pending_bounds.get(note_id).copied()
    };

    let Some(bounds) = maybe_bounds else {
        return Ok(());
    };

    let (monitors, primary) = available_work_areas(app);
    let safe_bounds = clamp_sticky_bounds_for_monitors(bounds, &monitors, primary);

    with_sticky_notes_store_lock(app, || {
        let mut stickies = read_sticky_notes_unlocked(app)?;
        let Some(existing) = stickies.iter_mut().find(|item| item.note_id == note_id) else {
            return Ok(());
        };
        if existing.bounds != safe_bounds {
            existing.bounds = safe_bounds;
            existing.updated_at = crate::timestamp_string();
            write_sticky_notes_unlocked(app, &stickies)?;
        }
        Ok(())
    })
}

fn schedule_bounds_persist(app: &AppHandle, note_id: &str, bounds: StickyWindowBounds) {
    let generation = {
        let runtime = app.state::<StickyRuntimeState>();
        let Ok(mut guard) = runtime.0.lock() else {
            return;
        };
        let next_gen = guard
            .debounce_generations
            .get(note_id)
            .copied()
            .unwrap_or(0)
            .saturating_add(1);
        guard
            .debounce_generations
            .insert(note_id.to_string(), next_gen);
        guard.pending_bounds.insert(note_id.to_string(), bounds);
        next_gen
    };

    let app_clone = app.clone();
    let note_id_owned = note_id.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(BOUNDS_PERSIST_DEBOUNCE_MS));
        let _ = flush_bounds_if_current(&app_clone, &note_id_owned, generation);
    });
}

fn clear_runtime_tracking_for_note(app: &AppHandle, note_id: &str, expected_instance: Option<u64>) {
    let runtime = app.state::<StickyRuntimeState>();
    if let Ok(mut guard) = runtime.0.lock() {
        if let Some(instance_id) = expected_instance {
            if guard.active_instances.get(note_id).copied() != Some(instance_id) {
                return;
            }
        }
        guard.active_instances.remove(note_id);
        guard.debounce_generations.remove(note_id);
        guard.pending_bounds.remove(note_id);
    };
}

fn unpin_sticky_note_sync(app: &AppHandle, note_id: &str) -> Result<StickyNotesState, String> {
    let trimmed_id = note_id.trim();
    let next_state = with_sticky_notes_store_lock(app, || {
        let mut stickies = read_sticky_notes_unlocked(app)?;
        stickies.retain(|record| record.note_id != trimmed_id);
        write_sticky_notes_unlocked(app, &stickies)?;
        Ok(StickyNotesState { stickies })
    })?;

    destroy_sticky_window(app, trimmed_id);
    emit_sticky_notes_updated(app, &next_state);
    Ok(next_state)
}

fn register_sticky_window_lifecycle(
    window: &WebviewWindow,
    app: AppHandle,
    note_id: String,
    instance_id: u64,
) {
    let window_clone = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            let Ok(pos) = window_clone.outer_position() else {
                return;
            };
            let Ok(size) = window_clone.outer_size() else {
                return;
            };
            if !is_valid_runtime_window_bounds(pos.x, pos.y, size.width, size.height) {
                return;
            }
            schedule_bounds_persist(
                &app,
                &note_id,
                StickyWindowBounds {
                    x: pos.x,
                    y: pos.y,
                    width: size.width,
                    height: size.height,
                },
            );
        }
        WindowEvent::Destroyed => {
            // 仅清理内存实例追踪状态，不在此处移除 sticky-notes.json，
            // 确保进程退出或 Windows 重启/关机发送 WM_CLOSE 时持久化清单零丢失。
            clear_runtime_tracking_for_note(&app, &note_id, Some(instance_id));
        }
        _ => {}
    });
}

fn bring_sticky_window_to_front(window: &WebviewWindow, always_on_top: bool) -> Result<(), String> {
    if window.is_minimized().unwrap_or(false) {
        window.unminimize().map_err(|err| err.to_string())?;
    }
    window.show().map_err(|err| err.to_string())?;
    window
        .set_always_on_top(true)
        .map_err(|err| err.to_string())?;
    let focus_res = window.set_focus();
    if !always_on_top {
        let _ = window.set_always_on_top(false);
    }
    focus_res.map_err(|err| err.to_string())
}

fn ensure_sticky_window(
    app: &AppHandle,
    record: &StickyNoteRecord,
    note_title: &str,
    focus: bool,
) -> Result<(), String> {
    let label = sticky_window_label(&record.note_id);
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.set_always_on_top(record.always_on_top);
        if focus {
            bring_sticky_window_to_front(&existing, record.always_on_top)?;
        } else {
            existing.show().map_err(|err| err.to_string())?;
        }
        return Ok(());
    }

    let (monitors, primary) = available_work_areas(app);
    let bounds = clamp_sticky_bounds_for_monitors(record.bounds, &monitors, primary);

    let title_preview: String = note_title.chars().take(24).collect();
    let window = WebviewWindowBuilder::new(app, &label, sticky_webview_url(&record.note_id)?)
        .title(format!("便签 - {title_preview}"))
        .decorations(false)
        .transparent(true)
        .resizable(true)
        .skip_taskbar(true)
        .always_on_top(record.always_on_top)
        .min_inner_size(MIN_STICKY_WIDTH as f64, MIN_STICKY_HEIGHT as f64)
        .visible(false)
        .build()
        .map_err(|err| format!("failed to build sticky note window: {err}"))?;

    window
        .set_size(PhysicalSize::new(bounds.width, bounds.height))
        .map_err(|err| err.to_string())?;
    window
        .set_position(PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|err| err.to_string())?;

    let instance_id = {
        let runtime = app.state::<StickyRuntimeState>();
        let mut guard = runtime
            .0
            .lock()
            .map_err(|_| "failed to lock sticky runtime state".to_string())?;
        guard.next_instance_id = guard.next_instance_id.saturating_add(1);
        let id = guard.next_instance_id;
        guard.active_instances.insert(record.note_id.clone(), id);
        guard.pending_bounds.insert(record.note_id.clone(), bounds);
        id
    };
    register_sticky_window_lifecycle(&window, app.clone(), record.note_id.clone(), instance_id);

    if focus {
        bring_sticky_window_to_front(&window, record.always_on_top)?;
    } else {
        window.show().map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn destroy_sticky_window(app: &AppHandle, note_id: &str) {
    clear_runtime_tracking_for_note(app, note_id, None);
    let label = sticky_window_label(note_id);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.hide();
        let _ = window.destroy().or_else(|_| window.close());
    }
}

pub fn close_all_sticky_windows(app: &AppHandle) {
    let labels = app
        .webview_windows()
        .into_keys()
        .filter(|label| label.starts_with(STICKY_WINDOW_LABEL_PREFIX))
        .collect::<Vec<_>>();
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.hide();
            let _ = window.destroy().or_else(|_| window.close());
        }
    }
    if let Ok(mut guard) = app.state::<StickyRuntimeState>().0.lock() {
        guard.active_instances.clear();
        guard.debounce_generations.clear();
        guard.pending_bounds.clear();
    };
}

pub fn restore_active_account_sticky_notes(app: &AppHandle, stagger: bool) {
    let Ok(note_titles) = crate::quick_notes::existing_quick_note_titles(app) else {
        return;
    };

    let Ok(records) = with_sticky_notes_store_lock(app, || {
        let mut stickies = read_sticky_notes_unlocked(app)?;
        let existing_ids = note_titles.keys().cloned().collect();
        if reconcile_stickies_with_notes(&mut stickies, &existing_ids) {
            write_sticky_notes_unlocked(app, &stickies)?;
        }
        Ok(stickies)
    }) else {
        return;
    };

    emit_sticky_notes_updated(
        app,
        &StickyNotesState {
            stickies: records.clone(),
        },
    );

    for (idx, record) in records
        .into_iter()
        .take(MAX_RESTORE_STICKY_NOTES)
        .enumerate()
    {
        let Some(title) = note_titles.get(&record.note_id) else {
            continue;
        };
        if let Err(err) = ensure_sticky_window(app, &record, title, false) {
            eprintln!(
                "[TIDYDESK] Failed to restore sticky note {}: {err}",
                record.note_id
            );
        }
        if stagger && idx + 1 < MAX_RESTORE_STICKY_NOTES {
            std::thread::sleep(Duration::from_millis(STARTUP_RESTORE_STEP_MS));
        }
    }
}

pub fn schedule_restore_sticky_notes(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(STARTUP_RESTORE_DELAY_MS));
        restore_active_account_sticky_notes(&app, true);
    });
}

pub fn reload_sticky_notes_for_active_account(app: &AppHandle) {
    close_all_sticky_windows(app);
    restore_active_account_sticky_notes(app, false);
}

pub fn handle_quick_notes_deleted(app: &AppHandle, removed_ids: &[String]) {
    if removed_ids.is_empty() {
        return;
    }
    let next_state = with_sticky_notes_store_lock(app, || {
        let mut stickies = read_sticky_notes_unlocked(app)?;
        let before = stickies.len();
        stickies.retain(|record| !removed_ids.contains(&record.note_id));
        if stickies.len() != before {
            write_sticky_notes_unlocked(app, &stickies)?;
        }
        Ok(StickyNotesState { stickies })
    });

    for note_id in removed_ids {
        destroy_sticky_window(app, note_id);
    }

    if let Ok(state) = next_state {
        emit_sticky_notes_updated(app, &state);
    }
}

pub fn open_sticky_note_sync(app: &AppHandle, note_id: &str) -> Result<StickyNotesState, String> {
    let trimmed_id = note_id.trim();
    if trimmed_id.is_empty() {
        return Err("Missing quick note id".to_string());
    }

    let note_titles = crate::quick_notes::existing_quick_note_titles(app)?;
    let Some(note_title) = note_titles.get(trimmed_id).cloned() else {
        return Err("[CRITICAL] Quick note not found for sticky window".to_string());
    };

    let (monitors, primary) = available_work_areas(app);
    let default_mon = primary
        .or_else(|| monitors.first().copied())
        .unwrap_or(WorkAreaMonitor {
            bounds: ShellBounds {
                x: 0,
                y: 0,
                width: 1280,
                height: 800,
            },
            scale_factor: 1.0,
        });

    let (target_record, next_state) = with_sticky_notes_store_lock(app, || {
        let mut stickies = read_sticky_notes_unlocked(app)?;
        if let Some(existing) = stickies.iter_mut().find(|item| item.note_id == trimmed_id) {
            existing.bounds = clamp_sticky_bounds_for_monitors(existing.bounds, &monitors, primary);
            let cloned = existing.clone();
            write_sticky_notes_unlocked(app, &stickies)?;
            return Ok((cloned, StickyNotesState { stickies }));
        }

        let created = StickyNoteRecord {
            note_id: trimmed_id.to_string(),
            bounds: default_sticky_bounds_for_monitor(default_mon, stickies.len()),
            always_on_top: false,
            color: normalize_sticky_color(Some("amber")),
            updated_at: crate::timestamp_string(),
        };
        stickies.push(created.clone());
        write_sticky_notes_unlocked(app, &stickies)?;
        Ok((created, StickyNotesState { stickies }))
    })?;

    ensure_sticky_window(app, &target_record, &note_title, true)?;
    emit_sticky_notes_updated(app, &next_state);
    Ok(next_state)
}

#[tauri::command]
pub async fn sticky_notes_list(app: AppHandle) -> Result<StickyNotesState, String> {
    tauri::async_runtime::spawn_blocking(move || sticky_notes_state(&app))
        .await
        .map_err(|err| format!("sticky notes read task failed: {err}"))?
}

#[tauri::command]
pub async fn sticky_notes_open(
    app: AppHandle,
    note_id: String,
) -> Result<StickyNotesState, String> {
    tauri::async_runtime::spawn_blocking(move || open_sticky_note_sync(&app, &note_id))
        .await
        .map_err(|err| format!("sticky note open task failed: {err}"))?
}

#[tauri::command]
pub async fn sticky_notes_unpin(
    app: AppHandle,
    note_id: String,
) -> Result<StickyNotesState, String> {
    let trimmed_id = note_id.trim().to_string();
    if trimmed_id.is_empty() {
        return Err("Missing quick note id".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || unpin_sticky_note_sync(&app, &trimmed_id))
        .await
        .map_err(|err| format!("sticky note unpin task failed: {err}"))?
}

#[tauri::command]
pub async fn sticky_notes_update_options(
    app: AppHandle,
    payload: UpdateStickyNoteOptionsPayload,
) -> Result<StickyNotesState, String> {
    let trimmed_id = payload.note_id.trim().to_string();
    if trimmed_id.is_empty() {
        return Err("Missing quick note id".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let mut applied_top: Option<bool> = None;
        let next_state = with_sticky_notes_store_lock(&app, || {
            let mut stickies = read_sticky_notes_unlocked(&app)?;
            let record = stickies
                .iter_mut()
                .find(|item| item.note_id == trimmed_id)
                .ok_or_else(|| "Sticky note is not currently pinned to desktop".to_string())?;

            if let Some(always_on_top) = payload.always_on_top {
                record.always_on_top = always_on_top;
                applied_top = Some(always_on_top);
            }
            if let Some(ref color) = payload.color {
                record.color = normalize_sticky_color(Some(color.as_str()));
            }
            record.updated_at = crate::timestamp_string();
            write_sticky_notes_unlocked(&app, &stickies)?;
            Ok(StickyNotesState { stickies })
        })?;

        if let Some(always_on_top) = applied_top {
            let label = sticky_window_label(&trimmed_id);
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.set_always_on_top(always_on_top);
            }
        }
        emit_sticky_notes_updated(&app, &next_state);
        Ok(next_state)
    })
    .await
    .map_err(|err| format!("sticky note options task failed: {err}"))?
}
