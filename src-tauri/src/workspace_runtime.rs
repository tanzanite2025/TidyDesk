use crate::accounts::session::{
    effective_storage_scope, load_session, reload_active_profile_into_session, set_cached_session,
    sync_profile_backup_path, workspace_data_dir, AccountSessionSnapshot, StoredAccountSession,
};
use crate::todos::store::{
    clear_todo_content_cache, clear_todos_tables_in_db, todo_backup_root, with_todo_store_lock,
};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

/// Compute stable backup scope identifier for the active local or account workspace.
pub(crate) fn active_workspace_scope_id(app: &AppHandle) -> Result<String, String> {
    let session = load_session(app)?;
    Ok(match effective_storage_scope(&session) {
        Some((uid, ws)) => format!("{uid}:{ws}"),
        None => "local".to_string(),
    })
}

pub(crate) struct WorkspaceBackupEntry {
    pub archive_prefix: String,
    pub path: PathBuf,
    pub is_dir: bool,
}

pub(crate) struct WorkspaceBackupCollection {
    pub scope_id: String,
    pub entries: Vec<WorkspaceBackupEntry>,
}

/// Collect backup source/target specifications from each owning storage module rather than hardcoding internal module filenames.
pub(crate) fn collect_workspace_backup_pairs(
    app: &AppHandle,
) -> Result<WorkspaceBackupCollection, String> {
    let scope_id = active_workspace_scope_id(app)?;
    let mut entries = vec![
        WorkspaceBackupEntry {
            archive_prefix: "todos".to_string(),
            path: todo_backup_root(app)?,
            is_dir: true,
        },
        WorkspaceBackupEntry {
            archive_prefix: "quick-notes.json".to_string(),
            path: crate::quick_notes::quick_notes_backup_path(app)?,
            is_dir: false,
        },
        WorkspaceBackupEntry {
            archive_prefix: "sticky-notes.json".to_string(),
            path: crate::sticky_notes::sticky_notes_path(app)?,
            is_dir: false,
        },
        WorkspaceBackupEntry {
            archive_prefix: "hotkeys.json".to_string(),
            path: crate::hotkeys::hotkey_settings_path(app)?,
            is_dir: false,
        },
    ];

    if let Some(outbox_path) = crate::sync::outbox::outbox_backup_path(app)? {
        entries.push(WorkspaceBackupEntry {
            archive_prefix: "sync-outbox.json".to_string(),
            path: outbox_path,
            is_dir: false,
        });
    }
    if let Some(profile_path) = sync_profile_backup_path(app)? {
        entries.push(WorkspaceBackupEntry {
            archive_prefix: "sync-profile.json".to_string(),
            path: profile_path,
            is_dir: false,
        });
    }

    let db_path = crate::local_db::workspace_db_path(app)?;
    let db_prefix = db_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("无法解析 SQLite 数据库文件名: {}", db_path.display()))?
        .to_string();
    entries.push(WorkspaceBackupEntry {
        archive_prefix: db_prefix,
        path: db_path,
        is_dir: false,
    });

    Ok(WorkspaceBackupCollection { scope_id, entries })
}

/// Atomically transition the active account/workspace session under the store lock and optionally reset stale cached todos for the destination workspace.
pub(crate) fn apply_workspace_session_transition(
    app: &AppHandle,
    next: StoredAccountSession,
    reset_target_todos_scope: Option<(&str, &str)>,
) -> Result<(), String> {
    with_todo_store_lock(app, |store| {
        crate::sync::stop_realtime_sync(app);
        if let Some((user_id, workspace_id)) = reset_target_todos_scope {
            let user_todos_dir = workspace_data_dir(app, user_id, workspace_id)?.join("todos");
            let target_db_path =
                crate::local_db::workspace_db_path_for(app, user_id, workspace_id)?;
            if user_todos_dir.exists() {
                fs::remove_dir_all(&user_todos_dir).map_err(|err| {
                    format!(
                        "切换工作区时清理本地缓存目录失败 {}: {err}",
                        user_todos_dir.display()
                    )
                })?;
            }
            clear_todos_tables_in_db(&target_db_path)?;
        }
        set_cached_session(app, next)?;
        clear_todo_content_cache(store);
        Ok(())
    })
}

/// Broadcast workspace change and rehydrate every active desktop module cleanly after account switch, logout, or snapshot restore.
pub(crate) fn refresh_all_workspace_modules(
    app: &AppHandle,
    explicit_snapshot: Option<&AccountSessionSnapshot>,
) -> Result<(), String> {
    if let Some(snapshot) = explicit_snapshot {
        app.emit("account-session-changed", snapshot.clone())
            .map_err(|err| format!("failed to emit account session refresh: {err}"))?;
    } else if let Some(reloaded) = reload_active_profile_into_session(app)? {
        app.emit("account-session-changed", reloaded)
            .map_err(|err| format!("failed to emit account session refresh: {err}"))?;
    }

    crate::todos::commands::refresh_and_emit_active_todo_state(app)?;
    if let Err(err) = crate::todos::emit_unread_comment_summary(app) {
        eprintln!("[TIDYDESK] Failed to emit comment unread summary after workspace switch: {err}");
    }
    if let Err(err) = crate::quick_notes::refresh_and_emit_active_quick_notes_state(app) {
        eprintln!("[TIDYDESK] Failed to refresh quick notes after workspace switch: {err}");
    }
    crate::sticky_notes::reload_sticky_notes_for_active_account(app);
    Ok(())
}
