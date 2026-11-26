use super::credentials::{
    has_account_token, load_account_sync_profile, load_account_token, save_account_sync_profile,
    store_account_token, StoredAccountSyncProfile,
};
use super::session::{
    account_todos_root, copy_dir_recursive_merge, legacy_local_todos_root, load_session,
    sanitize_account_user_id, sanitize_workspace_id, snapshot_from_session,
    validate_server_endpoint, AccountSessionSnapshot, StoredAccountSession,
};
use crate::sync::http_transport::{
    HttpSyncClient, RemoteAuthSessionInfo, RemoteWorkspaceInfo, WorkspaceInviteInfo,
    WorkspaceMemberInfo,
};
use crate::sync::outbox::has_pending_outbox_for_workspace;
use crate::todos::model::merge_imported_todo_index;
use crate::todos::store::{
    clear_todo_content_cache, load_local_todos_snapshot_for_import, read_todo_index_unlocked,
    save_todo_index_with_contents_unlocked, todo_state_from_index_unlocked, with_todo_store_lock,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

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
pub struct RegisterWithPasswordPayload {
    pub user_id: String,
    pub password: String,
    pub display_name: Option<String>,
    pub server_endpoint: String,
    pub device_label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSharedWorkspacePayload {
    pub title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceInvitePayload {
    pub workspace_id: String,
    pub role: Option<String>,
    pub max_uses: Option<i64>,
    pub expires_in_hours: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevokeWorkspaceInvitePayload {
    pub workspace_id: String,
    pub invite_code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinWorkspaceByInvitePayload {
    pub invite_code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogoutToLocalPayload {
    #[serde(default)]
    pub keep_local_continuity: Option<bool>,
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

    let next = StoredAccountSession {
        version: 1,
        active_user_id: Some(user_id.clone()),
        display_name: resolved_name,
        server_endpoint,
        workspace_id: workspace_id.clone(),
        has_token: token_present,
        last_sync_cursor: next_cursor,
        last_sync_at: next_sync_at,
        detached_user_id: None,
        detached_workspace_id: None,
    };
    let snapshot = snapshot_from_session(&next);

    crate::workspace_runtime::apply_workspace_session_transition(app, next, None)?;
    crate::workspace_runtime::refresh_all_workspace_modules(app, Some(&snapshot))?;
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

/// Self-register a new account, validate credentials strictly without pulling remote business data,
/// and non-destructively carry over existing pure-local Todos/Notes into the new private workspace.
#[tauri::command]
pub async fn accounts_register_with_password(
    app: AppHandle,
    payload: RegisterWithPasswordPayload,
) -> Result<AccountSessionSnapshot, String> {
    let user_id = sanitize_account_user_id(&payload.user_id)?;
    if payload.password.len() < 4 {
        return Err("密码长度至少需要 4 个字符".to_string());
    }
    let endpoint = validate_server_endpoint(Some(&payload.server_endpoint))?
        .ok_or_else(|| "请输入有效的服务端地址".to_string())?;
    let device_label = payload
        .device_label
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "TidyDesk Desktop".to_string());

    let was_pure_local = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            let current = load_session(&app)?;
            Ok::<_, String>(current.active_user_id.is_none() && current.detached_user_id.is_none())
        }
    })
    .await
    .map_err(|err| format!("pre-register session inspection failed: {err}"))??;

    let reg_res = HttpSyncClient::register_with_password(
        &endpoint,
        &user_id,
        &payload.password,
        payload.display_name.as_deref(),
        &device_label,
    )
    .await?;

    let target_workspace = reg_res
        .default_workspace_id
        .clone()
        .unwrap_or_else(|| format!("private:{}", reg_res.user_id));

    let verify_client = HttpSyncClient::new(&endpoint, &reg_res.user_id, &reg_res.token)?
        .with_workspace(&target_workspace)?;
    if let Err(err) = verify_client.verify_credentials().await {
        let _ = verify_client.logout_session().await;
        return Err(err);
    }

    tauri::async_runtime::spawn_blocking(move || {
        let snapshot = apply_account_session_sync(
            &app,
            reg_res.user_id.clone(),
            Some(reg_res.display_name),
            Some(endpoint),
            target_workspace,
            Some(reg_res.token),
        )?;
        if was_pure_local {
            auto_carryover_local_data_into_active_scope(&app, &reg_res.user_id)?;
        }
        Ok(snapshot)
    })
    .await
    .map_err(|err| format!("account register persistence failed: {err}"))?
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
pub async fn accounts_list_workspace_members(
    app: AppHandle,
    workspace_id: Option<String>,
) -> Result<Vec<WorkspaceMemberInfo>, String> {
    let (client, target_workspace_id) = tauri::async_runtime::spawn_blocking(move || {
        let session = load_session(&app)?;
        let ws = workspace_id
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(|raw| sanitize_workspace_id(Some(raw)))
            .transpose()?
            .unwrap_or(session.workspace_id);
        let client = build_active_http_client(&app)?;
        Ok::<_, String>((client, ws))
    })
    .await
    .map_err(|err| format!("load workspace members task failed: {err}"))??;
    client.list_workspace_members(&target_workspace_id).await
}

#[tauri::command]
pub async fn accounts_create_workspace(
    app: AppHandle,
    payload: CreateSharedWorkspacePayload,
) -> Result<RemoteWorkspaceInfo, String> {
    let client = tauri::async_runtime::spawn_blocking(move || build_active_http_client(&app))
        .await
        .map_err(|err| format!("load active HTTP client failed: {err}"))??;
    client.create_shared_workspace(&payload.title).await
}

#[tauri::command]
pub async fn accounts_create_workspace_invite(
    app: AppHandle,
    payload: CreateWorkspaceInvitePayload,
) -> Result<WorkspaceInviteInfo, String> {
    let client = tauri::async_runtime::spawn_blocking(move || build_active_http_client(&app))
        .await
        .map_err(|err| format!("load active HTTP client failed: {err}"))??;
    client
        .create_workspace_invite(
            &payload.workspace_id,
            payload.role.as_deref().unwrap_or("member"),
            payload.max_uses.unwrap_or(1),
            payload.expires_in_hours.unwrap_or(72),
        )
        .await
}

#[tauri::command]
pub async fn accounts_list_workspace_invites(
    app: AppHandle,
    workspace_id: String,
) -> Result<Vec<WorkspaceInviteInfo>, String> {
    let client = tauri::async_runtime::spawn_blocking(move || build_active_http_client(&app))
        .await
        .map_err(|err| format!("load active HTTP client failed: {err}"))??;
    client.list_workspace_invites(&workspace_id).await
}

#[tauri::command]
pub async fn accounts_revoke_workspace_invite(
    app: AppHandle,
    payload: RevokeWorkspaceInvitePayload,
) -> Result<WorkspaceInviteInfo, String> {
    let client = tauri::async_runtime::spawn_blocking(move || build_active_http_client(&app))
        .await
        .map_err(|err| format!("load active HTTP client failed: {err}"))??;
    client
        .revoke_workspace_invite(&payload.workspace_id, &payload.invite_code)
        .await
}

#[tauri::command]
pub async fn accounts_join_workspace_by_invite(
    app: AppHandle,
    payload: JoinWorkspaceByInvitePayload,
) -> Result<RemoteWorkspaceInfo, String> {
    let client = tauri::async_runtime::spawn_blocking(move || build_active_http_client(&app))
        .await
        .map_err(|err| format!("load active HTTP client failed: {err}"))??;
    client.join_workspace_by_invite(&payload.invite_code).await
}

#[tauri::command]
pub async fn accounts_logout_to_local(
    app: AppHandle,
    payload: Option<LogoutToLocalPayload>,
) -> Result<AccountSessionSnapshot, String> {
    let keep_continuity = payload
        .and_then(|p| p.keep_local_continuity)
        .unwrap_or(true);
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
        let current = load_session(&app)?;
        let (detached_user_id, detached_workspace_id) = if keep_continuity {
            match current.active_user_id.or(current.detached_user_id) {
                Some(uid) => (
                    Some(uid),
                    Some(
                        current
                            .detached_workspace_id
                            .unwrap_or_else(|| current.workspace_id.clone()),
                    ),
                ),
                None => (None, None),
            }
        } else {
            (None, None)
        };

        let next = StoredAccountSession {
            detached_user_id,
            detached_workspace_id,
            ..StoredAccountSession::default()
        };
        let snapshot = snapshot_from_session(&next);

        crate::workspace_runtime::apply_workspace_session_transition(&app, next, None)?;
        crate::workspace_runtime::refresh_all_workspace_modules(&app, Some(&snapshot))?;
        Ok(snapshot)
    })
    .await
    .map_err(|err| format!("account logout task failed: {err}"))?
}

fn import_local_todos_into_active_scope(app: &AppHandle, user_id: &str) -> Result<usize, String> {
    let legacy_root = legacy_local_todos_root(app)?;
    let target_root = account_todos_root(app)?;
    let imported_cards = with_todo_store_lock(app, |store| {
        let Some(local_snapshot) = load_local_todos_snapshot_for_import(app)? else {
            return Ok(0usize);
        };
        let legacy_index = local_snapshot.index;
        let local_contents = local_snapshot.contents;

        copy_dir_recursive_merge(
            &legacy_root.join("attachments"),
            &target_root.join("attachments"),
        )?;

        let current_index = read_todo_index_unlocked(app)?;
        let (merged_index, imported_cards) =
            merge_imported_todo_index(current_index, &legacy_index, user_id);

        let imported_contents: Vec<(&str, &str)> = imported_cards
            .iter()
            .filter_map(|card| {
                let card_id = card["id"].as_str()?;
                let body = local_contents
                    .get(card_id)
                    .map(String::as_str)
                    .unwrap_or("");
                Some((card_id, body))
            })
            .collect();

        save_todo_index_with_contents_unlocked(app, &merged_index, &imported_contents)?;
        let allowed_card_ids: std::collections::HashSet<String> = merged_index["cards"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|card| card["deletedAt"].is_null())
            .filter_map(|card| card["id"].as_str().map(ToString::to_string))
            .collect();
        let display_name = load_session(app)
            .ok()
            .and_then(|s| s.display_name)
            .unwrap_or_else(|| user_id.to_string());
        let mut target_conn = crate::local_db::open_workspace_db(app)?;
        let imported_comments = crate::todos::import_comments_into_conn(
            &mut target_conn,
            &local_snapshot.comments,
            &allowed_card_ids,
            user_id,
            &display_name,
        )?;
        if !imported_comments.is_empty() && crate::accounts::is_account_sync_active(app) {
            let mut comment_outbox = Vec::with_capacity(imported_comments.len());
            for cmt in &imported_comments {
                let payload = serde_json::to_value(cmt)
                    .map_err(|err| format!("序列化导入评论同步载荷失败: {err}"))?;
                comment_outbox.push(crate::sync::OutboxBatchItem {
                    entity_kind: crate::sync::OutboxEntityKind::CardComment,
                    entity_id: cmt.id.clone(),
                    operation: crate::sync::OutboxOperation::Upsert,
                    payload,
                });
            }
            crate::sync::enqueue_outbox_batch(app, comment_outbox)?;
        }
        clear_todo_content_cache(store);
        let counts = crate::todos::model::todo_counts(&merged_index);
        let _ = todo_state_from_index_unlocked(app, store, &merged_index, counts)?;
        crate::todos::commands::enqueue_imported_cards_outbox(app, store, &imported_cards)?;
        Ok(imported_cards.len())
    })?;

    if imported_cards > 0 {
        crate::todos::commands::refresh_and_emit_active_todo_state(app)?;
    }
    Ok(imported_cards)
}

fn auto_carryover_local_data_into_active_scope(
    app: &AppHandle,
    user_id: &str,
) -> Result<(), String> {
    let should_carry_todos = with_todo_store_lock(app, |_store| {
        let idx = read_todo_index_unlocked(app)?;
        let card_count = idx
            .get("cards")
            .and_then(|v| v.as_array())
            .map(|items| items.iter().filter(|c| c["deletedAt"].is_null()).count())
            .unwrap_or(0);
        Ok(card_count == 0)
    })?;
    if should_carry_todos {
        let _ = import_local_todos_into_active_scope(app, user_id)?;
    }
    let _ = crate::quick_notes::import_local_quick_notes_into_active_scope(app)?;
    Ok(())
}

#[tauri::command]
pub async fn accounts_import_local_todos(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session = load_session(&app)?;
        let Some(user_id) = session.active_user_id else {
            return Err("当前已处于本地模式，无需导入".to_string());
        };
        let imported_cards = import_local_todos_into_active_scope(&app, &user_id)?;
        let _ = crate::quick_notes::import_local_quick_notes_into_active_scope(&app)?;
        Ok(json!({ "importedCards": imported_cards }))
    })
    .await
    .map_err(|err| format!("import local todos task failed: {err}"))?
}
