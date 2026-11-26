use super::http_transport::HttpSyncClient;
use super::outbox::{
    read_outbox_entries, remove_acked_outbox_entries, OutboxEntityKind, OutboxEntry,
    OutboxOperation,
};
use crate::accounts::credentials::load_account_token;
use crate::accounts::session::load_session;
use crate::todos::{
    apply_synced_card_comments, apply_synced_todo_changes, build_desktop_comment_notification,
    card_attachments_dir, emit_unread_comment_summary, find_remote_attachment_blob,
    MissingThumbTarget,
};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

#[derive(Default)]
pub struct SyncExecutionLockState(pub tauri::async_runtime::Mutex<()>);

pub struct SyncExecutionReport {
    pub pushed_count: usize,
    pub pulled_cards: usize,
    pub pulled_notes: usize,
    pub conflicts_count: usize,
    pub remaining_pending: usize,
    pub fetched_thumbs: usize,
}

fn enrich_attachment_array_remote_keys(
    atts: &mut [Value],
    uploaded_blobs: &HashMap<String, (String, String)>,
) {
    for att in atts {
        let Some(att_id) = att["id"].as_str() else {
            continue;
        };
        if let Some((thumb_key, orig_key)) = uploaded_blobs.get(att_id) {
            att["syncState"] = json!("synced");
            att["remoteThumbKey"] = json!(thumb_key);
            att["remoteOriginalKey"] = json!(orig_key);
        }
    }
}

fn enrich_card_outbox_media_keys(
    entries: &mut [OutboxEntry],
    uploaded_blobs: &HashMap<String, (String, String)>,
) {
    if uploaded_blobs.is_empty() {
        return;
    }
    for entry in entries.iter_mut() {
        if entry.entity_kind != OutboxEntityKind::Card || entry.operation != OutboxOperation::Upsert
        {
            continue;
        }
        if let Some(atts) = entry.payload["attachments"].as_array_mut() {
            enrich_attachment_array_remote_keys(atts, uploaded_blobs);
        }
        if let Some(subtasks) = entry.payload["subtasks"].as_array_mut() {
            for sub in subtasks {
                if let Some(atts) = sub["attachments"].as_array_mut() {
                    enrich_attachment_array_remote_keys(atts, uploaded_blobs);
                }
            }
        }
    }
}

async fn upload_pending_attachments(
    app: &AppHandle,
    client: &HttpSyncClient,
    entries: &[OutboxEntry],
) -> Result<HashMap<String, (String, String)>, String> {
    let mut uploaded = HashMap::new();
    for entry in entries {
        if entry.entity_kind != OutboxEntityKind::Attachment
            || entry.operation != OutboxOperation::Upsert
        {
            continue;
        }
        let att_id = entry.entity_id.clone();
        let card_id = entry.payload["cardId"]
            .as_str()
            .ok_or_else(|| format!("附件 {att_id} 缺少 cardId，无法同步上传"))?;
        let sha256 = entry.payload["sha256"]
            .as_str()
            .ok_or_else(|| format!("附件 {att_id} 缺少 sha256 摘要，无法同步上传"))?;
        let mime_type = entry.payload["mimeType"].as_str().unwrap_or("image/png");
        let file_name = entry.payload["fileName"]
            .as_str()
            .ok_or_else(|| format!("附件 {att_id} 缺少文件名"))?;
        let thumb_name = entry.payload["thumbFileName"].as_str().unwrap_or("");

        let presigned = client.presign_media(sha256, mime_type).await?;
        if !presigned.deduplicated {
            let dir = card_attachments_dir(app, card_id)?;
            if !thumb_name.is_empty() {
                let thumb_path = dir.join(thumb_name);
                if thumb_path.is_file() {
                    let thumb_bytes = fs::read(&thumb_path)
                        .map_err(|err| format!("读取本地缩略图失败: {err}"))?;
                    client
                        .upload_blob(&presigned.thumb_upload_path, thumb_bytes, sha256)
                        .await?;
                }
            }
            let orig_path = dir.join(file_name);
            let orig_bytes = fs::read(&orig_path)
                .map_err(|err| format!("读取本地原图 {} 失败: {err}", orig_path.display()))?;
            client
                .upload_blob(&presigned.original_upload_path, orig_bytes, sha256)
                .await?;
        }
        uploaded.insert(att_id, (presigned.thumb_key, presigned.original_key));
    }
    Ok(uploaded)
}

