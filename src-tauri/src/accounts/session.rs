use super::credentials::{
    load_account_sync_profile, save_account_sync_profile, DEFAULT_WORKSPACE_ID,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use url::Url;

const ACCOUNT_SESSION_FILE: &str = "account-session.json";

fn default_workspace_id() -> String {
    DEFAULT_WORKSPACE_ID.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAccountSession {
    #[serde(default = "default_session_version")]
    pub version: u8,
    #[serde(default)]
    pub active_user_id: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub server_endpoint: Option<String>,
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    #[serde(default)]
    pub has_token: bool,
    #[serde(default)]
    pub last_sync_cursor: Option<String>,
    #[serde(default)]
    pub last_sync_at: Option<String>,
}

impl Default for StoredAccountSession {
    fn default() -> Self {
        Self {
            version: default_session_version(),
            active_user_id: None,
            display_name: None,
            server_endpoint: None,
            workspace_id: default_workspace_id(),
            has_token: false,
            last_sync_cursor: None,
            last_sync_at: None,
        }
    }
}

fn default_session_version() -> u8 {
    1
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSessionSnapshot {
    pub auth_mode: &'static str,
    pub active_user_id: Option<String>,
    pub display_name: Option<String>,
    pub server_endpoint: Option<String>,
    pub workspace_id: String,
    pub has_token: bool,
    pub last_sync_cursor: Option<String>,
    pub last_sync_at: Option<String>,
    pub sync_enabled: bool,
}

#[derive(Debug, Default)]
pub struct AccountSessionState {
    cached: Mutex<Option<StoredAccountSession>>,
}

pub fn sanitize_workspace_id(raw: Option<&str>) -> Result<String, String> {
    let trimmed = raw.map(str::trim).unwrap_or("");
    if trimmed.is_empty() {
        return Ok(default_workspace_id());
    }
    if trimmed.len() > 64 {
        return Err("工作区 ID 长度不能超过 64 个字符".to_string());
    }
    if !trimmed
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b':')
    {
        return Err("工作区 ID 仅支持字母、数字、下划线、连字符和冒号".to_string());
    }
    if let Some(owner) = trimmed.strip_prefix("private:") {
        sanitize_account_user_id(owner)?;
    }
    Ok(trimmed.to_string())
}

pub fn sanitize_account_user_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err("账号 ID 长度必须在 1~64 个字符之间".to_string());
    }
    if trimmed.eq_ignore_ascii_case("local") {
        return Err("local 为保留本地工作区名称，请使用其他账号 ID".to_string());
    }
    if !trimmed
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("账号 ID 仅支持字母、数字、下划线和连字符".to_string());
    }
    Ok(trimmed.to_string())
}

pub fn validate_server_endpoint(raw: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = raw.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    let parsed = Url::parse(value).map_err(|err| format!("服务端地址格式无效: {err}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("服务端地址仅支持 http 或 https 协议".to_string());
    }
    if parsed.host_str().is_none() {
        return Err("服务端地址缺少有效主机名".to_string());
    }
    Ok(Some(value.trim_end_matches('/').to_string()))
}

fn session_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(ACCOUNT_SESSION_FILE))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

fn read_session_from_disk(app: &AppHandle) -> Result<StoredAccountSession, String> {
    let path = session_file_path(app)?;
    match fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<StoredAccountSession>(&raw) {
            Ok(mut parsed) => {
                parsed.active_user_id = parsed
                    .active_user_id
                    .as_deref()
                    .and_then(|id| sanitize_account_user_id(id).ok());
                if parsed.active_user_id.is_none() {
                    parsed.display_name = None;
                    parsed.server_endpoint = None;
                    parsed.workspace_id = default_workspace_id();
                    parsed.has_token = false;
                } else {
                    parsed.server_endpoint =
                        validate_server_endpoint(parsed.server_endpoint.as_deref())
                            .ok()
                            .flatten();
                    parsed.workspace_id = sanitize_workspace_id(Some(&parsed.workspace_id))
                        .unwrap_or_else(|_| default_workspace_id());
                }
                Ok(parsed)
            }
            Err(_) => {
                crate::persistence::backup_corrupt_file(&path, "account session")?;
                Ok(StoredAccountSession::default())
            }
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Ok(StoredAccountSession::default())
        }
        Err(err) => Err(format!("failed to read account session: {err}")),
    }
}

pub(super) fn write_session_file(
    app: &AppHandle,
    session: &StoredAccountSession,
) -> Result<(), String> {
    let path = session_file_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create session directory: {err}"))?;
    }
    crate::persistence::atomic_write_json_fast(&path, session, "account session")
}

pub fn load_session(app: &AppHandle) -> Result<StoredAccountSession, String> {
    let state = app.state::<AccountSessionState>();
    let mut guard = state
        .cached
        .lock()
        .map_err(|_| "failed to lock account session state".to_string())?;
    if let Some(existing) = guard.as_ref() {
        return Ok(existing.clone());
    }
    let loaded = read_session_from_disk(app)?;
    *guard = Some(loaded.clone());
    Ok(loaded)
}

pub(super) fn set_cached_session(
    app: &AppHandle,
    next: StoredAccountSession,
) -> Result<(), String> {
    write_session_file(app, &next)?;
    let state = app.state::<AccountSessionState>();
    let mut guard = state
        .cached
        .lock()
        .map_err(|_| "failed to lock account session state".to_string())?;
    *guard = Some(next);
    Ok(())
}

