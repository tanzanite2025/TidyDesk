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

#[derive(Debug, Clone)]
pub(super) struct AvailableReleaseMeta {
    pub version: String,
    pub release_date: Option<String>,
    pub release_notes: Option<String>,
}

impl From<&Update> for AvailableReleaseMeta {
    fn from(update: &Update) -> Self {
        Self {
            version: update.version.clone(),
            release_date: update.date.as_ref().map(ToString::to_string),
            release_notes: update.body.clone(),
        }
    }
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

pub(super) fn checking_snapshot(
    metadata: &UpdateMetadata,
    previous: Option<&UpdateSnapshot>,
) -> UpdateSnapshot {
    UpdateSnapshot {
        state: "checking".to_string(),
        current_version: metadata.version.clone(),
        available_version: previous.and_then(|item| item.available_version.clone()),
        release_date: previous.and_then(|item| item.release_date.clone()),
        release_notes: previous.and_then(|item| item.release_notes.clone()),
        percent: None,
        message: Some("正在检查新版本...".to_string()),
        reason: None,
        can_check: false,
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
        message: Some("当前已是最新版本。".to_string()),
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

pub(super) fn download_error_snapshot_for_release(
    metadata: &UpdateMetadata,
    release: &AvailableReleaseMeta,
    message: impl Into<String>,
) -> UpdateSnapshot {
    UpdateSnapshot {
        state: "error".to_string(),
        current_version: metadata.version.clone(),
        available_version: Some(release.version.clone()),
        release_date: release.release_date.clone(),
        release_notes: release.release_notes.clone(),
        percent: None,
        message: Some(message.into()),
        reason: Some("unknown".to_string()),
        can_check: true,
        can_download: true,
        can_install: false,
    }
}

pub(super) fn download_error_snapshot(
    metadata: &UpdateMetadata,
    update: &Update,
    message: impl Into<String>,
) -> UpdateSnapshot {
    download_error_snapshot_for_release(metadata, &AvailableReleaseMeta::from(update), message)
}

pub(super) fn install_error_snapshot_for_release(
    metadata: &UpdateMetadata,
    release: &AvailableReleaseMeta,
    message: impl Into<String>,
) -> UpdateSnapshot {
    UpdateSnapshot {
        state: "error".to_string(),
        current_version: metadata.version.clone(),
        available_version: Some(release.version.clone()),
        release_date: release.release_date.clone(),
        release_notes: release.release_notes.clone(),
        percent: Some(100.0),
        message: Some(message.into()),
        reason: Some("unknown".to_string()),
        can_check: true,
        can_download: false,
        can_install: true,
    }
}

pub(super) fn install_error_snapshot(
    metadata: &UpdateMetadata,
    update: &Update,
    message: impl Into<String>,
) -> UpdateSnapshot {
    install_error_snapshot_for_release(metadata, &AvailableReleaseMeta::from(update), message)
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

pub(super) fn available_snapshot_for_release(
    metadata: &UpdateMetadata,
    release: &AvailableReleaseMeta,
    message: Option<String>,
) -> UpdateSnapshot {
    UpdateSnapshot {
        state: "available".to_string(),
        current_version: metadata.version.clone(),
        available_version: Some(release.version.clone()),
        release_date: release.release_date.clone(),
        release_notes: release.release_notes.clone(),
        percent: None,
        message,
        reason: None,
        can_check: true,
        can_download: true,
        can_install: false,
    }
}

pub(super) fn available_snapshot(metadata: &UpdateMetadata, update: &Update) -> UpdateSnapshot {
    available_snapshot_for_release(metadata, &AvailableReleaseMeta::from(update), None)
}

pub(super) fn download_cancelled_snapshot(
    metadata: &UpdateMetadata,
    update: &Update,
) -> UpdateSnapshot {
    available_snapshot_for_release(
        metadata,
        &AvailableReleaseMeta::from(update),
        Some("已取消下载，可随时重新下载更新。".to_string()),
    )
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
        message: Some("更新包已完成校验，准备安装。".to_string()),
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
        message: Some("正在安装更新并重启应用...".to_string()),
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
        message: Some("更新已安装，正在重启 TidyDesk...".to_string()),
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
            "开发环境已禁用自动更新检查。",
        );
    }

    match resolve_updater_config() {
        Ok(_) => idle_snapshot(&metadata),
        Err(err) => error_snapshot(&metadata, format!("更新配置无效: {err}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_metadata() -> UpdateMetadata {
        UpdateMetadata {
            name: "TidyDesk".to_string(),
            version: "0.0.2".to_string(),
            is_packaged: true,
            runtime: "tauri".to_string(),
            channel: "stable".to_string(),
            updater_available: true,
        }
    }

    fn sample_release() -> AvailableReleaseMeta {
        AvailableReleaseMeta {
            version: "0.0.3".to_string(),
            release_date: Some("2026-11-24T12:00:00Z".to_string()),
            release_notes: Some("- 修复更新状态机".to_string()),
        }
    }

    #[test]
    fn download_error_preserves_available_release_and_retry_capability() {
        let meta = sample_metadata();
        let release = sample_release();
        let snap = download_error_snapshot_for_release(&meta, &release, "下载超时");

        assert_eq!(snap.state, "error");
        assert_eq!(snap.available_version.as_deref(), Some("0.0.3"));
        assert_eq!(snap.release_notes.as_deref(), Some("- 修复更新状态机"));
        assert!(snap.can_check);
        assert!(snap.can_download);
        assert!(!snap.can_install);
    }

    #[test]
    fn install_error_preserves_available_release_and_allows_reinstall() {
        let meta = sample_metadata();
        let release = sample_release();
        let snap = install_error_snapshot_for_release(&meta, &release, "安装包拉起失败");

        assert_eq!(snap.state, "error");
        assert_eq!(snap.available_version.as_deref(), Some("0.0.3"));
        assert!(snap.can_check);
        assert!(!snap.can_download);
        assert!(snap.can_install);
    }

    #[test]
    fn checking_snapshot_locks_actions_and_preserves_previous_version_info() {
        let meta = sample_metadata();
        let prev = available_snapshot_for_release(&meta, &sample_release(), None);
        let checking = checking_snapshot(&meta, Some(&prev));

        assert_eq!(checking.state, "checking");
        assert_eq!(checking.available_version.as_deref(), Some("0.0.3"));
        assert!(!checking.can_check);
        assert!(!checking.can_download);
        assert!(!checking.can_install);
    }
}
