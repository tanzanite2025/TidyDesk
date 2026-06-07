use serde::Serialize;
use std::env;
use std::fs;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

const DEFAULT_UPDATER_CHANNEL: &str = "stable";
const UPDATE_EVENT_NAME: &str = "updates-state";
const UPDATER_CHANNEL_ENV: &str = "TIDYDESK_UPDATER_CHANNEL";
const UPDATER_ENDPOINTS_ENV: &str = "TIDYDESK_UPDATER_ENDPOINTS";
const UPDATER_PUBLIC_KEY_ENV: &str = "TIDYDESK_UPDATER_PUBLIC_KEY";
const UPDATER_PUBLIC_KEY_FILE_ENV: &str = "TIDYDESK_UPDATER_PUBLIC_KEY_FILE";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    name: String,
    version: String,
    is_packaged: bool,
    runtime: String,
    channel: String,
    updater_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    state: String,
    current_version: String,
    available_version: Option<String>,
    release_date: Option<String>,
    release_notes: Option<String>,
    percent: Option<f64>,
    message: Option<String>,
    reason: Option<String>,
    can_check: bool,
    can_download: bool,
    can_install: bool,
}

#[derive(Default)]
pub struct UpdaterSessionState(Mutex<UpdaterSession>);

#[derive(Default)]
struct UpdaterSession {
    pending_update: Option<PendingUpdate>,
    last_snapshot: Option<UpdateSnapshot>,
}

struct PendingUpdate {
    update: Update,
    downloaded_bytes: Option<Vec<u8>>,
}

#[derive(Debug, Clone)]
struct ResolvedUpdaterConfig {
    channel: String,
    endpoint_override: Option<Vec<Url>>,
    pubkey_override: Option<String>,
}

fn current_channel() -> String {
    env::var(UPDATER_CHANNEL_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_UPDATER_CHANNEL.to_string())
}

fn resolve_public_key_override() -> Result<Option<String>, String> {
    if let Ok(value) = env::var(UPDATER_PUBLIC_KEY_ENV) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed.to_string()));
        }
    }

    if let Ok(path) = env::var(UPDATER_PUBLIC_KEY_FILE_ENV) {
        let contents = fs::read_to_string(&path)
            .map_err(|err| format!("failed to read updater public key file `{path}`: {err}"))?;
        let trimmed = contents.trim();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed.to_string()));
        }
    }

    Ok(None)
}

fn resolve_endpoints_override() -> Result<Option<Vec<Url>>, String> {
    let raw = match env::var(UPDATER_ENDPOINTS_ENV) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };

    let endpoints = raw
        .split(|ch| ch == ';' || ch == ',' || ch == '\n')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            Url::parse(value).map_err(|err| format!("invalid updater endpoint `{value}`: {err}"))
        })
        .collect::<Result<Vec<_>, _>>()?;

    if endpoints.is_empty() {
        return Err("no updater endpoints configured".to_string());
    }

    Ok(Some(endpoints))
}

fn resolve_updater_config() -> Result<ResolvedUpdaterConfig, String> {
    Ok(ResolvedUpdaterConfig {
        channel: current_channel(),
        endpoint_override: resolve_endpoints_override()?,
        pubkey_override: resolve_public_key_override()?,
    })
}

fn update_metadata(app: &AppHandle) -> UpdateMetadata {
    let resolved_config = resolve_updater_config().ok();

    UpdateMetadata {
        name: app
            .config()
            .product_name
            .clone()
            .unwrap_or_else(|| app.package_info().name.clone()),
        version: app.package_info().version.to_string(),
        is_packaged: !cfg!(debug_assertions),
        runtime: "tauri".to_string(),
        channel: resolved_config
            .as_ref()
            .map(|config| config.channel.clone())
            .unwrap_or_else(current_channel),
        updater_available: !cfg!(debug_assertions) && resolved_config.is_some(),
    }
}

fn idle_snapshot(metadata: &UpdateMetadata) -> UpdateSnapshot {
    UpdateSnapshot {
        state: "idle".to_string(),
        current_version: metadata.version.clone(),
        available_version: None,
        release_date: None,
        release_notes: None,
        percent: None,
        message: None,
        reason: None,
        can_check: true,
        can_download: false,
        can_install: false,
    }
}

fn up_to_date_snapshot(metadata: &UpdateMetadata) -> UpdateSnapshot {
    UpdateSnapshot {
        state: "up-to-date".to_string(),
        current_version: metadata.version.clone(),
        available_version: None,
        release_date: None,
        release_notes: None,
        percent: None,
        message: Some("You are already on the latest version.".to_string()),
        reason: None,
        can_check: true,
        can_download: false,
        can_install: false,
    }
}

fn error_snapshot(metadata: &UpdateMetadata, message: impl Into<String>) -> UpdateSnapshot {
    UpdateSnapshot {
        state: "error".to_string(),
        current_version: metadata.version.clone(),
        available_version: None,
        release_date: None,
        release_notes: None,
        percent: None,
        message: Some(message.into()),
        reason: Some("unknown".to_string()),
        can_check: true,
        can_download: false,
        can_install: false,
    }
}

fn unsupported_snapshot(metadata: &UpdateMetadata, reason: &str, message: &str) -> UpdateSnapshot {
    UpdateSnapshot {
        state: "unsupported".to_string(),
        current_version: metadata.version.clone(),
        available_version: None,
        release_date: None,
        release_notes: None,
        percent: None,
        message: Some(message.to_string()),
        reason: Some(reason.to_string()),
        can_check: false,
        can_download: false,
        can_install: false,
    }
}

