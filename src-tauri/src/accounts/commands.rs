use super::credentials::{
    has_account_token, load_account_sync_profile, save_account_sync_profile, store_account_token,
    StoredAccountSyncProfile,
};
use super::session::{
    account_todos_root, copy_dir_recursive_merge, legacy_local_todos_root, load_session,
    sanitize_account_user_id, set_cached_session, snapshot_from_session, validate_server_endpoint,
    AccountSessionSnapshot, StoredAccountSession,
};
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
    pub token: Option<String>,
}

fn emit_account_workspace_refreshed(
    app: &AppHandle,
    snapshot: &AccountSessionSnapshot,
) -> Result<(), String> {
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

        let supplied_token = payload
            .token
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty());
        let token_present = supplied_token.is_some() || has_account_token(&app, &user_id);
        if server_endpoint.is_some() && !token_present {
            return Err("已填写同步服务端地址时，必须提供有效的访问 Token".to_string());
        }
        if let Some(token) = supplied_token {
            store_account_token(&app, &user_id, token)?;
        }

        let display_name = match payload.display_name {
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

        let next_profile = StoredAccountSyncProfile {
            display_name: display_name.clone(),
            server_endpoint: server_endpoint.clone(),
            last_sync_cursor: existing_profile.last_sync_cursor,
            last_sync_at: existing_profile.last_sync_at,
        };
        save_account_sync_profile(&app, &user_id, &next_profile)?;

        let next = StoredAccountSession {
            version: 1,
            active_user_id: Some(user_id),
            display_name,
            server_endpoint,
            has_token: token_present,
            last_sync_cursor: next_profile.last_sync_cursor,
            last_sync_at: next_profile.last_sync_at,
        };
        let snapshot = snapshot_from_session(&next);

        with_todo_store_lock(&app, |store| {
            crate::sync::stop_realtime_sync(&app);
            set_cached_session(&app, next)?;
            clear_todo_content_cache(store);
            Ok(())
        })?;

        crate::todos::commands::refresh_and_emit_active_todo_state(&app)?;
        emit_account_workspace_refreshed(&app, &snapshot)?;
        Ok(snapshot)
    })
    .await
    .map_err(|err| format!("account session switch task failed: {err}"))?
}

#[tauri::command]
pub async fn accounts_logout_to_local(app: AppHandle) -> Result<AccountSessionSnapshot, String> {
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
