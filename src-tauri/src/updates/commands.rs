use super::config::{
    resolve_updater_config, update_metadata, ResolvedUpdaterConfig, UpdateMetadata,
};
use super::snapshot::{
    available_snapshot, default_snapshot, downloading_snapshot, error_snapshot,
    installing_snapshot, ready_to_install_snapshot, ready_to_restart_snapshot,
    unsupported_snapshot, up_to_date_snapshot, UpdateSnapshot,
};
use super::UPDATE_EVENT_NAME;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

pub struct UpdaterSessionState {
    session: Mutex<UpdaterSession>,
    operation_in_flight: AtomicBool,
}

#[derive(Default)]
struct UpdaterSession {
    pending_update: Option<PendingUpdate>,
    last_snapshot: Option<UpdateSnapshot>,
}

impl Default for UpdaterSessionState {
    fn default() -> Self {
        Self {
            session: Mutex::new(UpdaterSession::default()),
            operation_in_flight: AtomicBool::new(false),
        }
    }
}

struct PendingUpdate {
    update: Update,
    downloaded_bytes: Option<Vec<u8>>,
}

fn build_updater(
    app: &AppHandle,
    config: &ResolvedUpdaterConfig,
) -> Result<tauri_plugin_updater::Updater, String> {
    let mut builder = app.updater_builder();

    if let Some(pubkey) = &config.pubkey_override {
        builder = builder.pubkey(pubkey.clone());
    }

    if let Some(endpoints) = &config.endpoint_override {
        builder = builder
            .endpoints(endpoints.clone())
            .map_err(|err| err.to_string())?;
    }

    builder.build().map_err(|err| err.to_string())
}

fn replace_session(
    state: &UpdaterSessionState,
    snapshot: &UpdateSnapshot,
    pending_update: Option<PendingUpdate>,
) -> Result<(), String> {
    let mut session = state
        .session
        .lock()
        .map_err(|_| "failed to lock updater session".to_string())?;
    session.pending_update = pending_update;
    session.last_snapshot = Some(snapshot.clone());
    Ok(())
}

fn current_snapshot(
    app: &AppHandle,
    state: &UpdaterSessionState,
) -> Result<UpdateSnapshot, String> {
    let session = state
        .session
        .lock()
        .map_err(|_| "failed to lock updater session".to_string())?;
    if let Some(snapshot) = session.last_snapshot.clone() {
        return Ok(snapshot);
    }
    Ok(default_snapshot(app))
}

fn emit_snapshot(app: &AppHandle, snapshot: &UpdateSnapshot) -> Result<(), String> {
    app.emit(UPDATE_EVENT_NAME, snapshot.clone())
        .map_err(|err| err.to_string())
}

fn store_snapshot_for_state(
    state: &UpdaterSessionState,
    snapshot: &UpdateSnapshot,
) -> Result<(), String> {
    let mut session = state
        .session
        .lock()
        .map_err(|_| "failed to lock updater session".to_string())?;
    session.last_snapshot = Some(snapshot.clone());
    Ok(())
}

fn store_snapshot_for_app(app: &AppHandle, snapshot: &UpdateSnapshot) -> Result<(), String> {
    let state = app.state::<UpdaterSessionState>();
    store_snapshot_for_state(&state, snapshot)
}

fn emit_and_store(
    app: &AppHandle,
    state: &UpdaterSessionState,
    snapshot: &UpdateSnapshot,
    pending_update: Option<PendingUpdate>,
) -> Result<UpdateSnapshot, String> {
    replace_session(state, snapshot, pending_update)?;
    emit_snapshot(app, snapshot)?;
    Ok(snapshot.clone())
}

struct UpdaterOperationGuard<'a> {
    state: &'a UpdaterSessionState,
}

impl Drop for UpdaterOperationGuard<'_> {
    fn drop(&mut self) {
        self.state
            .operation_in_flight
            .store(false, Ordering::Release);
    }
}

fn try_begin_updater_operation(state: &UpdaterSessionState) -> Option<UpdaterOperationGuard<'_>> {
    state
        .operation_in_flight
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .ok()
        .map(|_| UpdaterOperationGuard { state })
}

#[tauri::command]
pub fn updates_get_metadata(app: AppHandle) -> Result<UpdateMetadata, String> {
    Ok(update_metadata(&app))
}

#[tauri::command]
pub fn updates_get_state(
    app: AppHandle,
    state: State<'_, UpdaterSessionState>,
) -> Result<UpdateSnapshot, String> {
    current_snapshot(&app, &state)
}

#[tauri::command]
pub async fn updates_check(
    app: AppHandle,
    state: State<'_, UpdaterSessionState>,
) -> Result<UpdateSnapshot, String> {
    updates_check_internal(&app, &state).await
}

pub(super) async fn updates_check_internal(
    app: &AppHandle,
    state: &UpdaterSessionState,
) -> Result<UpdateSnapshot, String> {
    let Some(_operation_guard) = try_begin_updater_operation(state) else {
        return current_snapshot(app, state);
    };
    let metadata = update_metadata(app);

    if cfg!(debug_assertions) {
        let snapshot = unsupported_snapshot(
            &metadata,
            "development-build",
            "Updater checks are disabled in development builds.",
        );
        return emit_and_store(app, state, &snapshot, None);
    }

    let config = match resolve_updater_config() {
        Ok(config) => config,
        Err(err) => {
            let snapshot = error_snapshot(
                &metadata,
                format!("Updater configuration is invalid: {err}"),
            );
            return emit_and_store(app, state, &snapshot, None);
        }
    };

    let updater = match build_updater(app, &config) {
        Ok(updater) => updater,
        Err(err) => {
            let snapshot = error_snapshot(&metadata, format!("Failed to create updater: {err}"));
            return emit_and_store(app, state, &snapshot, None);
        }
    };

    let update = match updater.check().await {
        Ok(update) => update,
        Err(err) => {
            let snapshot = error_snapshot(&metadata, format!("Failed to check for updates: {err}"));
            return emit_and_store(app, state, &snapshot, None);
        }
    };

    match update {
        Some(update) => {
            let snapshot = available_snapshot(&metadata, &update);
            emit_and_store(
                app,
                state,
                &snapshot,
                Some(PendingUpdate {
                    update,
                    downloaded_bytes: None,
                }),
            )
        }
        None => {
            let snapshot = up_to_date_snapshot(&metadata);
            emit_and_store(app, state, &snapshot, None)
        }
    }
}

