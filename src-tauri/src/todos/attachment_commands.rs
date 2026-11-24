use super::attachments::{remove_attachment_files, save_image_attachment};
use super::card_commands::{
    build_card_outbox_payload, emit_todo_counts, emit_todos_updated, make_attachment_outbox_item,
    read_cached_card_content,
};
use super::model::{
    bump_card_revision, card_has_attachment_id, find_fallback_cover_id, find_todo_card_index,
    is_subtask_deleted, todo_counts, AddTodoAttachmentBytesPayload, DeleteTodoAttachmentPayload,
    SetTodoCardCoverPayload, UpdateTodoAttachmentMetaPayload,
};
use super::store::{
    read_todo_index_unlocked, todo_state_from_cache_or_disk, with_todo_store_lock,
    write_todo_index_unlocked,
};
use crate::accounts::{current_actor_id, is_account_sync_active};
use crate::sync::{enqueue_outbox_batch, OutboxBatchItem, OutboxEntityKind, OutboxOperation};
use rfd::FileDialog;
use serde_json::{json, Value};
use std::fs;
use tauri::AppHandle;

fn clean_subtask_id(subtask_id: Option<&str>) -> Option<&str> {
    subtask_id.map(str::trim).filter(|v| !v.is_empty())
}

fn enqueue_card_with_attachment_event(
    app: &AppHandle,
    store: &super::store::TodoStoreState,
    card_id: &str,
    card: &Value,
    base_revision: u64,
    attachment_item: Option<OutboxBatchItem>,
) -> Result<(), String> {
    let content = read_cached_card_content(app, store, card_id)?;
    let mut batch = vec![OutboxBatchItem {
        entity_kind: OutboxEntityKind::Card,
        entity_id: card_id.to_string(),
        operation: OutboxOperation::Upsert,
        payload: build_card_outbox_payload(card, content, base_revision),
    }];
    if let Some(item) = attachment_item {
        batch.push(item);
    }
    enqueue_outbox_batch(app, batch)
}

fn resolve_attachment_list_mut<'a>(
    card: &'a mut Value,
    subtask_id: Option<&str>,
    now: Option<&str>,
) -> Result<&'a mut Vec<Value>, String> {
    if let Some(sid) = clean_subtask_id(subtask_id) {
        let subtasks = card["subtasks"]
            .as_array_mut()
            .ok_or_else(|| "Todo subtask not found".to_string())?;
        let subtask = subtasks
            .iter_mut()
            .find(|item| item["id"].as_str() == Some(sid) && !is_subtask_deleted(item))
            .ok_or_else(|| "Todo subtask not found".to_string())?;
        if let Some(ts) = now {
            subtask["updatedAt"] = json!(ts);
        }
        if !subtask["attachments"].is_array() {
            subtask["attachments"] = json!([]);
        }
        subtask["attachments"]
            .as_array_mut()
            .ok_or_else(|| "todo subtask attachments is not an array".to_string())
    } else {
        if !card["attachments"].is_array() {
            card["attachments"] = json!([]);
        }
        card["attachments"]
            .as_array_mut()
            .ok_or_else(|| "todo card attachments is not an array".to_string())
    }
}

