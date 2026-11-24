use super::credentials::{
    has_account_token, load_account_sync_profile, load_account_token, save_account_sync_profile,
    store_account_token, StoredAccountSyncProfile,
};
use super::session::{
    account_todos_root, copy_dir_recursive_merge, legacy_local_todos_root, load_session,
    sanitize_account_user_id, sanitize_workspace_id, set_cached_session, snapshot_from_session,
    validate_server_endpoint, workspace_data_dir, AccountSessionSnapshot, StoredAccountSession,
};
use crate::sync::http_transport::{HttpSyncClient, RemoteAuthSessionInfo, RemoteWorkspaceInfo};
use crate::sync::outbox::has_pending_outbox_for_workspace;
use crate::todos::model::merge_imported_todo_index;
use crate::todos::store::{
    clear_todo_content_cache, read_todo_index_unlocked, todo_index_path_in_root,
    todo_state_from_index_unlocked, with_todo_store_lock, write_todo_index_unlocked,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchAccountSessionPayload {
    pub user_id: String,
    pub display_name: Option<String>,
    pub server_endpoint: Option<String>,
    pub workspace_id: Option<String>,
    pub token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginWithPasswordPayload {
    pub user_id: String,
    pub password: String,
    pub server_endpoint: String,
    pub workspace_id: Option<String>,
    pub device_label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordPayload {
    pub old_password: String,
    pub new_password: String,
    #[serde(default)]
    pub revoke_all: bool,
}

fn validate_workspace_transition(
    app: &AppHandle,
    user_id: &str,
    existing_workspace: &str,
    next_workspace: &str,
) -> Result<bool, String> {
    let existing_norm = sanitize_workspace_id(Some(existing_workspace))?;
    let next_norm = sanitize_workspace_id(Some(next_workspace))?;
    if existing_norm == next_norm {
        return Ok(false);
    }
    if has_pending_outbox_for_workspace(app, user_id, &existing_norm)? {
        return Err(
            "切换同步工作区前请先同步或清空该账号本地待上传队列，避免不同空间数据串联".to_string(),
        );
    }
    Ok(true)
}

fn apply_account_session_sync(
    app: &AppHandle,
    user_id: String,
    display_name: Option<String>,
    server_endpoint: Option<String>,
    workspace_id: String,
    supplied_token: Option<String>,
) -> Result<AccountSessionSnapshot, String> {
    let existing_profile = load_account_sync_profile(app, &user_id)?;
    let token_present = supplied_token.is_some() || has_account_token(app, &user_id);
    if server_endpoint.is_some() && !token_present {
        return Err("已填写同步服务端地址时，必须提供有效的访问 Token".to_string());
    }
    let workspace_changed = validate_workspace_transition(
        app,
        &user_id,
        &existing_profile.workspace_id,
        &workspace_id,
    )?;

    if let Some(ref token) = supplied_token {
        store_account_token(app, &user_id, token)?;
    }

    let resolved_name = match display_name {
        Some(ref raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                existing_profile.display_name.clone()
            } else {
                Some(trimmed.to_string())
            }
        }
        None => existing_profile.display_name.clone(),
    };

    let (next_cursor, next_sync_at) = if workspace_changed {
        (None, None)
    } else {
        (
            existing_profile.last_sync_cursor,
            existing_profile.last_sync_at,
        )
    };

    let next_profile = StoredAccountSyncProfile {
        display_name: resolved_name.clone(),
        server_endpoint: server_endpoint.clone(),
        workspace_id: workspace_id.clone(),
        last_sync_cursor: next_cursor.clone(),
        last_sync_at: next_sync_at.clone(),
    };
    save_account_sync_profile(app, &user_id, &next_profile)?;

    let user_todos_dir = workspace_data_dir(app, &user_id, &workspace_id)?.join("todos");
    let next = StoredAccountSession {
        version: 1,
        active_user_id: Some(user_id),
        display_name: resolved_name,
        server_endpoint,
        workspace_id,
        has_token: token_present,
        last_sync_cursor: next_cursor,
        last_sync_at: next_sync_at,
    };
    let snapshot = snapshot_from_session(&next);

    with_todo_store_lock(app, |store| {
        crate::sync::stop_realtime_sync(app);
        if workspace_changed && user_todos_dir.exists() {
            fs::remove_dir_all(&user_todos_dir).map_err(|err| {
                format!(
                    "切换工作区时清理本地缓存目录失败 {}: {err}",
                    user_todos_dir.display()
                )
            })?;
        }
        set_cached_session(app, next)?;
        clear_todo_content_cache(store);
        Ok(())
    })?;

    crate::todos::commands::refresh_and_emit_active_todo_state(app)?;
    if let Err(err) = crate::quick_notes::refresh_and_emit_active_quick_notes_state(app) {
        eprintln!("[TIDYDESK] Failed to refresh quick notes after workspace switch: {err}");
    }
    emit_account_workspace_refreshed(app, &snapshot)?;
    Ok(snapshot)
}

fn build_active_http_client(app: &AppHandle) -> Result<HttpSyncClient, String> {
    let session = load_session(app)?;
    let user_id = session
        .active_user_id
        .as_deref()
        .ok_or_else(|| "纯本地模式未登录远端账号".to_string())?;
    let endpoint = session
        .server_endpoint
        .as_deref()
        .ok_or_else(|| "当前账号未配置同步服务端地址".to_string())?;
    let token = load_account_token(app, user_id)?
        .ok_or_else(|| "缺少有效的账号 Token，请重新登录后重试".to_string())?;
    HttpSyncClient::new(endpoint, user_id, &token)?.with_workspace(&session.workspace_id)
}

fn emit_account_workspace_refreshed(
    app: &AppHandle,
    snapshot: &AccountSessionSnapshot,
) -> Result<(), String> {
    crate::sticky_notes::reload_sticky_notes_for_active_account(app);
    for label in ["handle", "main", "todos", "capture"] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .emit("account-session-changed", snapshot.clone())
                .map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn accounts_get_session(app: AppHandle) -> Result<AccountSessionSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session = load_session(&app)?;
        Ok(snapshot_from_session(&session))
    })
    .await
    .map_err(|err| format!("account session read task failed: {err}"))?
}

