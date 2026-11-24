use super::engine::execute_account_sync;
use super::outbox::{clear_outbox_entries, read_outbox_entries, OutboxEntry};
use super::realtime::{is_realtime_sync_active, set_realtime_sync_enabled};
use super::SyncStatusSnapshot;
use crate::accounts::session::{load_session, snapshot_from_session};
use tauri::AppHandle;

fn build_status(app: &AppHandle, message: String) -> Result<SyncStatusSnapshot, String> {
    let session = load_session(app)?;
    let snapshot = snapshot_from_session(&session);
    let pending_count = read_outbox_entries(app)?.len();
    Ok(SyncStatusSnapshot {
        auth_mode: snapshot.auth_mode.to_string(),
        active_user_id: snapshot.active_user_id,
        sync_enabled: snapshot.sync_enabled,
        server_endpoint: snapshot.server_endpoint,
        workspace_id: snapshot.workspace_id,
        pending_count,
        last_sync_cursor: snapshot.last_sync_cursor,
        last_sync_at: snapshot.last_sync_at,
        realtime_active: is_realtime_sync_active(app),
        status_message: message,
    })
}

#[tauri::command]
pub async fn sync_get_status(app: AppHandle) -> Result<SyncStatusSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session = load_session(&app)?;
        let message = if session.active_user_id.is_none() {
            "当前为纯本地工作区，所有数据直接保存在本机".to_string()
        } else if session.server_endpoint.is_none() {
            "已切换至账号隔离工作区，等待后续绑定云端服务器".to_string()
        } else {
            "已就绪：变更将暂存本地发件箱并按需同步至服务端".to_string()
        };
        build_status(&app, message)
    })
    .await
    .map_err(|err| format!("sync status task failed: {err}"))?
}

#[tauri::command]
pub async fn sync_list_outbox(app: AppHandle) -> Result<Vec<OutboxEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || read_outbox_entries(&app))
        .await
        .map_err(|err| format!("sync list outbox task failed: {err}"))?
}

#[tauri::command]
pub async fn sync_clear_outbox(app: AppHandle) -> Result<SyncStatusSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        clear_outbox_entries(&app)?;
        build_status(&app, "已清空当前账号本地待同步队列".to_string())
    })
    .await
    .map_err(|err| format!("sync clear outbox task failed: {err}"))?
}

#[tauri::command]
pub async fn sync_run_once(app: AppHandle) -> Result<SyncStatusSnapshot, String> {
    let session = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || load_session(&app)
    })
    .await
    .map_err(|err| format!("sync session check failed: {err}"))??;

    if session.active_user_id.is_none() {
        return tauri::async_runtime::spawn_blocking(move || {
            build_status(&app, "纯本地模式无需联网同步".to_string())
        })
        .await
        .map_err(|err| format!("sync status task failed: {err}"))?;
    }

    if session.server_endpoint.is_none() {
        return tauri::async_runtime::spawn_blocking(move || {
            let pending = read_outbox_entries(&app)?;
            build_status(
                &app,
                format!(
                    "未配置云端服务端地址，{} 条变更已安全暂存本地发件箱",
                    pending.len()
                ),
            )
        })
        .await
        .map_err(|err| format!("sync status task failed: {err}"))?;
    }

    let report = execute_account_sync(&app).await?;

    let summary = format!(
        "同步完成：推送 {} 条、拉取卡片 {} 条 / 便签 {} 条，预取缩略图 {} 张{}，本地余 {} 条待传",
        report.pushed_count,
        report.pulled_cards,
        report.pulled_notes,
        report.fetched_thumbs,
        if report.conflicts_count > 0 {
            format!("（已自动保留 {} 处冲突副本）", report.conflicts_count)
        } else {
            String::new()
        },
        report.remaining_pending
    );
    tauri::async_runtime::spawn_blocking(move || build_status(&app, summary))
        .await
        .map_err(|err| format!("sync status task failed: {err}"))?
}

#[tauri::command]
pub async fn sync_set_realtime_enabled(
    app: AppHandle,
    enabled: bool,
) -> Result<SyncStatusSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let active = set_realtime_sync_enabled(&app, enabled)?;
        let message = if active {
            "已开启实时协同推送（SSE），远端新任务与照片变更将自动同步".to_string()
        } else {
            "已关闭实时协同推送，改为按需手动同步".to_string()
        };
        build_status(&app, message)
    })
    .await
    .map_err(|err| format!("sync realtime toggle task failed: {err}"))?
}
