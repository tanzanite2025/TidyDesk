use super::engine::execute_account_sync;
use crate::accounts::credentials::load_account_token;
use crate::accounts::session::load_session;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const REALTIME_PUSH_DEBOUNCE_MS: u64 = 1200;

#[derive(Debug, Default)]
pub struct SyncRealtimeState {
    pub enabled: AtomicBool,
    pub generation: AtomicU64,
    pub push_generation: AtomicU64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SseSyncChangedEvent {
    #[serde(default)]
    pub workspace_id: String,
    #[serde(default)]
    pub cursor: String,
    #[serde(default)]
    pub actor_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedSseFrame {
    Ready { cursor: String },
    SyncChanged(SseSyncChangedEvent),
}

pub fn parse_sse_frame(raw_frame: &str) -> Option<ParsedSseFrame> {
    let mut event_name = "message";
    let mut data_lines: Vec<&str> = Vec::new();
    for raw_line in raw_frame.lines() {
        let line = raw_line.trim_end_matches('\r');
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        if let Some(ev) = line.strip_prefix("event:") {
            event_name = ev.trim();
        } else if let Some(data) = line.strip_prefix("data:") {
            data_lines.push(data.trim_start());
        }
    }
    if data_lines.is_empty() {
        return None;
    }
    let data_json = data_lines.join("\n");
    match event_name {
        "ready" => {
            let v = serde_json::from_str::<serde_json::Value>(&data_json).ok()?;
            Some(ParsedSseFrame::Ready {
                cursor: v["cursor"].as_str().unwrap_or("").to_string(),
            })
        }
        "sync-changed" => {
            let parsed = serde_json::from_str::<SseSyncChangedEvent>(&data_json).ok()?;
            Some(ParsedSseFrame::SyncChanged(parsed))
        }
        _ => None,
    }
}

pub fn should_trigger_sync(local_cursor: Option<&str>, remote_cursor: &str) -> bool {
    let remote = remote_cursor.trim().parse::<u64>().ok();
    let local = local_cursor.and_then(|v| v.trim().parse::<u64>().ok());
    match (local, remote) {
        (Some(l), Some(r)) => r > l,
        (None, Some(r)) => r > 0,
        _ => !remote_cursor.trim().is_empty(),
    }
}

pub fn is_realtime_sync_active(app: &AppHandle) -> bool {
    app.state::<SyncRealtimeState>()
        .enabled
        .load(Ordering::Acquire)
}

fn emit_realtime_state_changed(app: &AppHandle, realtime_active: bool, reason: Option<&str>) {
    let _ = app.emit(
        "sync-realtime-state-changed",
        serde_json::json!({
            "realtimeActive": realtime_active,
            "reason": reason
        }),
    );
}

pub fn stop_realtime_sync(app: &AppHandle) {
    let state = app.state::<SyncRealtimeState>();
    state.enabled.store(false, Ordering::Release);
    state.generation.fetch_add(1, Ordering::AcqRel);
    state.push_generation.fetch_add(1, Ordering::AcqRel);
    emit_realtime_state_changed(app, false, None);
}

pub fn schedule_realtime_push_if_active(app: &AppHandle) {
    if !is_realtime_sync_active(app) {
        return;
    }
    let state = app.state::<SyncRealtimeState>();
    let realtime_gen = state.generation.load(Ordering::Acquire);
    let push_gen = state.push_generation.fetch_add(1, Ordering::AcqRel) + 1;
    let app_handle = app.clone();

    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(REALTIME_PUSH_DEBOUNCE_MS));
        if !is_generation_current(&app_handle, realtime_gen)
            || app_handle
                .state::<SyncRealtimeState>()
                .push_generation
                .load(Ordering::Acquire)
                != push_gen
        {
            return;
        }
        let app_for_sync = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            if let Ok(report) = execute_account_sync(&app_for_sync).await {
                let cursor = load_session(&app_for_sync)
                    .ok()
                    .and_then(|s| s.last_sync_cursor)
                    .unwrap_or_default();
                let _ = app_for_sync.emit(
                    "sync-realtime-applied",
                    serde_json::json!({
                        "pulledCards": report.pulled_cards,
                        "pulledNotes": report.pulled_notes,
                        "cursor": cursor
                    }),
                );
            }
        });
    });
}

pub fn set_realtime_sync_enabled(app: &AppHandle, enabled: bool) -> Result<bool, String> {
    if !enabled {
        stop_realtime_sync(app);
        return Ok(false);
    }

    let session = load_session(app)?;
    let user_id = session
        .active_user_id
        .as_deref()
        .ok_or_else(|| "纯本地模式无法开启云端实时协同".to_string())?;
    let endpoint = session
        .server_endpoint
        .as_deref()
        .ok_or_else(|| "请先配置同步服务端地址后再开启实时协同".to_string())?;
    let token = load_account_token(app, user_id)?
        .ok_or_else(|| "缺少有效的账号 Token，请重新配置凭据".to_string())?;

    let state = app.state::<SyncRealtimeState>();
    let next_gen = state.generation.fetch_add(1, Ordering::AcqRel) + 1;
    state.enabled.store(true, Ordering::Release);

    let app_handle = app.clone();
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    query.append_pair("workspaceId", &session.workspace_id);
    let sse_url = format!(
        "{}/api/v1/sync/events?{}",
        endpoint.trim_end_matches('/'),
        query.finish()
    );
    let user_owned = user_id.to_string();
    tauri::async_runtime::spawn(async move {
        run_sse_loop(app_handle, next_gen, sse_url, user_owned, token).await;
    });

    emit_realtime_state_changed(app, true, None);
    Ok(true)
}

