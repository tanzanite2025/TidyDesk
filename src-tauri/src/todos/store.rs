use super::attachments::{card_attachments_dir, enrich_attachment_view, todo_attachments_root};
use super::model::{
    create_default_todo_index, is_card_deleted, is_subtask_deleted, normalize_todo_index,
    summarize_card_text, todo_board_id,
};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Debug, Default)]
pub struct TodoStoreState {
    pub lock: Mutex<()>,
    pub content_cache: Mutex<HashMap<String, String>>,
}

pub fn with_todo_store_lock<T>(
    app: &AppHandle,
    operation: impl FnOnce(&TodoStoreState) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<TodoStoreState>();
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "failed to lock todo store".to_string())?;
    operation(&state)
}

pub fn clear_todo_content_cache(store: &TodoStoreState) {
    if let Ok(mut cache) = store.content_cache.lock() {
        cache.clear();
    }
}

fn todo_root(app: &AppHandle) -> Result<PathBuf, String> {
    crate::accounts::account_todos_root(app)
}

fn todo_cards_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(todo_root(app)?.join("cards"))
}

pub fn todo_index_path_in_root(root: &std::path::Path) -> PathBuf {
    root.join("boards.json")
}

fn todo_index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(todo_index_path_in_root(&todo_root(app)?))
}

fn ensure_todo_storage_unlocked(app: &AppHandle) -> Result<(), String> {
    fs::create_dir_all(todo_cards_root(app)?)
        .map_err(|err| format!("failed to create todo storage: {err}"))?;
    let index_path = todo_index_path(app)?;
    if !index_path.exists() {
        write_todo_index_unlocked(app, &create_default_todo_index())?;
    }
    Ok(())
}

pub fn read_todo_index_unlocked(app: &AppHandle) -> Result<Value, String> {
    ensure_todo_storage_unlocked(app)?;
    let index_path = todo_index_path(app)?;
    let raw = match fs::read_to_string(&index_path) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            let index = create_default_todo_index();
            write_todo_index_unlocked(app, &index)?;
            return Ok(index);
        }
        Err(err) => return Err(format!("failed to read todo index: {err}")),
    };
    let (parsed, recovered) = match serde_json::from_str::<Value>(&raw) {
        Ok(value) => (value, false),
        Err(_) => {
            crate::persistence::backup_corrupt_file(&index_path, "todo index")?;
            (create_default_todo_index(), true)
        }
    };
    let normalized = normalize_todo_index(parsed.clone());
    if recovered || normalized != parsed {
        write_todo_index_unlocked(app, &normalized)?;
    }
    Ok(normalized)
}

pub fn write_todo_index_unlocked(app: &AppHandle, index: &Value) -> Result<(), String> {
    fs::create_dir_all(todo_root(app)?)
        .map_err(|err| format!("failed to create todo root: {err}"))?;
    let normalized = normalize_todo_index(index.clone());
    let content = serde_json::to_string_pretty(&normalized)
        .map_err(|err| format!("failed to serialize todo index: {err}"))?;
    crate::persistence::atomic_write_text_fast(&todo_index_path(app)?, &content, "todo index")
}

pub(super) fn todo_card_path(app: &AppHandle, card_id: &str) -> Result<PathBuf, String> {
    let safe_name: String = card_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let root = todo_cards_root(app)?;
    let path = root.join(format!("{safe_name}.md"));
    if !crate::is_path_inside(&path, &root) {
        return Err("Unsafe todo card path".to_string());
    }
    Ok(path)
}

pub(crate) fn read_todo_card_content_unlocked(
    app: &AppHandle,
    card_id: &str,
) -> Result<String, String> {
    match fs::read_to_string(todo_card_path(app, card_id)?) {
        Ok(content) => Ok(content),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(format!("failed to read todo card content: {err}")),
    }
}

pub(crate) fn write_todo_card_content_unlocked(
    app: &AppHandle,
    card_id: &str,
    content: &str,
) -> Result<(), String> {
    fs::create_dir_all(todo_cards_root(app)?)
        .map_err(|err| format!("failed to create todo cards root: {err}"))?;
    crate::persistence::atomic_write_text_fast(
        &todo_card_path(app, card_id)?,
        content,
        "todo card content",
    )
}