/// Switch active account context using only Token and User ID validation;
/// never triggers remote data pulls during sign-in or switches.
#[tauri::command]
pub async fn accounts_switch_session(
    app: AppHandle,
    payload: SwitchAccountSessionPayload,
) -> Result<AccountSessionSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let user_id = sanitize_account_user_id(&payload.user_id)?;
        let existing_profile = load_account_sync_profile(&app, &user_id)?;
        let server_endpoint = match payload.server_endpoint {
            Some(ref raw) => validate_server_endpoint(Some(raw.as_str()))?,
            None => existing_profile.server_endpoint.clone(),
        };
        let workspace_id = match payload.workspace_id {
            Some(ref raw) => sanitize_workspace_id(Some(raw.as_str()))?,
            None => sanitize_workspace_id(Some(&existing_profile.workspace_id))?,
        };
        let supplied_token = payload
            .token
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string);

        apply_account_session_sync(
            &app,
            user_id,
            payload.display_name,
            server_endpoint,
            workspace_id,
            supplied_token,
        )
    })
    .await
    .map_err(|err| format!("account session switch task failed: {err}"))?
}

/// Authenticate via User ID and password without coupling any business data pull.
#[tauri::command]
pub async fn accounts_login_with_password(
    app: AppHandle,
    payload: LoginWithPasswordPayload,
) -> Result<AccountSessionSnapshot, String> {
    let user_id = sanitize_account_user_id(&payload.user_id)?;
    let endpoint = validate_server_endpoint(Some(&payload.server_endpoint))?
        .ok_or_else(|| "请输入有效的服务端地址".to_string())?;
    let requested_ws = payload.workspace_id.clone();

    let (target_workspace, device_label) = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let user_id = user_id.clone();
        move || {
            let existing = load_account_sync_profile(&app, &user_id)?;
            let next_ws = match requested_ws {
                Some(ref raw) => sanitize_workspace_id(Some(raw.as_str()))?,
                None => sanitize_workspace_id(Some(&existing.workspace_id))?,
            };
            validate_workspace_transition(&app, &user_id, &existing.workspace_id, &next_ws)?;
            Ok::<_, String>((
                next_ws,
                payload
                    .device_label
                    .filter(|v| !v.trim().is_empty())
                    .unwrap_or_else(|| "TidyDesk Desktop".to_string()),
            ))
        }
    })
    .await
    .map_err(|err| format!("pre-login workspace validation failed: {err}"))??;

    let login_res =
        HttpSyncClient::login_with_password(&endpoint, &user_id, &payload.password, &device_label)
            .await?;

    let verify_client = HttpSyncClient::new(&endpoint, &login_res.user_id, &login_res.token)?
        .with_workspace(&target_workspace)?;
    if let Err(err) = verify_client.verify_credentials().await {
        let _ = verify_client.logout_session().await;
        return Err(err);
    }

    tauri::async_runtime::spawn_blocking(move || {
        apply_account_session_sync(
            &app,
            login_res.user_id,
            Some(login_res.display_name),
            Some(endpoint),
            target_workspace,
            Some(login_res.token),
        )
    })
    .await
    .map_err(|err| format!("account login persistence failed: {err}"))?
}