async fn run_sse_loop(
    app: AppHandle,
    my_gen: u64,
    sse_url: String,
    user_id: String,
    token: String,
) {
    let Ok(client) = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
    else {
        return;
    };

    let backoff_secs = [2u64, 5, 15, 30];
    let mut attempt = 0usize;

    loop {
        if !is_generation_current(&app, my_gen) {
            break;
        }

        let resp_res = client
            .get(&sse_url)
            .bearer_auth(&token)
            .header("X-TidyDesk-User", &user_id)
            .send()
            .await;

        match resp_res {
            Ok(mut resp) if resp.status().is_success() => {
                attempt = 0;
                let mut buf = String::new();
                while is_generation_current(&app, my_gen) {
                    match resp.chunk().await {
                        Ok(Some(chunk)) => {
                            let piece = String::from_utf8_lossy(&chunk);
                            buf.push_str(&piece);
                            while let Some(idx) = find_frame_delimiter(&buf) {
                                let frame = buf[..idx].to_string();
                                let skip = if buf[idx..].starts_with("\r\n\r\n") {
                                    4
                                } else {
                                    2
                                };
                                buf.drain(..idx + skip);
                                handle_sse_frame(&app, my_gen, &frame).await;
                            }
                        }
                        Ok(None) | Err(_) => break,
                    }
                }
            }
            Ok(resp)
                if resp.status() == reqwest::StatusCode::UNAUTHORIZED
                    || resp.status() == reqwest::StatusCode::FORBIDDEN =>
            {
                eprintln!(
                    "[TIDYDESK][SSE] Stopping realtime sync after auth rejection ({})",
                    resp.status()
                );
                stop_realtime_sync(&app);
                emit_realtime_state_changed(&app, false, Some("auth_rejected"));
                break;
            }
            _ => {}
        }

        if !is_generation_current(&app, my_gen) {
            break;
        }
        let delay = backoff_secs[attempt.min(backoff_secs.len() - 1)];
        attempt += 1;
        let app_for_sleep = app.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            for _ in 0..(delay * 5) {
                if !is_generation_current(&app_for_sleep, my_gen) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
        })
        .await;
    }
}

fn find_frame_delimiter(buf: &str) -> Option<usize> {
    let lf = buf.find("\n\n");
    let crlf = buf.find("\r\n\r\n");
    match (lf, crlf) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

fn is_generation_current(app: &AppHandle, my_gen: u64) -> bool {
    let state = app.state::<SyncRealtimeState>();
    state.enabled.load(Ordering::Acquire) && state.generation.load(Ordering::Acquire) == my_gen
}

async fn handle_sse_frame(app: &AppHandle, my_gen: u64, frame: &str) {
    if !is_generation_current(app, my_gen) {
        return;
    }
    let Some(parsed) = parse_sse_frame(frame) else {
        return;
    };
    let remote_cursor = match &parsed {
        ParsedSseFrame::Ready { cursor } => cursor.as_str(),
        ParsedSseFrame::SyncChanged(ev) => ev.cursor.as_str(),
    };
    let local_cursor = load_session(app).ok().and_then(|s| s.last_sync_cursor);
    if !should_trigger_sync(local_cursor.as_deref(), remote_cursor) {
        return;
    }
    if let Ok(report) = execute_account_sync(app).await {
        let _ = app.emit(
            "sync-realtime-applied",
            serde_json::json!({
                "pulledCards": report.pulled_cards,
                "pulledNotes": report.pulled_notes,
                "cursor": remote_cursor
            }),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sse_frame_parses_ready_and_sync_changed() {
        let ready = "event: ready\ndata: {\"workspaceId\":\"default\",\"cursor\":\"4\"}";
        assert_eq!(
            parse_sse_frame(ready),
            Some(ParsedSseFrame::Ready {
                cursor: "4".to_string()
            })
        );

        let changed = "event: sync-changed\ndata: {\"workspaceId\":\"default\",\"cursor\":\"5\",\"actorId\":\"bob\"}";
        assert_eq!(
            parse_sse_frame(changed),
            Some(ParsedSseFrame::SyncChanged(SseSyncChangedEvent {
                workspace_id: "default".to_string(),
                cursor: "5".to_string(),
                actor_id: "bob".to_string(),
            }))
        );
        assert_eq!(parse_sse_frame(": keep-alive"), None);
    }

    #[test]
    fn should_trigger_sync_compares_numeric_cursors() {
        assert!(should_trigger_sync(None, "1"));
        assert!(!should_trigger_sync(None, "0"));
        assert!(should_trigger_sync(Some("4"), "5"));
        assert!(!should_trigger_sync(Some("5"), "5"));
        assert!(!should_trigger_sync(Some("6"), "5"));
    }
}