const CARD_PREVIEW_ATTACHMENT_LIMIT: usize = 2;

fn project_preview_item(attachment: &Value) -> Value {
    json!({
        "id": attachment["id"],
        "kind": attachment["kind"],
        "originalName": attachment["originalName"],
        "width": attachment["width"],
        "height": attachment["height"],
        "aspectRatio": attachment["aspectRatio"],
        "orientation": attachment["orientation"],
        "focalPoint": attachment["focalPoint"],
        "previewMode": attachment["previewMode"],
        "thumbUrl": attachment["thumbUrl"],
    })
}

pub(super) fn select_preview_attachments(
    attachments: &[Value],
    cover_id: Option<&str>,
) -> (Vec<Value>, usize) {
    let mut selected = Vec::with_capacity(CARD_PREVIEW_ATTACHMENT_LIMIT);
    let mut cover_index = None;

    if let Some(cid) = cover_id.filter(|v| !v.trim().is_empty()) {
        if let Some(pos) = attachments
            .iter()
            .position(|att| att["id"].as_str() == Some(cid))
        {
            selected.push(project_preview_item(&attachments[pos]));
            cover_index = Some(pos);
        }
    }

    for (idx, att) in attachments.iter().enumerate() {
        if selected.len() >= CARD_PREVIEW_ATTACHMENT_LIMIT {
            break;
        }
        if Some(idx) == cover_index {
            continue;
        }
        selected.push(project_preview_item(att));
    }

    let extra_count = attachments.len().saturating_sub(selected.len());
    (selected, extra_count)
}

fn build_card_projection_base(card: &Value, content: &str) -> (Value, Vec<Value>, Vec<Value>) {
    let card_id = card["id"].as_str().unwrap_or_default().to_string();
    let raw_attachments = card["attachments"].as_array().cloned().unwrap_or_default();
    let card_attachments: Vec<Value> = raw_attachments
        .iter()
        .map(|att| enrich_attachment_view(&card_id, att))
        .collect();

    let raw_subtasks = card["subtasks"].as_array().cloned().unwrap_or_default();
    let mut subtasks = Vec::with_capacity(raw_subtasks.len());
    let mut all_attachments = card_attachments.clone();

    for subtask in raw_subtasks {
        if is_subtask_deleted(&subtask) {
            continue;
        }
        let mut next_subtask = subtask.clone();
        let sub_attachments: Vec<Value> = subtask["attachments"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .map(|att| enrich_attachment_view(&card_id, att))
                    .collect()
            })
            .unwrap_or_default();
        all_attachments.extend(sub_attachments.iter().cloned());
        next_subtask["attachmentCount"] = json!(sub_attachments.len());
        next_subtask["attachments"] = Value::Array(sub_attachments);
        subtasks.push(next_subtask);
    }

    let cover_id = card["coverAttachmentId"].as_str().map(str::to_string);
    let (preview_attachments, extra_attachment_count) =
        select_preview_attachments(&all_attachments, cover_id.as_deref());

    let subtask_total = subtasks.len();
    let subtask_completed = subtasks
        .iter()
        .filter(|item| item["completed"].as_bool().unwrap_or(false))
        .count();
    let summary_text = summarize_card_text(content);

    let summary = json!({
        "id": card["id"],
        "boardId": card["boardId"],
        "columnId": card["columnId"],
        "title": card["title"],
        "summaryText": summary_text,
        "tags": card["tags"],
        "archived": card["archived"],
        "position": card["position"],
        "revision": card["revision"],
        "updatedBy": card["updatedBy"],
        "deletedAt": card["deletedAt"],
        "createdAt": card["createdAt"],
        "updatedAt": card["updatedAt"],
        "subtaskTotal": subtask_total,
        "subtaskCompleted": subtask_completed,
        "coverAttachmentId": card["coverAttachmentId"],
        "previewAttachments": preview_attachments,
        "attachmentCount": all_attachments.len(),
        "extraAttachmentCount": extra_attachment_count,
    });
    (summary, subtasks, card_attachments)
}

