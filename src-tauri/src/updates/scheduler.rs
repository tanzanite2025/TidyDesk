use super::commands::updates_check_internal;
use super::snapshot::UpdateSnapshot;
use super::UpdaterSessionState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

const AUTO_UPDATE_CHECK_FILE: &str = "updates.json";
const AUTO_UPDATE_CHECK_INTERVAL_SECS: u64 = 24 * 60 * 60;

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAutoCheckState {
    last_auto_check_unix_secs: Option<u64>,
}

fn unix_now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn auto_update_check_due(now_secs: u64, last_check_secs: Option<u64>) -> bool {
    match last_check_secs {
        Some(last_check_secs) if last_check_secs <= now_secs => {
            now_secs.saturating_sub(last_check_secs) >= AUTO_UPDATE_CHECK_INTERVAL_SECS
        }
        Some(_) => true,
        None => true,
    }
}

fn auto_update_check_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(AUTO_UPDATE_CHECK_FILE))
        .map_err(|err| format!("failed to resolve updater state path: {err}"))
}

fn read_auto_update_check_state(app: &AppHandle) -> UpdateAutoCheckState {
    let Ok(path) = auto_update_check_state_path(app) else {
        return UpdateAutoCheckState::default();
    };
    let Ok(contents) = fs::read_to_string(&path) else {
        return UpdateAutoCheckState::default();
    };
    match serde_json::from_str(&contents) {
        Ok(state) => state,
        Err(err) => {
            match crate::persistence::backup_corrupt_file(&path, "updater auto-check state") {
                Ok(backup_path) => eprintln!(
                    "[TIDYDESK] Backed up corrupt updater auto-check state to {}: {err}",
                    backup_path.display()
                ),
                Err(backup_err) => eprintln!(
                    "[TIDYDESK] Failed to back up corrupt updater auto-check state: {backup_err}"
                ),
            }
            let state = UpdateAutoCheckState::default();
            if let Err(write_err) =
                crate::persistence::atomic_write_json(&path, &state, "updater auto-check state")
            {
                eprintln!("[TIDYDESK] Failed to rewrite updater auto-check state: {write_err}");
            }
            state
        }
    }
}

fn should_run_auto_update_check(app: &AppHandle) -> bool {
    let state = read_auto_update_check_state(app);
    auto_update_check_due(unix_now_secs(), state.last_auto_check_unix_secs)
}

fn mark_auto_update_check_attempted(app: &AppHandle) -> Result<(), String> {
    let path = auto_update_check_state_path(app)?;
    let state = UpdateAutoCheckState {
        last_auto_check_unix_secs: Some(unix_now_secs()),
    };
    crate::persistence::atomic_write_json(&path, &state, "updater auto-check state")
}

pub fn start_update_auto_check(app: AppHandle, delay: Duration) {
    if cfg!(debug_assertions) {
        return;
    }

    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(delay);
        if let Err(err) = tauri::async_runtime::block_on(run_update_auto_check(app)) {
            eprintln!("[TIDYDESK] Automatic update check failed: {err}");
        }
    });
}

async fn run_update_auto_check(app: AppHandle) -> Result<(), String> {
    if !should_run_auto_update_check(&app) {
        return Ok(());
    }

    mark_auto_update_check_attempted(&app)?;
    let state = app.state::<UpdaterSessionState>();
    let snapshot = updates_check_internal(&app, &state).await?;
    if snapshot.state == "available" {
        notify_update_available(&app, &snapshot);
    }
    Ok(())
}

fn notify_update_available(app: &AppHandle, snapshot: &UpdateSnapshot) {
    let version = snapshot
        .available_version
        .clone()
        .unwrap_or_else(|| "新版本".to_string());
    if let Err(err) = app
        .notification()
        .builder()
        .title("TidyDesk 有可用更新")
        .body(format!("版本 {version} 已可下载。打开设置页安装更新。"))
        .auto_cancel()
        .show()
    {
        eprintln!("[TIDYDESK] Failed to show update notification: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_update_check_runs_when_never_checked() {
        assert!(auto_update_check_due(1_000, None));
    }

    #[test]
    fn auto_update_check_is_throttled_for_one_day() {
        assert!(!auto_update_check_due(1_000, Some(999)));
        assert!(auto_update_check_due(
            AUTO_UPDATE_CHECK_INTERVAL_SECS + 1_000,
            Some(1_000)
        ));
    }

    #[test]
    fn auto_update_check_runs_when_stored_time_is_in_future() {
        assert!(auto_update_check_due(1_000, Some(2_000)));
    }
}