#[tauri::command]
pub async fn updates_download(
    app: AppHandle,
    state: State<'_, UpdaterSessionState>,
) -> Result<UpdateSnapshot, String> {
    let Some(_operation_guard) = try_begin_updater_operation(&state) else {
        return current_snapshot(&app, &state);
    };
    let metadata = update_metadata(&app);
    let update = {
        let session = state
            .session
            .lock()
            .map_err(|_| "failed to lock updater session".to_string())?;
        match session.pending_update.as_ref() {
            Some(pending) => pending.update.clone(),
            None => {
                let snapshot = error_snapshot(
                    &metadata,
                    "No update is ready to download. Check for updates first.",
                );
                drop(session);
                return emit_and_store(&app, &state, &snapshot, None);
            }
        }
    };

    let app_for_progress = app.clone();
    let app_for_finish = app.clone();
    let metadata_for_progress = metadata.clone();
    let metadata_for_finish = metadata.clone();
    let update_for_progress = update.clone();
    let update_for_finish = update.clone();
    let mut downloaded_bytes = 0_u64;

    let bytes = match update
        .download(
            move |chunk_length, content_length| {
                downloaded_bytes += chunk_length as u64;
                let percent = content_length
                    .filter(|total| *total > 0)
                    .map(|total| ((downloaded_bytes as f64 / total as f64) * 100.0).min(100.0));
                let message = match content_length {
                    Some(total) => Some(format!(
                        "Downloading update ({downloaded_bytes}/{total} bytes)..."
                    )),
                    None => Some(format!("Downloading update ({downloaded_bytes} bytes)...")),
                };
                let snapshot = downloading_snapshot(
                    &metadata_for_progress,
                    &update_for_progress,
                    percent,
                    message,
                );
                let _ = store_snapshot_for_app(&app_for_progress, &snapshot);
                let _ = emit_snapshot(&app_for_progress, &snapshot);
            },
            move || {
                let snapshot = downloading_snapshot(
                    &metadata_for_finish,
                    &update_for_finish,
                    Some(100.0),
                    Some("Download complete. Verifying update package...".to_string()),
                );
                let _ = store_snapshot_for_app(&app_for_finish, &snapshot);
                let _ = emit_snapshot(&app_for_finish, &snapshot);
            },
        )
        .await
    {
        Ok(bytes) => bytes,
        Err(err) => {
            let snapshot = error_snapshot(&metadata, format!("Failed to download update: {err}"));
            return emit_and_store(
                &app,
                &state,
                &snapshot,
                Some(PendingUpdate {
                    update,
                    downloaded_bytes: None,
                }),
            );
        }
    };

    let snapshot = ready_to_install_snapshot(&metadata, &update);
    emit_and_store(
        &app,
        &state,
        &snapshot,
        Some(PendingUpdate {
            update,
            downloaded_bytes: Some(bytes),
        }),
    )
}

#[tauri::command]
pub fn updates_install(
    app: AppHandle,
    state: State<'_, UpdaterSessionState>,
) -> Result<UpdateSnapshot, String> {
    let Some(_operation_guard) = try_begin_updater_operation(&state) else {
        return current_snapshot(&app, &state);
    };
    let metadata = update_metadata(&app);
    let (update, bytes, snapshot) = {
        let mut session = state
            .session
            .lock()
            .map_err(|_| "failed to lock updater session".to_string())?;

        let Some(pending) = session.pending_update.take() else {
            let snapshot = error_snapshot(
                &metadata,
                "No update is ready to install. Download the update first.",
            );
            session.last_snapshot = Some(snapshot.clone());
            drop(session);
            emit_snapshot(&app, &snapshot)?;
            return Ok(snapshot);
        };

        let Some(bytes) = pending.downloaded_bytes else {
            let snapshot = error_snapshot(
                &metadata,
                "The update package has not finished downloading yet.",
            );
            session.pending_update = Some(PendingUpdate {
                update: pending.update,
                downloaded_bytes: None,
            });
            session.last_snapshot = Some(snapshot.clone());
            drop(session);
            emit_snapshot(&app, &snapshot)?;
            return Ok(snapshot);
        };

        let snapshot = installing_snapshot(&metadata, &pending.update);
        session.last_snapshot = Some(snapshot.clone());
        (pending.update, bytes, snapshot)
    };

    emit_snapshot(&app, &snapshot)?;

    if let Err(err) = update.install(&bytes) {
        let failure = error_snapshot(&metadata, format!("Failed to install update: {err}"));
        return emit_and_store(
            &app,
            &state,
            &failure,
            Some(PendingUpdate {
                update,
                downloaded_bytes: Some(bytes),
            }),
        );
    }

    let success = ready_to_restart_snapshot(&metadata, &update);
    let snapshot = emit_and_store(&app, &state, &success, None)?;
    app.request_restart();
    Ok(snapshot)
}
