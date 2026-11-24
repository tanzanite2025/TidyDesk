use super::session::account_workspace_dir;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const ACCOUNT_TOKEN_FILE: &str = "token.dpapi";
const ACCOUNT_SYNC_PROFILE_FILE: &str = "sync-profile.json";

pub const DEFAULT_WORKSPACE_ID: &str = "default";

fn default_workspace_id() -> String {
    DEFAULT_WORKSPACE_ID.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoredAccountSyncProfile {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub server_endpoint: Option<String>,
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    #[serde(default)]
    pub last_sync_cursor: Option<String>,
    #[serde(default)]
    pub last_sync_at: Option<String>,
}

impl Default for StoredAccountSyncProfile {
    fn default() -> Self {
        Self {
            display_name: None,
            server_endpoint: None,
            workspace_id: default_workspace_id(),
            last_sync_cursor: None,
            last_sync_at: None,
        }
    }
}

fn token_file_path(app: &AppHandle, user_id: &str) -> Result<PathBuf, String> {
    Ok(account_workspace_dir(app, user_id)?.join(ACCOUNT_TOKEN_FILE))
}

fn sync_profile_path(app: &AppHandle, user_id: &str) -> Result<PathBuf, String> {
    Ok(account_workspace_dir(app, user_id)?.join(ACCOUNT_SYNC_PROFILE_FILE))
}

#[cfg(target_os = "windows")]
fn protect_token_bytes(plain: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(plain.len()).map_err(|_| "token payload too large".to_string())?,
        pbData: plain.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &input,
            windows::core::PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|err| format!("failed to protect account token via DPAPI: {err}"))?;
    }
    let slice = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
    let protected = slice.to_vec();
    unsafe {
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
    }
    Ok(protected)
}

#[cfg(target_os = "windows")]
fn unprotect_token_bytes(cipher: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(cipher.len()).map_err(|_| "protected token too large".to_string())?,
        pbData: cipher.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|err| format!("failed to decrypt account token via DPAPI: {err}"))?;
    }
    let slice = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
    let plain = slice.to_vec();
    unsafe {
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
    }
    Ok(plain)
}

#[cfg(not(target_os = "windows"))]
fn protect_token_bytes(plain: &[u8]) -> Result<Vec<u8>, String> {
    Ok(plain.to_vec())
}

#[cfg(not(target_os = "windows"))]
fn unprotect_token_bytes(cipher: &[u8]) -> Result<Vec<u8>, String> {
    Ok(cipher.to_vec())
}

fn write_protected_token_to_path(path: &Path, token: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create credential directory: {err}"))?;
    }
    let encrypted = protect_token_bytes(token.as_bytes())?;
    let encoded = BASE64_STANDARD.encode(encrypted);
    crate::persistence::atomic_write_text_fast(path, &encoded, "account token")
}

fn read_protected_token_from_path(path: &Path) -> Result<Option<String>, String> {
    let encoded = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("failed to read protected account token: {err}")),
    };
    let cipher = BASE64_STANDARD
        .decode(encoded.trim())
        .map_err(|err| format!("invalid encoded account token: {err}"))?;
    let plain = unprotect_token_bytes(&cipher)?;
    let token =
        String::from_utf8(plain).map_err(|err| format!("decoded token is not UTF-8: {err}"))?;
    Ok(Some(token).filter(|v| !v.trim().is_empty()))
}

pub fn store_account_token(app: &AppHandle, user_id: &str, token: &str) -> Result<(), String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return Err("访问 Token 不能为空".to_string());
    }
    let path = token_file_path(app, user_id)?;
    write_protected_token_to_path(&path, trimmed)
}

pub fn load_account_token(app: &AppHandle, user_id: &str) -> Result<Option<String>, String> {
    let path = token_file_path(app, user_id)?;
    read_protected_token_from_path(&path)
}

pub fn has_account_token(app: &AppHandle, user_id: &str) -> bool {
    load_account_token(app, user_id).ok().flatten().is_some()
}

pub fn load_account_sync_profile(
    app: &AppHandle,
    user_id: &str,
) -> Result<StoredAccountSyncProfile, String> {
    let path = sync_profile_path(app, user_id)?;
    read_sync_profile_from_path(&path)
}

pub fn save_account_sync_profile(
    app: &AppHandle,
    user_id: &str,
    profile: &StoredAccountSyncProfile,
) -> Result<(), String> {
    let path = sync_profile_path(app, user_id)?;
    write_sync_profile_to_path(&path, profile)
}

fn read_sync_profile_from_path(path: &Path) -> Result<StoredAccountSyncProfile, String> {
    match fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<StoredAccountSyncProfile>(&raw) {
            Ok(profile) => Ok(profile),
            Err(_) => {
                crate::persistence::backup_corrupt_file(path, "account sync profile")?;
                Ok(StoredAccountSyncProfile::default())
            }
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Ok(StoredAccountSyncProfile::default())
        }
        Err(err) => Err(format!("failed to read account sync profile: {err}")),
    }
}

fn write_sync_profile_to_path(
    path: &Path,
    profile: &StoredAccountSyncProfile,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create account profile dir: {err}"))?;
    }
    crate::persistence::atomic_write_json_fast(path, profile, "account sync profile")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_cred_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("tidydesk-cred-{name}-{nanos}"))
    }

    #[test]
    fn protected_token_roundtrip_never_writes_plaintext() {
        let dir = temp_cred_dir("dpapi");
        let path = dir.join(ACCOUNT_TOKEN_FILE);
        let secret = "td_live_secret_token_987654";

        write_protected_token_to_path(&path, secret).unwrap();
        let disk_raw = fs::read_to_string(&path).unwrap();
        #[cfg(target_os = "windows")]
        assert!(
            !disk_raw.contains(secret),
            "token must not be stored in plaintext on Windows"
        );
        assert_eq!(
            read_protected_token_from_path(&path).unwrap().as_deref(),
            Some(secret)
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sync_profile_persists_cursor_and_endpoint() {
        let dir = temp_cred_dir("profile");
        let path = dir.join(ACCOUNT_SYNC_PROFILE_FILE);
        let profile = StoredAccountSyncProfile {
            display_name: Some("Alice".to_string()),
            server_endpoint: Some("https://sync.example.com".to_string()),
            workspace_id: DEFAULT_WORKSPACE_ID.to_string(),
            last_sync_cursor: Some("cur-42".to_string()),
            last_sync_at: Some("1700000000".to_string()),
        };

        write_sync_profile_to_path(&path, &profile).unwrap();
        let loaded = read_sync_profile_from_path(&path).unwrap();
        assert_eq!(loaded, profile);

        let _ = fs::remove_dir_all(&dir);
    }
}