async fn prefetch_missing_thumbnails(
    app: &AppHandle,
    client: &HttpSyncClient,
    targets: Vec<MissingThumbTarget>,
) -> usize {
    let mut fetched = 0usize;
    for target in targets {
        let Ok(bytes) = client
            .download_blob("thumb", &target.remote_thumb_key)
            .await
        else {
            continue;
        };
        let Ok(dir) = card_attachments_dir(app, &target.card_id) else {
            continue;
        };
        let dest = dir.join(&target.thumb_file_name);
        if write_blob_atomically(&dest, &bytes).is_ok() {
            fetched += 1;
        }
    }
    fetched
}

fn write_blob_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create media cache dir: {err}"))?;
    }
    let tmp = path.with_extension(format!("tmp.{}", crate::timestamp_string()));
    fs::write(&tmp, bytes).map_err(|err| format!("failed to write temp media blob: {err}"))?;
    fs::rename(&tmp, path).map_err(|err| {
        let _ = fs::remove_file(&tmp);
        format!("failed to finalize media blob: {err}")
    })
}

/// Run one explicit push-then-pull incremental sync cycle for the active account.
pub async fn execute_account_sync(app: &AppHandle) -> Result<SyncExecutionReport, String> {
    let exec_lock = app.state::<SyncExecutionLockState>();
    let _sync_guard = exec_lock.0.lock().await;

    let session = load_session(app)?;
    let user_id = session
        .active_user_id
        .as_deref()
        .ok_or_else(|| "纯本地模式未启用账号同步".to_string())?;
    let endpoint = session
        .server_endpoint
        .as_deref()
        .ok_or_else(|| "未配置云端同步服务端地址".to_string())?;
    let token = load_account_token(app, user_id)?
        .ok_or_else(|| "缺少有效的账号 Token，请重新输入凭据后重试".to_string())?;

    let client =
        HttpSyncClient::new(endpoint, user_id, &token)?.with_workspace(&session.workspace_id)?;
    let mut entries = read_outbox_entries(app)?;
    let uploaded_blobs = upload_pending_attachments(app, &client, &entries).await?;
    enrich_card_outbox_media_keys(&mut entries, &uploaded_blobs);

    let sent_timestamps: HashMap<(String, String), String> = entries
        .iter()
        .map(|entry| {
            (
                (format!("{:?}", entry.entity_kind), entry.entity_id.clone()),
                entry.updated_at.clone(),
            )
        })
        .collect();

    let push_res = client.push_changes(&entries).await?;
    let mut acked_keys = Vec::new();
    for ack in &push_res.acked {
        if let Some(ts) =
            sent_timestamps.get(&(format!("{:?}", ack.entity_kind), ack.entity_id.clone()))
        {
            acked_keys.push((ack.entity_kind.clone(), ack.entity_id.clone(), ts.clone()));
        }
    }
    let remaining_pending = remove_acked_outbox_entries(app, &acked_keys)?;

    let mut still_unsynced_cards = HashSet::new();
    let mut still_unsynced_comments = HashSet::new();
    for remaining in read_outbox_entries(app)? {
        match remaining.entity_kind {
            OutboxEntityKind::Card => {
                still_unsynced_cards.insert(remaining.entity_id);
            }
            OutboxEntityKind::CardComment => {
                still_unsynced_comments.insert(remaining.entity_id);
            }
            _ => {}
        }
    }

    let had_prior_cursor = session
        .last_sync_cursor
        .as_deref()
        .map(str::trim)
        .is_some_and(|v| !v.is_empty());

    let pull_res = client
        .pull_changes(session.last_sync_cursor.as_deref())
        .await?;

    let mut remote_cards_by_id: HashMap<String, Value> = HashMap::new();
    for card in push_res.merged_cards {
        if let Some(id) = card["id"].as_str() {
            remote_cards_by_id.insert(id.to_string(), card);
        }
    }
    for card in &pull_res.cards {
        if let Some(id) = card["id"].as_str() {
            remote_cards_by_id.insert(id.to_string(), card.clone());
        }
    }
    let merged_to_apply: Vec<Value> = remote_cards_by_id.into_values().collect();
    let pulled_cards_count = pull_res.cards.len();

    let missing_thumbs = apply_synced_todo_changes(
        app,
        &merged_to_apply,
        &pull_res.removed_card_ids,
        &uploaded_blobs,
        &still_unsynced_cards,
    )?;

    let fetched_thumbs = prefetch_missing_thumbnails(app, &client, missing_thumbs).await;

    let comment_sync_res = apply_synced_card_comments(
        app,
        &pull_res.card_comments,
        &pull_res.removed_card_comment_ids,
        &still_unsynced_comments,
    )?;

    crate::quick_notes::apply_pulled_quick_notes(
        app,
        &pull_res.quick_notes,
        &pull_res.removed_quick_note_ids,
    )?;

    let next_cursor = if !pull_res.next_cursor.is_empty() {
        Some(pull_res.next_cursor)
    } else if !push_res.next_cursor.is_empty() {
        Some(push_res.next_cursor)
    } else {
        session.last_sync_cursor
    };

    crate::accounts::update_sync_cursor_and_timestamp(app, next_cursor, crate::timestamp_string())?;
    crate::todos::commands::refresh_and_emit_active_todo_state(app)?;
    let unread_summary = emit_unread_comment_summary(app)?;

    if had_prior_cursor && !comment_sync_res.new_alerts.is_empty() {
        if let Some(notif) = build_desktop_comment_notification(&comment_sync_res.new_alerts) {
            if let Err(err) = app
                .notification()
                .builder()
                .title(&notif.title)
                .body(&notif.body)
                .auto_cancel()
                .show()
            {
                eprintln!("[TIDYDESK] Failed to show comment notification: {err}");
            }
            let _ = app.emit(
                "todo-comment-notification",
                json!({
                    "title": notif.title,
                    "body": notif.body,
                    "cardId": notif.card_id,
                    "mentionCount": notif.mention_count,
                    "commentCount": notif.comment_count,
                    "unreadTotal": unread_summary.unread_total,
                    "mentionTotal": unread_summary.mention_total,
                }),
            );
        }
    }

    Ok(SyncExecutionReport {
        pushed_count: push_res.acked.len(),
        pulled_cards: pulled_cards_count,
        pulled_notes: pull_res.quick_notes.len() + pull_res.removed_quick_note_ids.len(),
        conflicts_count: push_res.conflicts.len(),
        remaining_pending,
        fetched_thumbs,
    })
}

/// Download a missing attachment blob lazily when requested by the custom asset protocol.
pub fn try_lazy_fetch_todo_attachment(
    app: &AppHandle,
    card_id: &str,
    file_name: &str,
) -> Option<Vec<u8>> {
    let session = load_session(app).ok()?;
    let user_id = session.active_user_id?;
    let endpoint = session.server_endpoint?;
    let token = load_account_token(app, &user_id).ok().flatten()?;
    let workspace_id = session.workspace_id;
    let (blob_kind, remote_key, cache_path) = find_remote_attachment_blob(app, card_id, file_name)
        .ok()
        .flatten()?;

    let (tx, rx) = std::sync::mpsc::channel();
    tauri::async_runtime::spawn(async move {
        let res = async {
            let client =
                HttpSyncClient::new(&endpoint, &user_id, &token)?.with_workspace(&workspace_id)?;
            client.download_blob(blob_kind, &remote_key).await
        }
        .await;
        let _ = tx.send(res);
    });

    let bytes = rx
        .recv_timeout(std::time::Duration::from_secs(15))
        .ok()?
        .ok()?;
    let _ = write_blob_atomically(&cache_path, &bytes);
    Some(bytes)
}
