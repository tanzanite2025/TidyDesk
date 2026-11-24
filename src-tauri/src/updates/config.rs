use serde::Serialize;
use std::env;
use std::fs;
use tauri::AppHandle;
use url::Url;

const DEFAULT_UPDATER_CHANNEL: &str = "stable";
const UPDATER_CHANNEL_ENV: &str = "TIDYDESK_UPDATER_CHANNEL";
const UPDATER_ENDPOINTS_ENV: &str = "TIDYDESK_UPDATER_ENDPOINTS";
const UPDATER_PUBLIC_KEY_ENV: &str = "TIDYDESK_UPDATER_PUBLIC_KEY";
const UPDATER_PUBLIC_KEY_FILE_ENV: &str = "TIDYDESK_UPDATER_PUBLIC_KEY_FILE";
const ALLOWED_UPDATER_CHANNELS: [&str; 2] = ["stable", "beta"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    pub name: String,
    pub version: String,
    pub is_packaged: bool,
    pub runtime: String,
    pub channel: String,
    pub updater_available: bool,
}

#[derive(Debug, Clone)]
pub(super) struct ResolvedUpdaterConfig {
    pub channel: String,
    pub endpoint_override: Option<Vec<Url>>,
    pub pubkey_override: Option<String>,
}

fn current_channel() -> String {
    let configured = env::var(UPDATER_CHANNEL_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_UPDATER_CHANNEL.to_string());

    if ALLOWED_UPDATER_CHANNELS
        .iter()
        .any(|channel| channel.eq_ignore_ascii_case(&configured))
    {
        configured.to_ascii_lowercase()
    } else {
        DEFAULT_UPDATER_CHANNEL.to_string()
    }
}

fn updater_runtime_overrides_allowed() -> bool {
    cfg!(any(debug_assertions, feature = "e2e-tests"))
}

fn resolve_public_key_override() -> Result<Option<String>, String> {
    if !updater_runtime_overrides_allowed() {
        return Ok(None);
    }

    if let Ok(value) = env::var(UPDATER_PUBLIC_KEY_ENV) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed.to_string()));
        }
    }

    if let Ok(path) = env::var(UPDATER_PUBLIC_KEY_FILE_ENV) {
        let contents = fs::read_to_string(&path)
            .map_err(|err| format!("failed to read updater public key file `{path}`: {err}"))?;
        let trimmed = contents.trim();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed.to_string()));
        }
    }

    Ok(None)
}

fn resolve_endpoints_override() -> Result<Option<Vec<Url>>, String> {
    if !updater_runtime_overrides_allowed() {
        return Ok(None);
    }

    let raw = match env::var(UPDATER_ENDPOINTS_ENV) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };

    let endpoints = raw
        .split([';', ',', '\n'])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            Url::parse(value).map_err(|err| format!("invalid updater endpoint `{value}`: {err}"))
        })
        .collect::<Result<Vec<_>, _>>()?;

    if endpoints.is_empty() {
        return Err("no updater endpoints configured".to_string());
    }

    Ok(Some(endpoints))
}

pub(super) fn resolve_updater_config() -> Result<ResolvedUpdaterConfig, String> {
    Ok(ResolvedUpdaterConfig {
        channel: current_channel(),
        endpoint_override: resolve_endpoints_override()?,
        pubkey_override: resolve_public_key_override()?,
    })
}

pub(super) fn update_metadata(app: &AppHandle) -> UpdateMetadata {
    let resolved_config = resolve_updater_config().ok();

    UpdateMetadata {
        name: app
            .config()
            .product_name
            .clone()
            .unwrap_or_else(|| app.package_info().name.clone()),
        version: app.package_info().version.to_string(),
        is_packaged: !cfg!(debug_assertions),
        runtime: "tauri".to_string(),
        channel: resolved_config
            .as_ref()
            .map(|config| config.channel.clone())
            .unwrap_or_else(current_channel),
        updater_available: !cfg!(debug_assertions) && resolved_config.is_some(),
    }
}
