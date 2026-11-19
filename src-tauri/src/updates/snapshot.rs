use super::config::{resolve_updater_config, update_metadata, UpdateMetadata};
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::Update;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    pub state: String,
    pub current_version: String,
    pub available_version: Option<String>,
    pub release_date: Option<String>,
    pub release_notes: Option<String>,
    pub percent: Option<f64>,
    pub message: Option<String>,
    pub reason: Option<String>,
    pub can_check: bool,
    pub can_download: bool,
    pub can_install: bool,
}

pub(super) fn idle_snapshot(metadata: &UpdateMetadata) -> UpdateSnapshot {
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

pub(super) fn up_to_date_snapshot(metadata: &UpdateMetadata) -> UpdateSnapshot {
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

pub(super) fn error_snapshot(
    metadata: &UpdateMetadata,
    message: impl Into<String>,
) -> UpdateSnapshot {
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

pub(super) fn unsupported_snapshot(
    metadata: &UpdateMetadata,
    reason: &str,
    message: &str,
) -> UpdateSnapshot {
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

pub(super) fn available_snapshot(metadata: &UpdateMetadata, update: &Update) -> UpdateSnapshot {
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

pub(super) fn downloading_snapshot(
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

pub(super) fn ready_to_install_snapshot(
    metadata: &UpdateMetadata,
    update: &Update,
) -> UpdateSnapshot {
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

pub(super) fn installing_snapshot(metadata: &UpdateMetadata, update: &Update) -> UpdateSnapshot {
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

pub(super) fn ready_to_restart_snapshot(
    metadata: &UpdateMetadata,
    update: &Update,
) -> UpdateSnapshot {
    UpdateSnapshot {
        state: "ready-to-restart".to_string(),
        current_version: metadata.version.clone(),
        available_version: Some(update.version.clone()),
        release_date: update.date.as_ref().map(ToString::to_string),
        release_notes: update.body.clone(),
        percent: Some(100.0),
        message: Some("Update installed. Restart TidyDesk to finish.".to_string()),
        reason: None,
        can_check: false,
        can_download: false,
        can_install: false,
    }
}

pub(super) fn default_snapshot(app: &AppHandle) -> UpdateSnapshot {
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