fn attach_image_bytes_to_target_sync(
    app: &AppHandle,
    card_id: &str,
    subtask_id: Option<&str>,
    file_name: &str,
    bytes: &[u8],
) -> Result<(Value, Value), String> {
    with_todo_store_lock(app, |store| {
        let mut index = read_todo_index_unlocked(app)?;
        let card_index = find_todo_card_index(&index, card_id)?;
        let normalized_subtask = clean_subtask_id(subtask_id).map(str::to_string);
        if let Some(sid) = normalized_subtask.as_deref() {
            let _ = resolve_attachment_list_mut(&mut index["cards"][card_index], Some(sid), None)?;
        }

        let mut attachment = save_image_attachment(app, card_id, file_name, bytes)?;
        if is_account_sync_active(app) {
            attachment["syncState"] = json!("pending");
        }
        let att_id = attachment["id"].as_str().unwrap_or_default().to_string();
        let now = crate::timestamp_string();
        let actor_id = current_actor_id(app);

        let card = &mut index["cards"][card_index];
        let base_revision = card["revision"].as_u64().unwrap_or(1);
        resolve_attachment_list_mut(card, normalized_subtask.as_deref(), Some(&now))?
            .push(attachment.clone());
        if card["coverAttachmentId"].is_null() {
            card["coverAttachmentId"] = json!(att_id);
        }
        bump_card_revision(card, &actor_id, &now);
        let card_snapshot = card.clone();
        index["boards"][0]["updatedAt"] = json!(now);

        if let Err(err) = write_todo_index_unlocked(app, &index) {
            let _ = remove_attachment_files(app, card_id, &attachment);
            return Err(err);
        }

        let att_item = make_attachment_outbox_item(
            card_id,
            normalized_subtask.as_deref(),
            &attachment,
            OutboxOperation::Upsert,
        );
        enqueue_card_with_attachment_event(
            app,
            store,
            card_id,
            &card_snapshot,
            base_revision,
            att_item,
        )?;

        let counts = todo_counts(&index);
        let state = todo_state_from_cache_or_disk(app, store, &index, counts.clone())?;
        Ok((state, counts))
    })
}

pub fn attach_png_to_todo_card(
    app: &AppHandle,
    card_id: &str,
    subtask_id: Option<&str>,
    file_name: &str,
    png: &[u8],
) -> Result<(), String> {
    let (state, counts) =
        attach_image_bytes_to_target_sync(app, card_id, subtask_id, file_name, png)?;
    emit_todo_counts(app, &counts)?;
    emit_todos_updated(app, &state)
}

#[tauri::command]
pub async fn todos_add_attachment_bytes(
    app: AppHandle,
    payload: AddTodoAttachmentBytesPayload,
) -> Result<Value, String> {
    if payload.card_id.trim().is_empty() {
        return Err("Missing todo card id".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (state, counts) = attach_image_bytes_to_target_sync(
            &app,
            &payload.card_id,
            payload.subtask_id.as_deref(),
            &payload.file_name,
            &payload.bytes,
        )?;
        emit_todo_counts(&app, &counts)?;
        emit_todos_updated(&app, &state)?;
        Ok(state)
    })
    .await
    .map_err(|err| format!("todo attachment upload task failed: {err}"))?
}

#[tauri::command]
pub async fn todos_pick_and_add_attachment(
    app: AppHandle,
    card_id: String,
    subtask_id: Option<String>,
) -> Result<Value, String> {
    if card_id.trim().is_empty() {
        return Err("Missing todo card id".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected_path) = FileDialog::new()
            .set_title("选择图片加入待办")
            .add_filter("图片文件", &["png", "jpg", "jpeg", "webp"])
            .pick_file()
        else {
            return Ok(json!({ "canceled": true }));
        };

        let bytes = fs::read(&selected_path).map_err(|err| format!("读取所选图片失败: {err}"))?;
        let file_name = selected_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("photo.png")
            .to_string();

        let (state, counts) = attach_image_bytes_to_target_sync(
            &app,
            &card_id,
            subtask_id.as_deref(),
            &file_name,
            &bytes,
        )?;
        emit_todo_counts(&app, &counts)?;
        emit_todos_updated(&app, &state)?;
        Ok(json!({ "canceled": false, "state": state }))
    })
    .await
    .map_err(|err| format!("todo pick attachment task failed: {err}"))?
}