/// Lightweight board-list summary projection (omits full Markdown body, full subtasks, and bloated attachment metadata).
pub(super) fn enrich_card_summary_view(card: &Value, content: &str) -> Value {
    let (summary, _, _) = build_card_projection_base(card, content);
    summary
}

/// Full card detail projection used when opening or editing a single card modal.
pub(super) fn enrich_card_detail_view(card: &Value, content: String) -> Value {
    let (mut detail, subtasks, attachments) = build_card_projection_base(card, &content);
    detail["content"] = json!(content);
    detail["subtasks"] = Value::Array(subtasks);
    detail["attachments"] = Value::Array(attachments);
    detail
}

pub fn todo_state_from_index_unlocked(
    app: &AppHandle,
    store: &TodoStoreState,
    index: &Value,
    counts: Value,
) -> Result<Value, String> {
    let mut cache = store
        .content_cache
        .lock()
        .map_err(|_| "failed to lock todo content cache".to_string())?;
    cache.clear();
    let cards = index["cards"]
        .as_array()
        .map(|cards| {
            cards
                .iter()
                .filter(|card| !is_card_deleted(card))
                .map(|card| {
                    let card_id = card["id"].as_str().unwrap_or_default().to_string();
                    let content = read_todo_card_content_unlocked(app, &card_id)?;
                    let view = enrich_card_summary_view(card, &content);
                    cache.insert(card_id, content);
                    Ok(view)
                })
                .collect::<Result<Vec<_>, String>>()
        })
        .unwrap_or_else(|| Ok(Vec::new()))?;
    Ok(json!({
        "activeBoardId": index["activeBoardId"],
        "boards": index["boards"],
        "cards": cards,
        "counts": counts,
    }))
}

pub(super) fn todo_state_from_cache_or_disk(
    app: &AppHandle,
    store: &TodoStoreState,
    index: &Value,
    counts: Value,
) -> Result<Value, String> {
    let mut cache = store
        .content_cache
        .lock()
        .map_err(|_| "failed to lock todo content cache".to_string())?;
    let cards = index["cards"]
        .as_array()
        .map(|cards| {
            cards
                .iter()
                .filter(|card| !is_card_deleted(card))
                .map(|card| {
                    let card_id = card["id"].as_str().unwrap_or_default().to_string();
                    let content = if let Some(cached) = cache.get(&card_id) {
                        cached.clone()
                    } else {
                        let loaded = read_todo_card_content_unlocked(app, &card_id)?;
                        cache.insert(card_id, loaded.clone());
                        loaded
                    };
                    Ok(enrich_card_summary_view(card, &content))
                })
                .collect::<Result<Vec<_>, String>>()
        })
        .unwrap_or_else(|| Ok(Vec::new()))?;
    Ok(json!({
        "activeBoardId": index["activeBoardId"],
        "boards": index["boards"],
        "cards": cards,
        "counts": counts,
    }))
}

#[derive(Debug, Clone)]
pub(crate) struct MissingThumbTarget {
    pub card_id: String,
    pub thumb_file_name: String,
    pub remote_thumb_key: String,
}

fn mark_attachment_slice_synced(
    items: &mut [Value],
    uploaded_blobs: &HashMap<String, (String, String)>,
) {
    for att in items {
        let Some(att_id) = att["id"].as_str() else {
            continue;
        };
        if let Some((thumb_key, orig_key)) = uploaded_blobs.get(att_id) {
            att["syncState"] = json!("synced");
            att["remoteThumbKey"] = json!(thumb_key);
            att["remoteOriginalKey"] = json!(orig_key);
        } else if att
            .get("remoteOriginalKey")
            .and_then(Value::as_str)
            .is_some()
        {
            att["syncState"] = json!("synced");
        }
    }
}