pub fn snapshot_from_session(session: &StoredAccountSession) -> AccountSessionSnapshot {
    let is_account = session.active_user_id.is_some();
    AccountSessionSnapshot {
        auth_mode: if is_account { "account" } else { "local" },
        active_user_id: session.active_user_id.clone(),
        display_name: session.display_name.clone(),
        server_endpoint: session.server_endpoint.clone(),
        workspace_id: sanitize_workspace_id(Some(&session.workspace_id))
            .unwrap_or_else(|_| default_workspace_id()),
        has_token: session.has_token,
        last_sync_cursor: session.last_sync_cursor.clone(),
        last_sync_at: session.last_sync_at.clone(),
        sync_enabled: is_account && session.server_endpoint.is_some(),
    }
}

pub fn current_actor_id(app: &AppHandle) -> String {
    load_session(app)
        .ok()
        .and_then(|session| session.active_user_id)
        .unwrap_or_else(|| "local".to_string())
}

pub fn is_account_sync_active(app: &AppHandle) -> bool {
    load_session(app)
        .map(|session| session.active_user_id.is_some())
        .unwrap_or(false)
}

pub fn account_workspace_dir(app: &AppHandle, user_id: &str) -> Result<PathBuf, String> {
    let safe_id = sanitize_account_user_id(user_id)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data directory: {err}"))?;
    let accounts_root = app_data.join("accounts");
    let workspace = accounts_root.join(safe_id);
    if !crate::is_path_inside(&workspace, &accounts_root) {
        return Err("Unsafe account workspace path".to_string());
    }
    Ok(workspace)
}

pub fn legacy_local_todos_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("todos"))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

pub fn account_todos_root(app: &AppHandle) -> Result<PathBuf, String> {
    let session = load_session(app)?;
    match session.active_user_id {
        Some(uid) => Ok(account_workspace_dir(app, &uid)?.join("todos")),
        None => legacy_local_todos_root(app),
    }
}

pub fn account_quick_notes_root(app: &AppHandle) -> Result<PathBuf, String> {
    let session = load_session(app)?;
    match session.active_user_id {
        Some(uid) => account_workspace_dir(app, &uid),
        None => crate::files::file_storage_root(app),
    }
}

pub fn account_sync_root(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let session = load_session(app)?;
    match session.active_user_id {
        Some(uid) => Ok(Some(account_workspace_dir(app, &uid)?)),
        None => Ok(None),
    }
}

pub fn update_sync_cursor_and_timestamp(
    app: &AppHandle,
    cursor: Option<String>,
    synced_at: String,
) -> Result<AccountSessionSnapshot, String> {
    let mut session = load_session(app)?;
    session.last_sync_cursor = cursor.clone();
    session.last_sync_at = Some(synced_at.clone());
    if let Some(user_id) = session.active_user_id.as_deref() {
        let mut profile = load_account_sync_profile(app, user_id)?;
        profile.display_name = session.display_name.clone();
        profile.server_endpoint = session.server_endpoint.clone();
        profile.workspace_id = session.workspace_id.clone();
        profile.last_sync_cursor = cursor;
        profile.last_sync_at = Some(synced_at);
        save_account_sync_profile(app, user_id, &profile)?;
    }
    let snapshot = snapshot_from_session(&session);
    set_cached_session(app, session)?;
    Ok(snapshot)
}

pub(super) fn copy_dir_recursive_merge(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }
    fs::create_dir_all(dst)
        .map_err(|err| format!("failed to create dir {}: {err}", dst.display()))?;
    for entry in
        fs::read_dir(src).map_err(|err| format!("failed to read dir {}: {err}", src.display()))?
    {
        let entry = entry.map_err(|err| format!("failed to inspect entry: {err}"))?;
        let file_type = entry
            .file_type()
            .map_err(|err| format!("failed to read file type: {err}"))?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive_merge(&entry.path(), &target)?;
        } else if file_type.is_file() && !target.exists() {
            fs::copy(entry.path(), &target)
                .map_err(|err| format!("failed to copy {}: {err}", target.display()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_account_user_id_accepts_safe_ids_and_rejects_traversal() {
        assert_eq!(
            sanitize_account_user_id("user_01-alpha").unwrap(),
            "user_01-alpha"
        );
        assert!(sanitize_account_user_id("").is_err());
        assert!(sanitize_account_user_id("local").is_err());
        assert!(sanitize_account_user_id("../evil").is_err());
        assert!(sanitize_account_user_id("user/name").is_err());
        assert!(sanitize_account_user_id("user name").is_err());
    }

    #[test]
    fn validate_server_endpoint_accepts_http_and_rejects_unsafe_schemes() {
        assert_eq!(
            validate_server_endpoint(Some("https://sync.example.com/")).unwrap(),
            Some("https://sync.example.com".to_string())
        );
        assert_eq!(validate_server_endpoint(Some("   ")).unwrap(), None);
        assert!(validate_server_endpoint(Some("file:///C:/secret")).is_err());
        assert!(validate_server_endpoint(Some("javascript:alert(1)")).is_err());
    }

    #[test]
    fn sanitize_workspace_id_validates_shared_and_private_names() {
        assert_eq!(sanitize_workspace_id(None).unwrap(), "default");
        assert_eq!(sanitize_workspace_id(Some("  ")).unwrap(), "default");
        assert_eq!(
            sanitize_workspace_id(Some("private:alice")).unwrap(),
            "private:alice"
        );
        assert!(sanitize_workspace_id(Some("private:local")).is_err());
        assert!(sanitize_workspace_id(Some("../secret")).is_err());
    }
}