#[tauri::command]
pub async fn accounts_change_password(
    app: AppHandle,
    payload: ChangePasswordPayload,
) -> Result<(), String> {
    let revoke_all = payload.revoke_all;
    let app_for_client = app.clone();
    let client =
        tauri::async_runtime::spawn_blocking(move || build_active_http_client(&app_for_client))
            .await
            .map_err(|err| format!("load active HTTP client failed: {err}"))??;
    client
        .change_password(&payload.old_password, &payload.new_password, revoke_all)
        .await?;
    if revoke_all {
        crate::sync::stop_realtime_sync(&app);
    }
    Ok(())
}

#[tauri::command]
pub async fn accounts_list_remote_sessions(
    app: AppHandle,
) -> Result<Vec<RemoteAuthSessionInfo>, String> {
    let client = tauri::async_runtime::spawn_blocking(move || build_active_http_client(&app))
        .await
        .map_err(|err| format!("load active HTTP client failed: {err}"))??;
    client.list_remote_sessions().await
}

#[tauri::command]
pub async fn accounts_revoke_remote_session(
    app: AppHandle,
    token_id: String,
) -> Result<(), String> {
    let client = tauri::async_runtime::spawn_blocking(move || build_active_http_client(&app))
        .await
        .map_err(|err| format!("load active HTTP client failed: {err}"))??;
    client.revoke_remote_session(token_id.trim()).await
}

#[tauri::command]
pub async fn accounts_list_workspaces(app: AppHandle) -> Result<Vec<RemoteWorkspaceInfo>, String> {
    let client = tauri::async_runtime::spawn_blocking(move || build_active_http_client(&app))
        .await
        .map_err(|err| format!("load active HTTP client failed: {err}"))??;
    client.list_workspaces().await
}

#[tauri::command]
pub async fn accounts_logout_to_local(app: AppHandle) -> Result<AccountSessionSnapshot, String> {
    let active_client = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || build_active_http_client(&app)
    })
    .await
    .ok()
    .and_then(|res| res.ok());

    if let Some(client) = active_client {
        if let Err(err) = client.logout_session().await {
            eprintln!("[WARN] Failed to revoke remote session token during logout: {err}");
        }
    }

    tauri::async_runtime::spawn_blocking(move || {
        let next = StoredAccountSession::default();
        let snapshot = snapshot_from_session(&next);

        with_todo_store_lock(&app, |store| {
            crate::sync::stop_realtime_sync(&app);
            set_cached_session(&app, next)?;
            clear_todo_content_cache(store);
            Ok(())
        })?;

        crate::todos::commands::refresh_and_emit_active_todo_state(&app)?;
        if let Err(err) = crate::quick_notes::refresh_and_emit_active_quick_notes_state(&app) {
            eprintln!("[TIDYDESK] Failed to refresh quick notes after logout: {err}");
        }
        emit_account_workspace_refreshed(&app, &snapshot)?;
        Ok(snapshot)
    })
    .await
    .map_err(|err| format!("account logout task failed: {err}"))?
}

#[tauri::command]
pub async fn accounts_import_local_todos(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session = load_session(&app)?;
        let Some(user_id) = session.active_user_id else {
            return Err("当前已处于本地默认工作区，无需导入".to_string());
        };

        let legacy_root = legacy_local_todos_root(&app)?;
        let legacy_index_path = todo_index_path_in_root(&legacy_root);
        if !legacy_index_path.exists() {
            return Ok(json!({ "importedCards": 0 }));
        }

        let target_root = account_todos_root(&app)?;
        let imported_cards = with_todo_store_lock(&app, |store| {
            let legacy_raw = fs::read_to_string(&legacy_index_path)
                .map_err(|err| format!("读取本地默认待办失败: {err}"))?;
            let legacy_index: Value = serde_json::from_str(&legacy_raw)
                .map_err(|err| format!("解析本地默认待办失败: {err}"))?;

            copy_dir_recursive_merge(&legacy_root.join("cards"), &target_root.join("cards"))?;
            copy_dir_recursive_merge(
                &legacy_root.join("attachments"),
                &target_root.join("attachments"),
            )?;

            let current_index = read_todo_index_unlocked(&app)?;
            let (merged_index, imported_cards) =
                merge_imported_todo_index(current_index, &legacy_index, &user_id);

            write_todo_index_unlocked(&app, &merged_index)?;
            clear_todo_content_cache(store);
            let counts = crate::todos::model::todo_counts(&merged_index);
            let _ = todo_state_from_index_unlocked(&app, store, &merged_index, counts)?;
            crate::todos::commands::enqueue_imported_cards_outbox(&app, store, &imported_cards)?;
            Ok(imported_cards.len())
        })?;

        crate::todos::commands::refresh_and_emit_active_todo_state(&app)?;
        Ok(json!({ "importedCards": imported_cards }))
    })
    .await
    .map_err(|err| format!("import local todos task failed: {err}"))?
}