fn cleanup_card_local_assets(app: &AppHandle, store: &TodoStoreState, card_id: &str) {
    if let Ok(path) = todo_card_path(app, card_id) {
        let _ = fs::remove_file(path);
    }
    if let Ok(dir) = card_attachments_dir(app, card_id) {
        let _ = fs::remove_dir_all(dir);
    }
    if let Ok(mut cache) = store.content_cache.lock() {
        cache.remove(card_id);
    }
}

/// Apply synced upload keys, pulled/merged remote cards, tombstones, and prune expired tombstones.
/// Returns list of thumbnails missing on local disk so the sync engine can pre-fetch them off-lock.
pub(crate) fn apply_synced_todo_changes(
    app: &AppHandle,
    merged_cards: &[Value],
    removed_ids: &[String],
    uploaded_blobs: &HashMap<String, (String, String)>,
    unsynced_card_ids: &HashSet<String>,
) -> Result<Vec<MissingThumbTarget>, String> {
    const TOMBSTONE_RETENTION_MS: u128 = 30 * 24 * 60 * 60 * 1000;

    with_todo_store_lock(app, |store| {
        let mut index = read_todo_index_unlocked(app)?;
        let board_id = todo_board_id(&index);
        let now_str = crate::timestamp_string();
        let now_ms = now_str.parse::<u128>().unwrap_or(0);

        if let Some(cards) = index["cards"].as_array_mut() {
            if !uploaded_blobs.is_empty() {
                for card in cards.iter_mut() {
                    if let Some(atts) = card["attachments"].as_array_mut() {
                        mark_attachment_slice_synced(atts, uploaded_blobs);
                    }
                    if let Some(subtasks) = card["subtasks"].as_array_mut() {
                        for sub in subtasks {
                            if let Some(atts) = sub["attachments"].as_array_mut() {
                                mark_attachment_slice_synced(atts, uploaded_blobs);
                            }
                        }
                    }
                }
            }

            for remote_card in merged_cards {
                let Some(card_id) = remote_card["id"].as_str().filter(|v| !v.is_empty()) else {
                    continue;
                };
                let existing_pos = cards.iter().position(|c| c["id"].as_str() == Some(card_id));
                let local_card = existing_pos.map(|pos| cards[pos].clone());
                let local_content = if existing_pos.is_some() {
                    read_todo_card_content_unlocked(app, card_id)?
                } else {
                    String::new()
                };
                let (mut next_card, next_content) =
                    crate::sync::merge::merge_remote_card_into_local(
                        local_card.as_ref(),
                        &local_content,
                        remote_card,
                        unsynced_card_ids.contains(card_id),
                    );
                next_card["boardId"] = json!(board_id);
                if let Some(atts) = next_card["attachments"].as_array_mut() {
                    mark_attachment_slice_synced(atts, uploaded_blobs);
                }
                if let Some(subtasks) = next_card["subtasks"].as_array_mut() {
                    for sub in subtasks {
                        if let Some(atts) = sub["attachments"].as_array_mut() {
                            mark_attachment_slice_synced(atts, uploaded_blobs);
                        }
                    }
                }

                if is_card_deleted(&next_card) {
                    cleanup_card_local_assets(app, store, card_id);
                } else {
                    write_todo_card_content_unlocked(app, card_id, &next_content)?;
                    if let Ok(mut cache) = store.content_cache.lock() {
                        cache.insert(card_id.to_string(), next_content);
                    }
                }

                if let Some(pos) = existing_pos {
                    cards[pos] = next_card;
                } else {
                    cards.push(next_card);
                }
            }

            for removed_id in removed_ids {
                if let Some(card) = cards
                    .iter_mut()
                    .find(|c| c["id"].as_str() == Some(removed_id.as_str()))
                {
                    if card["deletedAt"].is_null() {
                        card["deletedAt"] = json!(now_str);
                        card["updatedAt"] = json!(now_str);
                        card["attachments"] = json!([]);
                        card["subtasks"] = json!([]);
                        card["coverAttachmentId"] = Value::Null;
                    }
                    cleanup_card_local_assets(app, store, removed_id);
                }
            }
        }

        if now_ms > TOMBSTONE_RETENTION_MS {
            crate::sync::merge::prune_synced_tombstones(
                &mut index,
                now_ms - TOMBSTONE_RETENTION_MS,
            );
        }
        write_todo_index_unlocked(app, &index)?;

        let mut missing_thumbs = Vec::new();
        let normalized = read_todo_index_unlocked(app)?;
        if let Some(cards) = normalized["cards"].as_array() {
            for card in cards {
                if is_card_deleted(card) {
                    continue;
                }
                let Some(card_id) = card["id"].as_str() else {
                    continue;
                };
                let Ok(dir) = card_attachments_dir(app, card_id) else {
                    continue;
                };
                let mut check_att = |att: &Value| {
                    let Some(thumb_name) = att["thumbFileName"].as_str().filter(|v| !v.is_empty())
                    else {
                        return;
                    };
                    let Some(remote_key) = att["remoteThumbKey"].as_str().filter(|v| !v.is_empty())
                    else {
                        return;
                    };
                    if !dir.join(thumb_name).is_file() {
                        missing_thumbs.push(MissingThumbTarget {
                            card_id: card_id.to_string(),
                            thumb_file_name: thumb_name.to_string(),
                            remote_thumb_key: remote_key.to_string(),
                        });
                    }
                };
                for att in card["attachments"].as_array().into_iter().flatten() {
                    check_att(att);
                }
                for sub in card["subtasks"].as_array().into_iter().flatten() {
                    if is_subtask_deleted(sub) {
                        continue;
                    }
                    for att in sub["attachments"].as_array().into_iter().flatten() {
                        check_att(att);
                    }
                }
            }
        }
        Ok(missing_thumbs)
    })
}