fn available_snapshot(metadata: &UpdateMetadata, update: &Update) -> UpdateSnapshot {
    UpdateSnapshot {
        state: "available".to_string(),
        current_version: metadata.version.clone(),
        available_version: Some(update.version.clone()),
        release_date: update.date.as_ref().map(ToString::to_string),
        release_notes: update.body.clone(),
        percent: None,
        message: None,
        reason: None,
        can_check: true,
        can_download: true,
        can_install: false,
    }
}

fn downloading_snapshot(
    metadata: &UpdateMetadata,
    update: &Update,
    percent: Option<f64>,
    message: Option<String>,
) -> UpdateSnapshot {
    UpdateSnapshot {
        state: "downloading".to_string(),
        current_version: metadata.version.clone(),
        available_version: Some(update.version.clone()),
        release_date: update.date.as_ref().map(ToString::to_string),
        release_notes: update.body.clone(),
        percent,
        message,
        reason: None,
        can_check: false,
        can_download: false,
        can_install: false,
    }
}

fn ready_to_install_snapshot(metadata: &UpdateMetadata, update: &Update) -> UpdateSnapshot {
    UpdateSnapshot {
        state: "ready-to-install".to_string(),
        current_version: metadata.version.clone(),
        available_version: Some(update.version.clone()),
        release_date: update.date.as_ref().map(ToString::to_string),
        release_notes: update.body.clone(),
        percent: Some(100.0),
        message: Some("Update downloaded and ready to install.".to_string()),
        reason: None,
        can_check: false,
        can_download: false,
        can_install: true,
    }
}

fn installing_snapshot(metadata: &UpdateMetadata, update: &Update) -> UpdateSnapshot {
    UpdateSnapshot {
        state: "installing".to_string(),
        current_version: metadata.version.clone(),
        available_version: Some(update.version.clone()),
        release_date: update.date.as_ref().map(ToString::to_string),
        release_notes: update.body.clone(),
        percent: None,
        message: Some("Installing update...".to_string()),
        reason: None,
        can_check: false,
        can_download: false,
        can_install: false,
    }
}

fn default_snapshot(app: &AppHandle) -> UpdateSnapshot {
    let metadata = update_metadata(app);

    if cfg!(debug_assertions) {
        return unsupported_snapshot(
            &metadata,
            "development-build",
            "Updater checks are disabled in development builds.",
        );
    }

    match resolve_updater_config() {
        Ok(_) => idle_snapshot(&metadata),
        Err(err) => error_snapshot(
            &metadata,
            format!("Updater configuration is invalid: {err}"),
        ),
    }
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
    state: &State<'_, UpdaterSessionState>,
    snapshot: &UpdateSnapshot,
    pending_update: Option<PendingUpdate>,
) -> Result<(), String> {
    let mut session = state
        .0
        .lock()
        .map_err(|_| "failed to lock updater session".to_string())?;
    session.pending_update = pending_update;
    session.last_snapshot = Some(snapshot.clone());
    Ok(())
}

fn current_snapshot(
    app: &AppHandle,
    state: &State<'_, UpdaterSessionState>,
) -> Result<UpdateSnapshot, String> {
    let session = state
        .0
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

fn emit_and_store(
    app: &AppHandle,
    state: &State<'_, UpdaterSessionState>,
    snapshot: &UpdateSnapshot,
    pending_update: Option<PendingUpdate>,
) -> Result<UpdateSnapshot, String> {
    replace_session(state, snapshot, pending_update)?;
    emit_snapshot(app, snapshot)?;
    Ok(snapshot.clone())
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
    let metadata = update_metadata(&app);

    if cfg!(debug_assertions) {
        let snapshot = unsupported_snapshot(
            &metadata,
            "development-build",
            "Updater checks are disabled in development builds.",
        );
        return emit_and_store(&app, &state, &snapshot, None);
    }

    let config = match resolve_updater_config() {
        Ok(config) => config,
        Err(err) => {
            let snapshot = error_snapshot(
                &metadata,
                format!("Updater configuration is invalid: {err}"),
            );
            return emit_and_store(&app, &state, &snapshot, None);
        }
    };

    let updater = match build_updater(&app, &config) {
        Ok(updater) => updater,
        Err(err) => {
            let snapshot = error_snapshot(&metadata, format!("Failed to create updater: {err}"));
            return emit_and_store(&app, &state, &snapshot, None);
        }
    };

    let update = match updater.check().await {
        Ok(update) => update,
        Err(err) => {
            let snapshot = error_snapshot(&metadata, format!("Failed to check for updates: {err}"));
            return emit_and_store(&app, &state, &snapshot, None);
        }
    };

    match update {
        Some(update) => {
            let snapshot = available_snapshot(&metadata, &update);
            emit_and_store(
                &app,
                &state,
                &snapshot,
                Some(PendingUpdate {
                    update,
                    downloaded_bytes: None,
                }),
            )
        }
        None => {
            let snapshot = up_to_date_snapshot(&metadata);
            emit_and_store(&app, &state, &snapshot, None)
        }
    }
}

#[tauri::command]
pub async fn updates_download(
    app: AppHandle,
    state: State<'_, UpdaterSessionState>,
) -> Result<UpdateSnapshot, String> {
    let metadata = update_metadata(&app);
    let update = {
        let session = state
            .0
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
                let _ = emit_snapshot(&app_for_progress, &snapshot);
            },
            move || {
                let snapshot = downloading_snapshot(
                    &metadata_for_finish,
                    &update_for_finish,
                    Some(100.0),
                    Some("Download complete. Verifying update package...".to_string()),
                );
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
    let metadata = update_metadata(&app);
    let (update, bytes, snapshot) = {
        let mut session = state
            .0
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

    Ok(snapshot)
}