#[tauri::command]
pub async fn todos_delete_attachment(
    app: AppHandle,
    payload: DeleteTodoAttachmentPayload,
) -> Result<Value, String> {
    if payload.card_id.trim().is_empty() || payload.attachment_id.trim().is_empty() {
        return Err("Missing todo card or attachment id".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (state, counts) = with_todo_store_lock(&app, |store| {
            let mut index = read_todo_index_unlocked(&app)?;
            let card_index = find_todo_card_index(&index, &payload.card_id)?;
            let now = crate::timestamp_string();
            let actor_id = current_actor_id(&app);

            let (base_revision, removed_attachment) = {
                let card = &mut index["cards"][card_index];
                let base_rev = card["revision"].as_u64().unwrap_or(1);
                let list =
                    resolve_attachment_list_mut(card, payload.subtask_id.as_deref(), Some(&now))?;
                let pos = list
                    .iter()
                    .position(|item| item["id"].as_str() == Some(payload.attachment_id.as_str()))
                    .ok_or_else(|| "Todo attachment not found".to_string())?;
                let removed = list.remove(pos);

                if card["coverAttachmentId"].as_str() == Some(payload.attachment_id.as_str()) {
                    card["coverAttachmentId"] = find_fallback_cover_id(card);
                }
                bump_card_revision(card, &actor_id, &now);
                (base_rev, removed)
            };

            let card_snapshot = index["cards"][card_index].clone();
            index["boards"][0]["updatedAt"] = json!(now);
            write_todo_index_unlocked(&app, &index)?;
            remove_attachment_files(&app, &payload.card_id, &removed_attachment)?;
            let att_item = make_attachment_outbox_item(
                &payload.card_id,
                clean_subtask_id(payload.subtask_id.as_deref()),
                &removed_attachment,
                OutboxOperation::Delete,
            );
            enqueue_card_with_attachment_event(
                &app,
                store,
                &payload.card_id,
                &card_snapshot,
                base_revision,
                att_item,
            )?;

            let counts = todo_counts(&index);
            let state = todo_state_from_cache_or_disk(&app, store, &index, counts.clone())?;
            Ok((state, counts))
        })?;
        emit_todo_counts(&app, &counts)?;
        emit_todos_updated(&app, &state)?;
        Ok(state)
    })
    .await
    .map_err(|err| format!("todo delete attachment task failed: {err}"))?
}

#[tauri::command]
pub async fn todos_set_card_cover(
    app: AppHandle,
    payload: SetTodoCardCoverPayload,
) -> Result<Value, String> {
    if payload.card_id.trim().is_empty() {
        return Err("Missing todo card id".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (state, counts) = with_todo_store_lock(&app, |store| {
            let mut index = read_todo_index_unlocked(&app)?;
            let card_index = find_todo_card_index(&index, &payload.card_id)?;
            let base_revision = {
                let card = &mut index["cards"][card_index];
                let base_rev = card["revision"].as_u64().unwrap_or(1);
                let next_cover = match payload.attachment_id.as_deref() {
                    Some(target_id) if !target_id.trim().is_empty() => {
                        let card_atts = card["attachments"].as_array().cloned().unwrap_or_default();
                        let subtasks = card["subtasks"].as_array().cloned().unwrap_or_default();
                        if !card_has_attachment_id(&card_atts, &subtasks, target_id) {
                            return Err("Cover attachment not found on card".to_string());
                        }
                        json!(target_id)
                    }
                    _ => Value::Null,
                };
                card["coverAttachmentId"] = next_cover;
                let now = crate::timestamp_string();
                let actor_id = current_actor_id(&app);
                bump_card_revision(card, &actor_id, &now);
                base_rev
            };
            let card_snapshot = index["cards"][card_index].clone();
            index["boards"][0]["updatedAt"] = json!(crate::timestamp_string());
            write_todo_index_unlocked(&app, &index)?;
            enqueue_card_with_attachment_event(
                &app,
                store,
                &payload.card_id,
                &card_snapshot,
                base_revision,
                None,
            )?;

            let counts = todo_counts(&index);
            let state = todo_state_from_cache_or_disk(&app, store, &index, counts.clone())?;
            Ok((state, counts))
        })?;
        emit_todo_counts(&app, &counts)?;
        emit_todos_updated(&app, &state)?;
        Ok(state)
    })
    .await
    .map_err(|err| format!("todo set cover task failed: {err}"))?
}