/// Resolve remote blob kind and object key for an attachment missing from local disk cache.
pub(crate) fn find_remote_attachment_blob(
    app: &AppHandle,
    card_id: &str,
    file_name: &str,
) -> Result<Option<(&'static str, String, PathBuf)>, String> {
    with_todo_store_lock(app, |_| {
        let index = read_todo_index_unlocked(app)?;
        let Some(card) = index["cards"]
            .as_array()
            .and_then(|cards| cards.iter().find(|c| c["id"].as_str() == Some(card_id)))
        else {
            return Ok(None);
        };
        if is_card_deleted(card) {
            return Ok(None);
        }

        let target_dir = todo_attachments_root(app)?.join(card_id);
        let target_path = target_dir.join(file_name);
        if !crate::is_path_inside(&target_path, &target_dir) {
            return Ok(None);
        }

        let match_att = |att: &Value| -> Option<(&'static str, String, PathBuf)> {
            if att["thumbFileName"].as_str() == Some(file_name) {
                let key = att["remoteThumbKey"].as_str()?.trim();
                if !key.is_empty() {
                    return Some(("thumb", key.to_string(), target_path.clone()));
                }
            }
            if att["fileName"].as_str() == Some(file_name) {
                let key = att["remoteOriginalKey"].as_str()?.trim();
                if !key.is_empty() {
                    return Some(("original", key.to_string(), target_path.clone()));
                }
            }
            None
        };

        for att in card["attachments"].as_array().into_iter().flatten() {
            if let Some(found) = match_att(att) {
                return Ok(Some(found));
            }
        }
        for sub in card["subtasks"].as_array().into_iter().flatten() {
            if is_subtask_deleted(sub) {
                continue;
            }
            for att in sub["attachments"].as_array().into_iter().flatten() {
                if let Some(found) = match_att(att) {
                    return Ok(Some(found));
                }
            }
        }
        Ok(None)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn select_preview_attachments_limits_to_two_and_prioritizes_cover() {
        let empty = select_preview_attachments(&[], None);
        assert_eq!(empty.0.len(), 0);
        assert_eq!(empty.1, 0);

        let single = vec![json!({ "id": "a1", "kind": "image" })];
        let (one_preview, one_extra) = select_preview_attachments(&single, None);
        assert_eq!(one_preview.len(), 1);
        assert_eq!(one_extra, 0);

        let five = vec![
            json!({ "id": "a1" }),
            json!({ "id": "a2" }),
            json!({ "id": "a3" }),
            json!({ "id": "a4" }),
            json!({ "id": "a5" }),
        ];
        let (two_preview, two_extra) = select_preview_attachments(&five, Some("a4"));
        assert_eq!(two_preview.len(), 2);
        assert_eq!(two_preview[0]["id"], json!("a4"));
        assert_eq!(two_preview[1]["id"], json!("a1"));
        assert_eq!(two_extra, 3);
    }

    #[test]
    fn summary_view_omits_heavy_body_and_full_arrays() {
        let card = json!({
            "id": "c1",
            "boardId": "default-board",
            "columnId": "todo",
            "title": "巡检",
            "tags": [],
            "archived": false,
            "subtasks": [
                { "id": "s1", "title": "一步", "completed": true },
                { "id": "s2", "title": "二步", "completed": false }
            ],
            "attachments": [
                { "id": "a1", "kind": "image", "fileName": "a1.png", "thumbFileName": "thumb_a1.png", "sha256": "abc" },
                { "id": "a2", "kind": "image", "fileName": "a2.png", "thumbFileName": "thumb_a2.png" },
                { "id": "a3", "kind": "image", "fileName": "a3.png", "thumbFileName": "thumb_a3.png" }
            ],
            "coverAttachmentId": "a2"
        });

        let summary = enrich_card_summary_view(&card, "# 标题\n这是详细长正文\n第二行");
        assert!(summary.get("content").is_none());
        assert!(summary.get("subtasks").is_none());
        assert!(summary.get("attachments").is_none());
        assert_eq!(summary["summaryText"], json!("标题"));
        assert_eq!(summary["subtaskTotal"], json!(2));
        assert_eq!(summary["subtaskCompleted"], json!(1));
        assert_eq!(summary["attachmentCount"], json!(3));
        assert_eq!(summary["extraAttachmentCount"], json!(1));
        assert_eq!(
            summary["previewAttachments"].as_array().map(Vec::len),
            Some(2)
        );
        assert_eq!(summary["previewAttachments"][0]["id"], json!("a2"));

        let detail = enrich_card_detail_view(&card, "完整正文".to_string());
        assert_eq!(detail["content"], json!("完整正文"));
        assert_eq!(detail["subtasks"].as_array().map(Vec::len), Some(2));
        assert_eq!(detail["attachments"].as_array().map(Vec::len), Some(3));
    }

    #[test]
    fn summary_view_aggregates_subtask_attachments_and_subtask_cover() {
        let card = json!({
            "id": "c-sub",
            "boardId": "default-board",
            "columnId": "todo",
            "title": "子任务带图",
            "tags": [],
            "archived": false,
            "attachments": [],
            "subtasks": [
                {
                    "id": "s1",
                    "title": "拍照核对",
                    "completed": false,
                    "attachments": [
                        { "id": "sa1", "kind": "image", "fileName": "sa1.png", "thumbFileName": "thumb_sa1.png" },
                        { "id": "sa2", "kind": "image", "fileName": "sa2.png", "thumbFileName": "thumb_sa2.png" },
                        { "id": "sa3", "kind": "image", "fileName": "sa3.png", "thumbFileName": "thumb_sa3.png" }
                    ]
                }
            ],
            "coverAttachmentId": "sa2"
        });

        let summary = enrich_card_summary_view(&card, "");
        assert_eq!(summary["attachmentCount"], json!(3));
        assert_eq!(summary["extraAttachmentCount"], json!(1));
        assert_eq!(
            summary["previewAttachments"].as_array().map(Vec::len),
            Some(2)
        );
        assert_eq!(summary["previewAttachments"][0]["id"], json!("sa2"));
        assert_eq!(summary["previewAttachments"][1]["id"], json!("sa1"));

        let detail = enrich_card_detail_view(&card, String::new());
        assert_eq!(detail["subtasks"][0]["attachmentCount"], json!(3));
        assert!(detail["subtasks"][0]["attachments"][0]["thumbUrl"]
            .as_str()
            .unwrap_or("")
            .contains("c-sub/thumb_sa1.png"));
    }
}
