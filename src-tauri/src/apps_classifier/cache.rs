use super::{ScanMetadataResult, ShortcutMetadata};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const APP_CACHE_VERSION: &str = "rust-app-scan-v1";
const APP_CACHE_TTL_MILLIS: i64 = 24 * 60 * 60 * 1000;
const APP_CACHE_FUTURE_TOLERANCE_MILLIS: i64 = 5 * 60 * 1000;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCacheInfo {
    pub exists: bool,
    #[serde(default)]
    pub valid: bool,
    #[serde(default)]
    pub app_count: usize,
    #[serde(default)]
    pub age_minutes: i64,
    #[serde(default)]
    pub timestamp: Option<i64>,
    #[serde(default)]
    pub version: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppCacheFile {
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    timestamp: Option<i64>,
    #[serde(default)]
    apps: Vec<ShortcutMetadata>,
}

pub fn read_valid_cached_metadata(app: &AppHandle) -> Result<Option<ScanMetadataResult>, String> {
    let Some(cache) = load_app_cache(app)? else {
        return Ok(None);
    };
    if !app_cache_validity(&cache, now_millis()).0 {
        return Ok(None);
    }
    Ok(Some(ScanMetadataResult {
        shortcuts: cache.apps,
        scanned_paths: Vec::new(),
        duration_ms: 0,
    }))
}

pub fn write_app_cache(app: &AppHandle, metadata: &ScanMetadataResult) -> Result<(), String> {
    let path = app_cache_path(app)?;
    let cache = AppCacheFile {
        version: Some(APP_CACHE_VERSION.to_string()),
        timestamp: Some(now_millis()),
        apps: metadata.shortcuts.clone(),
    };
    crate::persistence::atomic_write_json(&path, &cache, "app cache")
}

pub fn app_cache_info(app: &AppHandle) -> Result<AppCacheInfo, String> {
    let Some(cache) = load_app_cache(app)? else {
        return Ok(AppCacheInfo {
            exists: false,
            valid: false,
            app_count: 0,
            age_minutes: 0,
            timestamp: None,
            version: None,
        });
    };

    let now = now_millis();
    let (valid, age_millis) = app_cache_validity(&cache, now);
    Ok(AppCacheInfo {
        exists: true,
        valid,
        app_count: cache.apps.len(),
        age_minutes: age_millis / 60_000,
        timestamp: cache.timestamp,
        version: cache.version,
    })
}

fn app_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data dir: {err}"))?
        .join("cache")
        .join("apps.json"))
}

fn load_app_cache(app: &AppHandle) -> Result<Option<AppCacheFile>, String> {
    let path = app_cache_path(app)?;
    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<AppCacheFile>(&content) {
            Ok(cache) => Ok(Some(cache)),
            Err(err) => {
                let backup_path = crate::persistence::backup_corrupt_file(&path, "app cache")?;
                eprintln!(
                    "[TIDYDESK] Backed up corrupt app cache to {}: {err}",
                    backup_path.display()
                );
                Ok(None)
            }
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("failed to read app cache: {err}")),
    }
}

fn app_cache_validity(cache: &AppCacheFile, now: i64) -> (bool, i64) {
    let timestamp = cache.timestamp.unwrap_or_default();
    let age_millis = now.saturating_sub(timestamp);
    let version_valid = cache.version.as_deref() == Some(APP_CACHE_VERSION);
    let timestamp_valid =
        timestamp > 0 && timestamp <= now.saturating_add(APP_CACHE_FUTURE_TOLERANCE_MILLIS);
    (
        version_valid && timestamp_valid && age_millis < APP_CACHE_TTL_MILLIS,
        age_millis,
    )
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cache_with(version: Option<&str>, timestamp: Option<i64>) -> AppCacheFile {
        AppCacheFile {
            version: version.map(str::to_string),
            timestamp,
            apps: Vec::new(),
        }
    }

    #[test]
    fn app_cache_validity_requires_current_version_and_sane_timestamp() {
        let now = 1_700_000_000_000;
        assert!(
            app_cache_validity(
                &cache_with(Some(APP_CACHE_VERSION), Some(now - 60_000)),
                now,
            )
            .0
        );

        assert!(!app_cache_validity(&cache_with(Some("0.1.0"), Some(now - 60_000)), now).0);
        assert!(!app_cache_validity(&cache_with(Some(APP_CACHE_VERSION), Some(0)), now).0);
        assert!(
            !app_cache_validity(
                &cache_with(
                    Some(APP_CACHE_VERSION),
                    Some(now + APP_CACHE_FUTURE_TOLERANCE_MILLIS + 1),
                ),
                now,
            )
            .0
        );
        assert!(
            !app_cache_validity(
                &cache_with(Some(APP_CACHE_VERSION), Some(now - APP_CACHE_TTL_MILLIS)),
                now,
            )
            .0
        );
    }
}