#[tauri::command]
pub async fn todos_update_attachment_meta(
    app: AppHandle,
    payload: UpdateTodoAttachmentMetaPayload,
) -> Result<Value, String> {
    if payload.card_id.trim().is_empty() || payload.attachment_id.trim().is_empty() {
        return Err("Missing todo card or attachment id".to_string());
    }
    if let Some(mode) = payload.preview_mode.as_deref() {
        if mode != "cover" && mode != "contain" {
            return Err(format!("Unsupported attachment previewMode: {mode}"));
        }
    }

    tauri::async_runtime::spawn_blocking(move || {
        let (state, counts) = with_todo_store_lock(&app, |store| {
            let mut index = read_todo_index_unlocked(&app)?;
            let card_index = find_todo_card_index(&index, &payload.card_id)?;
            let now = crate::timestamp_string();
            let actor_id = current_actor_id(&app);
            let (base_revision, updated_att) = {
                let card = &mut index["cards"][card_index];
                let base_rev = card["revision"].as_u64().unwrap_or(1);
                let list =
                    resolve_attachment_list_mut(card, payload.subtask_id.as_deref(), Some(&now))?;
                let att = list
                    .iter_mut()
                    .find(|item| item["id"].as_str() == Some(payload.attachment_id.as_str()))
                    .ok_or_else(|| "Todo attachment not found".to_string())?;

                if let Some(fp) = payload.focal_point {
                    let x = ((fp.x.clamp(0.0, 1.0)) * 1000.0).round() / 1000.0;
                    let y = ((fp.y.clamp(0.0, 1.0)) * 1000.0).round() / 1000.0;
                    att["focalPoint"] = json!({ "x": x, "y": y });
                }
                if let Some(mode) = payload.preview_mode {
                    att["previewMode"] = json!(mode);
                }

                let updated = att.clone();
                bump_card_revision(card, &actor_id, &now);
                (base_rev, updated)
            };
            let card_snapshot = index["cards"][card_index].clone();
            index["boards"][0]["updatedAt"] = json!(now);
            write_todo_index_unlocked(&app, &index)?;
            let att_item = make_attachment_outbox_item(
                &payload.card_id,
                clean_subtask_id(payload.subtask_id.as_deref()),
                &updated_att,
                OutboxOperation::Upsert,
            );
            enqueue_card_with_attachment_event(
                &app,
                store,
                &payload.card_id,
                &card_snapshot,
                base_revision,
                att_item,
            )?;

            let counts = todo_counts(&index);
            let state = todo_state_from_cache_or_disk(&app, store, &index, counts.clone())?;
            Ok((state, counts))
        })?;
        emit_todo_counts(&app, &counts)?;
        emit_todos_updated(&app, &state)?;
        Ok(state)
    })
    .await
    .map_err(|err| format!("todo update attachment meta task failed: {err}"))?
}

#[tauri::command]
pub async fn todos_start_snip_for_card(
    app: AppHandle,
    card_id: String,
    subtask_id: Option<String>,
) -> Result<Value, String> {
    if card_id.trim().is_empty() {
        return Err("Missing todo card id".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let normalized_subtask = clean_subtask_id(subtask_id.as_deref()).map(str::to_string);
        with_todo_store_lock(&app, |_| {
            let mut index = read_todo_index_unlocked(&app)?;
            let card_index = find_todo_card_index(&index, &card_id)?;
            if let Some(sid) = normalized_subtask.as_deref() {
                let _ =
                    resolve_attachment_list_mut(&mut index["cards"][card_index], Some(sid), None)?;
            }
            Ok(())
        })?;
        crate::capture::open_snip_window_for_todo_card(&app, card_id, normalized_subtask)
    })
    .await
    .map_err(|err| format!("todo start snip task failed: {err}"))??;
    Ok(json!({ "success": true }))
}
