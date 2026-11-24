use super::config::{
    resolve_updater_config, update_metadata, ResolvedUpdaterConfig, UpdateMetadata,
};
use super::snapshot::{
    available_snapshot, checking_snapshot, default_snapshot, download_cancelled_snapshot,
    download_error_snapshot, downloading_snapshot, error_snapshot, install_error_snapshot,
    installing_snapshot, ready_to_install_snapshot, ready_to_restart_snapshot,
    unsupported_snapshot, up_to_date_snapshot, UpdateSnapshot,
};
use super::UPDATE_EVENT_NAME;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{async_runtime::JoinHandle, AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const CHECK_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_REQUEST_TIMEOUT: Duration = Duration::from_secs(180);

pub struct UpdaterSessionState {
    session: Mutex<UpdaterSession>,
    operation_in_flight: AtomicBool,
}

#[derive(Default)]
struct UpdaterSession {
    pending_update: Option<PendingUpdate>,
    last_snapshot: Option<UpdateSnapshot>,
    active_download: Option<ActiveDownloadHandle>,
}

struct ActiveDownloadHandle {
    task: JoinHandle<()>,
    cancel_requested: Arc<AtomicBool>,
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
    let app_for_exit = app.clone();
    let mut builder = app
        .updater_builder()
        .timeout(CHECK_REQUEST_TIMEOUT)
        .on_before_exit(move || {
            crate::sticky_notes::mark_app_exiting(&app_for_exit);
        });

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

fn store_downloading_snapshot_if_active(
    app: &AppHandle,
    snapshot: &UpdateSnapshot,
) -> Result<bool, String> {
    let state = app.state::<UpdaterSessionState>();
    let mut session = state
        .session
        .lock()
        .map_err(|_| "failed to lock updater session".to_string())?;
    let active_not_cancelled = session
        .active_download
        .as_ref()
        .is_some_and(|handle| !handle.cancel_requested.load(Ordering::Acquire));
    if !active_not_cancelled {
        return Ok(false);
    }
    session.last_snapshot = Some(snapshot.clone());
    Ok(true)
}

fn emit_and_store_snapshot_only(
    app: &AppHandle,
    state: &UpdaterSessionState,
    snapshot: &UpdateSnapshot,
) -> Result<UpdateSnapshot, String> {
    store_snapshot_for_state(state, snapshot)?;
    emit_snapshot(app, snapshot)?;
    Ok(snapshot.clone())
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

fn set_active_download(
    state: &UpdaterSessionState,
    handle: Option<ActiveDownloadHandle>,
) -> Result<(), String> {
    let mut session = state
        .session
        .lock()
        .map_err(|_| "failed to lock updater session".to_string())?;
    session.active_download = handle;
    Ok(())
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

fn emit_check_error_preserving_pending(
    app: &AppHandle,
    state: &UpdaterSessionState,
    metadata: &UpdateMetadata,
    message: String,
) -> Result<UpdateSnapshot, String> {
    let snapshot = {
        let session = state
            .session
            .lock()
            .map_err(|_| "failed to lock updater session".to_string())?;
        match session.pending_update.as_ref() {
            Some(pending) if pending.downloaded_bytes.is_some() => {
                install_error_snapshot(metadata, &pending.update, message)
            }
            Some(pending) => download_error_snapshot(metadata, &pending.update, message),
            None => error_snapshot(metadata, message),
        }
    };
    emit_and_store_snapshot_only(app, state, &snapshot)
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
            "开发环境已禁用自动更新检查。",
        );
        return emit_and_store(app, state, &snapshot, None);
    }

    let previous_snapshot = current_snapshot(app, state).ok();
    let checking = checking_snapshot(&metadata, previous_snapshot.as_ref());
    let _ = emit_and_store_snapshot_only(app, state, &checking);

    let config = match resolve_updater_config() {
        Ok(config) => config,
        Err(err) => {
            return emit_check_error_preserving_pending(
                app,
                state,
                &metadata,
                format!("更新配置无效: {err}"),
            );
        }
    };

    let updater = match build_updater(app, &config) {
        Ok(updater) => updater,
        Err(err) => {
            return emit_check_error_preserving_pending(
                app,
                state,
                &metadata,
                format!("初始化更新器失败: {err}"),
            );
        }
    };

    let update = match updater.check().await {
        Ok(update) => update,
        Err(err) => {
            return emit_check_error_preserving_pending(
                app,
                state,
                &metadata,
                format!("检查更新失败: {err}"),
            );
        }
    };

    match update {
        Some(mut update) => {
            update.timeout = Some(DOWNLOAD_REQUEST_TIMEOUT);
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
    let mut update = {
        let session = state
            .session
            .lock()
            .map_err(|_| "failed to lock updater session".to_string())?;
        match session.pending_update.as_ref() {
            Some(pending) => pending.update.clone(),
            None => {
                let snapshot = error_snapshot(&metadata, "当前没有可下载的更新，请先检查更新。");
                drop(session);
                return emit_and_store(&app, &state, &snapshot, None);
            }
        }
    };
    update.timeout = Some(DOWNLOAD_REQUEST_TIMEOUT);

    let initial_downloading = downloading_snapshot(
        &metadata,
        &update,
        Some(0.0),
        Some("正在连接更新源...".to_string()),
    );
    let _ = emit_and_store_snapshot_only(&app, &state, &initial_downloading);

    let cancel_requested = Arc::new(AtomicBool::new(false));
    let cancel_for_progress = Arc::clone(&cancel_requested);
    let cancel_for_finish = Arc::clone(&cancel_requested);

    let app_for_progress = app.clone();
    let app_for_finish = app.clone();
    let metadata_for_progress = metadata.clone();
    let metadata_for_finish = metadata.clone();
    let update_for_progress = update.clone();
    let update_for_finish = update.clone();
    let update_for_task = update.clone();
    let mut downloaded_bytes = 0_u64;

    let (tx, mut rx) = tauri::async_runtime::channel::<Result<Vec<u8>, String>>(1);
    let task_handle = tauri::async_runtime::spawn(async move {
        let result = update_for_task
            .download(
                move |chunk_length, content_length| {
                    if cancel_for_progress.load(Ordering::Acquire) {
                        return;
                    }
                    downloaded_bytes += chunk_length as u64;
                    let percent = content_length
                        .filter(|total| *total > 0)
                        .map(|total| ((downloaded_bytes as f64 / total as f64) * 100.0).min(100.0));
                    let message = match content_length {
                        Some(total) => {
                            Some(format!("正在下载更新 ({downloaded_bytes}/{total} 字节)..."))
                        }
                        None => Some(format!("正在下载更新 ({downloaded_bytes} 字节)...")),
                    };
                    let snapshot = downloading_snapshot(
                        &metadata_for_progress,
                        &update_for_progress,
                        percent,
                        message,
                    );
                    if matches!(
                        store_downloading_snapshot_if_active(&app_for_progress, &snapshot),
                        Ok(true)
                    ) {
                        let _ = emit_snapshot(&app_for_progress, &snapshot);
                    }
                },
                move || {
                    if cancel_for_finish.load(Ordering::Acquire) {
                        return;
                    }
                    let snapshot = downloading_snapshot(
                        &metadata_for_finish,
                        &update_for_finish,
                        Some(100.0),
                        Some("下载完成，正在校验安装签名...".to_string()),
                    );
                    if matches!(
                        store_downloading_snapshot_if_active(&app_for_finish, &snapshot),
                        Ok(true)
                    ) {
                        let _ = emit_snapshot(&app_for_finish, &snapshot);
                    }
                },
            )
            .await
            .map_err(|err| err.to_string());
        let _ = tx.send(result).await;
    });

    set_active_download(
        &state,
        Some(ActiveDownloadHandle {
            task: task_handle,
            cancel_requested: Arc::clone(&cancel_requested),
        }),
    )?;

    let download_result = rx.recv().await;
    let _ = set_active_download(&state, None);

    if cancel_requested.load(Ordering::Acquire) {
        let snapshot = download_cancelled_snapshot(&metadata, &update);
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

    let bytes = match download_result {
        Some(Ok(bytes)) => bytes,
        Some(Err(err)) => {
            let snapshot =
                download_error_snapshot(&metadata, &update, format!("下载更新失败: {err}"));
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
        None => {
            let snapshot = download_error_snapshot(&metadata, &update, "下载任务意外中止");
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
pub fn updates_cancel_download(
    app: AppHandle,
    state: State<'_, UpdaterSessionState>,
) -> Result<UpdateSnapshot, String> {
    let metadata = update_metadata(&app);
    let (active, cancelled_snapshot) = {
        let mut session = state
            .session
            .lock()
            .map_err(|_| "failed to lock updater session".to_string())?;
        let active = session.active_download.take();
        if let Some(handle) = active.as_ref() {
            handle.cancel_requested.store(true, Ordering::Release);
        }
        let cancelled_snapshot = if active.is_some() {
            session
                .pending_update
                .as_ref()
                .map(|pending| download_cancelled_snapshot(&metadata, &pending.update))
        } else {
            None
        };
        if let Some(snap) = cancelled_snapshot.as_ref() {
            session.last_snapshot = Some(snap.clone());
        }
        (active, cancelled_snapshot)
    };

    if let Some(handle) = active {
        handle.task.abort();
    }

    if let Some(snapshot) = cancelled_snapshot {
        emit_snapshot(&app, &snapshot)?;
        return Ok(snapshot);
    }

    current_snapshot(&app, &state)
}

#[tauri::command]
pub async fn updates_install(
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
            let snapshot = error_snapshot(&metadata, "当前没有待安装的更新，请先下载更新。");
            session.last_snapshot = Some(snapshot.clone());
            drop(session);
            emit_snapshot(&app, &snapshot)?;
            return Ok(snapshot);
        };

        let Some(bytes) = pending.downloaded_bytes else {
            let snapshot = download_error_snapshot(
                &metadata,
                &pending.update,
                "更新包尚未完成下载，请重新下载。",
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

    let install_update = update.clone();
    let install_bytes = bytes.clone();
    let install_result =
        tauri::async_runtime::spawn_blocking(move || install_update.install(&install_bytes))
            .await
            .map_err(|err| format!("安装任务执行异常: {err}"))
            .and_then(|res| res.map_err(|err| err.to_string()));

    if let Err(err) = install_result {
        let failure = install_error_snapshot(&metadata, &update, format!("安装更新失败: {err}"));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operation_guard_releases_in_flight_flag_on_drop() {
        let state = UpdaterSessionState::default();
        {
            let guard = try_begin_updater_operation(&state);
            assert!(guard.is_some());
            assert!(try_begin_updater_operation(&state).is_none());
        }
        assert!(try_begin_updater_operation(&state).is_some());
    }
}
