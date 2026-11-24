use super::attachments::{
    finalize_card_attachments_delete, remove_attachment_files, rollback_card_attachments_delete,
    stage_card_attachments_delete,
};
use super::model::{
    bump_card_revision, card_has_attachment_id, column_position_for_insert,
    column_position_for_prepend, create_todo_id, find_fallback_cover_id, find_todo_card_index,
    insert_card_order, merge_subtask_inputs_preserving_attachments, normalize_subtasks_from_inputs,
    prepend_card_order, remove_card_from_orders, safe_todo_title, todo_board_id, todo_column_ids,
    todo_counts, CreateTodoCardPayload, MoveTodoCardPayload, UpdateTodoCardPayload,
};
use super::store::{
    enrich_card_detail_view, read_todo_card_content_unlocked, read_todo_index_unlocked,
    todo_card_path, todo_state_from_cache_or_disk, todo_state_from_index_unlocked,
    with_todo_store_lock, write_todo_card_content_unlocked, write_todo_index_unlocked,
    TodoStoreState,
};
use crate::accounts::{current_actor_id, is_account_sync_active};
use crate::sync::{enqueue_outbox_batch, OutboxBatchItem, OutboxEntityKind, OutboxOperation};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

pub(super) fn read_cached_card_content(
    app: &AppHandle,
    store: &TodoStoreState,
    card_id: &str,
) -> Result<String, String> {
    let mut cache = store
        .content_cache
        .lock()
        .map_err(|_| "failed to lock todo content cache".to_string())?;
    if let Some(cached) = cache.get(card_id) {
        return Ok(cached.clone());
    }
    let loaded = read_todo_card_content_unlocked(app, card_id)?;
    cache.insert(card_id.to_string(), loaded.clone());
    Ok(loaded)
}

pub(super) fn build_card_outbox_payload(
    card: &Value,
    content: String,
    base_revision: u64,
) -> Value {
    let mut snapshot = card.clone();
    if let Some(obj) = snapshot.as_object_mut() {
        obj.insert("content".to_string(), json!(content));
        obj.insert("baseRevision".to_string(), json!(base_revision));
    }
    snapshot
}

pub(super) fn make_attachment_outbox_item(
    card_id: &str,
    subtask_id: Option<&str>,
    attachment: &Value,
    operation: OutboxOperation,
) -> Option<OutboxBatchItem> {
    let att_id = attachment["id"].as_str()?.trim();
    if att_id.is_empty() {
        return None;
    }
    let payload = match operation {
        OutboxOperation::Upsert => json!({
            "cardId": card_id,
            "subtaskId": subtask_id,
            "attachmentId": att_id,
            "kind": attachment["kind"],
            "originalName": attachment["originalName"],
            "fileName": attachment["fileName"],
            "thumbFileName": attachment["thumbFileName"],
            "sha256": attachment["sha256"],
            "mimeType": attachment["mimeType"],
            "sizeBytes": attachment["sizeBytes"],
            "width": attachment["width"],
            "height": attachment["height"],
            "orientation": attachment["orientation"],
            "focalPoint": attachment["focalPoint"],
            "previewMode": attachment["previewMode"],
            "createdAt": attachment["createdAt"],
        }),
        OutboxOperation::Delete => json!({
            "cardId": card_id,
            "subtaskId": subtask_id,
            "attachmentId": att_id,
            "fileName": attachment["fileName"],
            "thumbFileName": attachment["thumbFileName"],
        }),
    };
    Some(OutboxBatchItem {
        entity_kind: OutboxEntityKind::Attachment,
        entity_id: att_id.to_string(),
        operation,
        payload,
    })
}

fn collect_card_attachment_refs(card: &Value) -> Vec<(Option<String>, Value)> {
    let mut refs = Vec::new();
    for att in card["attachments"].as_array().into_iter().flatten() {
        refs.push((None, att.clone()));
    }
    for sub in card["subtasks"].as_array().into_iter().flatten() {
        let sub_id = sub["id"].as_str().map(str::to_string);
        for att in sub["attachments"].as_array().into_iter().flatten() {
            refs.push((sub_id.clone(), att.clone()));
        }
    }
    refs
}

/// Enqueue newly imported local cards and all embedded attachments into the active account outbox.
pub(crate) fn enqueue_imported_cards_outbox(
    app: &AppHandle,
    store: &TodoStoreState,
    imported_cards: &[Value],
) -> Result<(), String> {
    if imported_cards.is_empty() || !is_account_sync_active(app) {
        return Ok(());
    }
    let mut batch = Vec::new();
    for card in imported_cards {
        let Some(card_id) = card["id"].as_str() else {
            continue;
        };
        let content = read_cached_card_content(app, store, card_id)?;
        batch.push(OutboxBatchItem {
            entity_kind: OutboxEntityKind::Card,
            entity_id: card_id.to_string(),
            operation: OutboxOperation::Upsert,
            payload: build_card_outbox_payload(card, content, 0),
        });
        for (sub_id, att) in collect_card_attachment_refs(card) {
            if let Some(item) = make_attachment_outbox_item(
                card_id,
                sub_id.as_deref(),
                &att,
                OutboxOperation::Upsert,
            ) {
                batch.push(item);
            }
        }
    }
    enqueue_outbox_batch(app, batch)
}

#[tauri::command]
pub async fn todos_read_state(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_todo_store_lock(&app, |store| {
            let index = read_todo_index_unlocked(&app)?;
            todo_state_from_index_unlocked(&app, store, &index, todo_counts(&index))
        })
    })
    .await
    .map_err(|err| format!("todo read task failed: {err}"))?
}

#[tauri::command]
pub async fn todos_get_counts(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_todo_store_lock(&app, |_| {
            let index = read_todo_index_unlocked(&app)?;
            Ok(todo_counts(&index))
        })
    })
    .await
    .map_err(|err| format!("todo counts task failed: {err}"))?
}

#[tauri::command]
pub async fn todos_get_card_detail(app: AppHandle, card_id: String) -> Result<Value, String> {
    if card_id.trim().is_empty() {
        return Err("Missing todo card id".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_todo_store_lock(&app, |store| {
            let index = read_todo_index_unlocked(&app)?;
            let card_index = find_todo_card_index(&index, &card_id)?;
            let card = &index["cards"][card_index];
            let content = read_cached_card_content(&app, store, &card_id)?;
            Ok(enrich_card_detail_view(card, content))
        })
    })
    .await
    .map_err(|err| format!("todo detail task failed: {err}"))?
}

#[tauri::command]
pub async fn todos_create_card(
    app: AppHandle,
    payload: CreateTodoCardPayload,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (state, counts) = with_todo_store_lock(&app, |store| {
            let mut index = read_todo_index_unlocked(&app)?;
            let content = payload.content.unwrap_or_default();
            let first_content_line = content
                .lines()
                .find(|line| !line.trim().is_empty())
                .unwrap_or("");
            let title = safe_todo_title(
                payload.title.as_deref().unwrap_or(first_content_line),
                "新待办",
            );
            let now = crate::timestamp_string();
            let board_id = todo_board_id(&index);
            let column_id = payload
                .column_id
                .filter(|value| todo_column_ids(&index).contains(value))
                .unwrap_or_else(|| "todo".to_string());
            let card_id = create_todo_id("card");
            let actor_id = current_actor_id(&app);
            let position = column_position_for_prepend(&index, &column_id);
            let subtasks = payload
                .subtasks
                .as_deref()
                .map(|items| normalize_subtasks_from_inputs(items, &now))
                .unwrap_or_default();
            let card = json!({
                "id": card_id,
                "boardId": board_id,
                "columnId": column_id,
                "title": title,
                "tags": [],
                "archived": false,
                "subtasks": subtasks,
                "attachments": [],
                "coverAttachmentId": Value::Null,
                "position": position,
                "revision": 1,
                "updatedBy": actor_id,
                "deletedAt": Value::Null,
                "createdAt": now,
                "updatedAt": now,
            });
            let card_snapshot = build_card_outbox_payload(&card, content.clone(), 0);

            index["cards"]
                .as_array_mut()
                .ok_or_else(|| "todo index cards is not an array".to_string())?
                .push(card);
            prepend_card_order(&mut index, &column_id, &card_id)?;
            index["boards"][0]["updatedAt"] = json!(crate::timestamp_string());
            write_todo_card_content_unlocked(&app, &card_id, &content)?;
            if let Err(err) = write_todo_index_unlocked(&app, &index) {
                if let Err(remove_err) = fs::remove_file(todo_card_path(&app, &card_id)?) {
                    if remove_err.kind() != std::io::ErrorKind::NotFound {
                        return Err(format!(
                            "{err}; additionally failed to remove orphan todo card content: {remove_err}"
                        ));
                    }
                }
                return Err(err);
            }
            if let Ok(mut cache) = store.content_cache.lock() {
                cache.insert(card_id.clone(), content);
            }
            enqueue_outbox_batch(
                &app,
                vec![OutboxBatchItem {
                    entity_kind: OutboxEntityKind::Card,
                    entity_id: card_id.clone(),
                    operation: OutboxOperation::Upsert,
                    payload: card_snapshot,
                }],
            )?;
            let counts = todo_counts(&index);
            let state = todo_state_from_cache_or_disk(&app, store, &index, counts.clone())?;
            Ok((state, counts))
        })?;
        emit_todo_counts(&app, &counts)?;
        Ok(state)
    })
    .await
    .map_err(|err| format!("todo create task failed: {err}"))?
}

#[tauri::command]
pub async fn todos_update_card(
    app: AppHandle,
    payload: UpdateTodoCardPayload,
) -> Result<Value, String> {
    if payload.id.trim().is_empty() {
        return Err("Missing todo card id".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let (state, counts) = with_todo_store_lock(&app, |store| {
            let mut index = read_todo_index_unlocked(&app)?;
            let valid_column_ids = todo_column_ids(&index);
            let card_index = find_todo_card_index(&index, &payload.id)?;
            let now = crate::timestamp_string();

            if let Some(title) = payload.title {
                index["cards"][card_index]["title"] = json!(safe_todo_title(&title, "未命名待办"));
            }
            if let Some(column_id) = payload.column_id {
                let current_column = index["cards"][card_index]["columnId"]
                    .as_str()
                    .unwrap_or("todo")
                    .to_string();
                if valid_column_ids.contains(&column_id) && column_id != current_column {
                    remove_card_from_orders(&mut index, &payload.id)?;
                    let next_position = column_position_for_prepend(&index, &column_id);
                    prepend_card_order(&mut index, &column_id, &payload.id)?;
                    index["cards"][card_index]["columnId"] = json!(column_id);
                    index["cards"][card_index]["position"] = json!(next_position);
                }
            }
            if let Some(tags) = payload.tags {
                let next_tags: Vec<String> = tags
                    .iter()
                    .map(|tag| safe_todo_title(tag, ""))
                    .filter(|tag| !tag.is_empty())
                    .take(8)
                    .collect();
                index["cards"][card_index]["tags"] = json!(next_tags);
            }
            if let Some(archived) = payload.archived {
                index["cards"][card_index]["archived"] = json!(archived);
            }
            let mut removed_subtask_attachments = Vec::new();
            let preserve_subtask_tombstones = is_account_sync_active(&app);
            if let Some(subtasks) = payload.subtasks {
                let existing_subtasks = index["cards"][card_index]["subtasks"].clone();
                let (merged_subtasks, removed) = merge_subtask_inputs_preserving_attachments(
                    &subtasks,
                    Some(&existing_subtasks),
                    &now,
                    preserve_subtask_tombstones,
                );
                removed_subtask_attachments = removed;
                index["cards"][card_index]["subtasks"] = Value::Array(merged_subtasks);
                if let Some(cover_id) = index["cards"][card_index]["coverAttachmentId"]
                    .as_str()
                    .map(str::to_string)
                {
                    let card_atts = index["cards"][card_index]["attachments"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default();
                    let next_subtasks = index["cards"][card_index]["subtasks"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default();
                    if !card_has_attachment_id(&card_atts, &next_subtasks, &cover_id) {
                        index["cards"][card_index]["coverAttachmentId"] =
                            find_fallback_cover_id(&index["cards"][card_index]);
                    }
                }
            }
            let content_path = if payload.content.is_some() {
                Some(todo_card_path(&app, &payload.id)?)
            } else {
                None
            };
            let staged_content_path = if let Some(content_path) = &content_path {
                stage_todo_card_content_delete(content_path, &payload.id)?
            } else {
                None
            };
            let next_content = payload.content;
            if let Some(content) = &next_content {
                if let Err(err) = write_todo_card_content_unlocked(&app, &payload.id, content) {
                    if let Some(content_path) = &content_path {
                        let _ = rollback_todo_card_content_update(
                            content_path,
                            staged_content_path.as_deref(),
                        );
                    }
                    return Err(err);
                }
            }

            let actor_id = current_actor_id(&app);
            let base_revision = index["cards"][card_index]["revision"].as_u64().unwrap_or(1);
            bump_card_revision(&mut index["cards"][card_index], &actor_id, &now);
            let updated_card = index["cards"][card_index].clone();
            index["boards"][0]["updatedAt"] = json!(now);
            if let Err(err) = write_todo_index_unlocked(&app, &index) {
                if let Some(content_path) = &content_path {
                    if let Err(restore_err) = rollback_todo_card_content_update(
                        content_path,
                        staged_content_path.as_deref(),
                    ) {
                        return Err(format!(
                            "{err}; additionally failed to restore todo card content: {restore_err}"
                        ));
                    }
                }
                return Err(err);
            }
            if let Some(staged_path) = staged_content_path {
                remove_staged_todo_card_content(&staged_path);
            }
            let mut outbox_batch = Vec::new();
            for orphan_att in &removed_subtask_attachments {
                if let Some(orphan_id) = orphan_att["id"].as_str() {
                    let card_atts = index["cards"][card_index]["attachments"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default();
                    let next_subtasks = index["cards"][card_index]["subtasks"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default();
                    if !card_has_attachment_id(&card_atts, &next_subtasks, orphan_id) {
                        remove_attachment_files(&app, &payload.id, orphan_att)?;
                        if let Some(item) = make_attachment_outbox_item(
                            &payload.id,
                            None,
                            orphan_att,
                            OutboxOperation::Delete,
                        ) {
                            outbox_batch.push(item);
                        }
                    }
                }
            }
            let latest_content = if let Some(content) = next_content {
                if let Ok(mut cache) = store.content_cache.lock() {
                    cache.insert(payload.id.clone(), content.clone());
                }
                content
            } else {
                read_cached_card_content(&app, store, &payload.id)?
            };
            outbox_batch.insert(
                0,
                OutboxBatchItem {
                    entity_kind: OutboxEntityKind::Card,
                    entity_id: payload.id.clone(),
                    operation: OutboxOperation::Upsert,
                    payload: build_card_outbox_payload(
                        &updated_card,
                        latest_content,
                        base_revision,
                    ),
                },
            );
            enqueue_outbox_batch(&app, outbox_batch)?;
            let counts = todo_counts(&index);
            let state = todo_state_from_cache_or_disk(&app, store, &index, counts.clone())?;
            Ok((state, counts))
        })?;
        emit_todo_counts(&app, &counts)?;
        Ok(state)
    })
    .await
    .map_err(|err| format!("todo update task failed: {err}"))?
}

#[tauri::command]
pub async fn todos_delete_card(app: AppHandle, card_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (state, counts) = with_todo_store_lock(&app, |store| {
            let mut index = read_todo_index_unlocked(&app)?;
            let now = crate::timestamp_string();
            let sync_active = is_account_sync_active(&app);
            let mut deleted_snapshot = json!({ "id": card_id.clone(), "deletedAt": now.clone() });
            let mut deleted_attachments = Vec::new();

            if sync_active {
                if let Ok(card_index) = find_todo_card_index(&index, &card_id) {
                    let actor_id = current_actor_id(&app);
                    let card = &mut index["cards"][card_index];
                    deleted_attachments = collect_card_attachment_refs(card);
                    let base_revision = card["revision"].as_u64().unwrap_or(1);
                    card["deletedAt"] = json!(now.clone());
                    card["attachments"] = json!([]);
                    card["subtasks"] = json!([]);
                    card["coverAttachmentId"] = Value::Null;
                    bump_card_revision(card, &actor_id, &now);
                    deleted_snapshot =
                        build_card_outbox_payload(card, String::new(), base_revision);
                }
            } else {
                index["cards"]
                    .as_array_mut()
                    .ok_or_else(|| "todo index cards is not an array".to_string())?
                    .retain(|card| card["id"].as_str() != Some(card_id.as_str()));
            }
            remove_card_from_orders(&mut index, &card_id)?;
            index["boards"][0]["updatedAt"] = json!(now);
            let card_path = todo_card_path(&app, &card_id)?;
            let staged_content_path = stage_todo_card_content_delete(&card_path, &card_id)?;
            let staged_attachments_dir = stage_card_attachments_delete(&app, &card_id)?;
            if let Err(err) = write_todo_index_unlocked(&app, &index) {
                rollback_card_attachments_delete(staged_attachments_dir.as_ref());
                if let Some(staged_path) = &staged_content_path {
                    let _ = fs::rename(staged_path, &card_path);
                }
                return Err(err);
            }
            if let Some(staged_path) = staged_content_path {
                remove_staged_todo_card_content(&staged_path);
            }
            finalize_card_attachments_delete(staged_attachments_dir.as_ref());
            if let Ok(mut cache) = store.content_cache.lock() {
                cache.remove(&card_id);
            }
            let mut outbox_batch = vec![OutboxBatchItem {
                entity_kind: OutboxEntityKind::Card,
                entity_id: card_id.clone(),
                operation: OutboxOperation::Delete,
                payload: deleted_snapshot,
            }];
            for (sub_id, att) in &deleted_attachments {
                if let Some(item) = make_attachment_outbox_item(
                    &card_id,
                    sub_id.as_deref(),
                    att,
                    OutboxOperation::Delete,
                ) {
                    outbox_batch.push(item);
                }
            }
            enqueue_outbox_batch(&app, outbox_batch)?;
            let counts = todo_counts(&index);
            let state = todo_state_from_cache_or_disk(&app, store, &index, counts.clone())?;
            Ok((state, counts))
        })?;
        emit_todo_counts(&app, &counts)?;
        Ok(state)
    })
    .await
    .map_err(|err| format!("todo delete task failed: {err}"))?
}

#[tauri::command]
pub async fn todos_move_card(
    app: AppHandle,
    payload: MoveTodoCardPayload,
) -> Result<Value, String> {
    if payload.id.trim().is_empty() {
        return Err("Missing todo card id".to_string());
    }
    if payload.column_id.trim().is_empty() {
        return Err("Missing todo column id".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let (state, counts) = with_todo_store_lock(&app, |store| {
            let mut index = read_todo_index_unlocked(&app)?;
            let valid_column_ids = todo_column_ids(&index);
            if !valid_column_ids.contains(&payload.column_id) {
                return Err("Todo column not found".to_string());
            }
            let card_index = find_todo_card_index(&index, &payload.id)?;
            remove_card_from_orders(&mut index, &payload.id)?;
            let next_position = column_position_for_insert(
                &index,
                &payload.column_id,
                payload.before_id.as_deref(),
            );
            insert_card_order(
                &mut index,
                &payload.column_id,
                &payload.id,
                payload.before_id.as_deref(),
            )?;
            let now = crate::timestamp_string();
            let actor_id = current_actor_id(&app);
            let base_revision = index["cards"][card_index]["revision"].as_u64().unwrap_or(1);
            index["cards"][card_index]["columnId"] = json!(payload.column_id.clone());
            index["cards"][card_index]["position"] = json!(next_position);
            bump_card_revision(&mut index["cards"][card_index], &actor_id, &now);
            let moved_card = index["cards"][card_index].clone();
            index["boards"][0]["updatedAt"] = json!(now);
            write_todo_index_unlocked(&app, &index)?;
            let content = read_cached_card_content(&app, store, &payload.id)?;
            enqueue_outbox_batch(
                &app,
                vec![OutboxBatchItem {
                    entity_kind: OutboxEntityKind::Card,
                    entity_id: payload.id.clone(),
                    operation: OutboxOperation::Upsert,
                    payload: build_card_outbox_payload(&moved_card, content, base_revision),
                }],
            )?;
            let counts = todo_counts(&index);
            let state = todo_state_from_cache_or_disk(&app, store, &index, counts.clone())?;
            Ok((state, counts))
        })?;
        emit_todo_counts(&app, &counts)?;
        Ok(state)
    })
    .await
    .map_err(|err| format!("todo move task failed: {err}"))?
}

pub(super) fn emit_todos_updated(app: &AppHandle, state: &Value) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("todos") {
        window
            .emit("todos-updated", state.clone())
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

pub(crate) fn refresh_and_emit_active_todo_state(app: &AppHandle) -> Result<(), String> {
    let (state, counts) = with_todo_store_lock(app, |store| {
        let index = read_todo_index_unlocked(app)?;
        let counts = todo_counts(&index);
        let state = todo_state_from_index_unlocked(app, store, &index, counts.clone())?;
        Ok((state, counts))
    })?;
    emit_todo_counts(app, &counts)?;
    emit_todos_updated(app, &state)
}

pub(super) fn emit_todo_counts(app: &AppHandle, counts: &Value) -> Result<(), String> {
    for label in ["handle", "main", "todos", "capture"] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .emit("todo-counts-updated", counts.clone())
                .map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn stage_todo_card_content_delete(
    card_path: &Path,
    card_id: &str,
) -> Result<Option<PathBuf>, String> {
    match fs::metadata(card_path) {
        Ok(metadata) if metadata.is_file() => {
            let staged_path = staged_todo_card_delete_path(card_path, card_id);
            fs::rename(card_path, &staged_path)
                .map_err(|err| format!("failed to stage todo card content deletion: {err}"))?;
            Ok(Some(staged_path))
        }
        Ok(_) => Err("todo card content path is not a file".to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("failed to inspect todo card content: {err}")),
    }
}

fn rollback_todo_card_content_update(
    card_path: &Path,
    staged_path: Option<&Path>,
) -> Result<(), String> {
    match fs::remove_file(card_path) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => return Err(format!("failed to remove new todo card content: {err}")),
    }
    if let Some(staged_path) = staged_path {
        fs::rename(staged_path, card_path)
            .map_err(|err| format!("failed to restore previous todo card content: {err}"))?;
    }
    Ok(())
}

fn remove_staged_todo_card_content(staged_path: &Path) {
    if let Err(err) = fs::remove_file(staged_path) {
        eprintln!(
            "[TIDYDESK] Failed to remove staged todo content {}: {err}",
            staged_path.display()
        );
    }
}

fn staged_todo_card_delete_path(card_path: &Path, card_id: &str) -> PathBuf {
    let file_name = card_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("todo-card.md");
    card_path.with_file_name(format!(
        "{file_name}.{}.{}.deleting",
        safe_todo_card_delete_suffix(card_id),
        crate::timestamp_string()
    ))
}

fn safe_todo_card_delete_suffix(card_id: &str) -> String {
    card_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn card_outbox_payload_includes_content_and_base_revision() {
        let card = json!({
            "id": "card-1",
            "title": "巡检",
            "revision": 3
        });
        let payload = build_card_outbox_payload(&card, "# 详细步骤\n- [ ] 检查".to_string(), 2);
        assert_eq!(payload["id"], json!("card-1"));
        assert_eq!(payload["revision"], json!(3));
        assert_eq!(payload["baseRevision"], json!(2));
        assert_eq!(payload["content"], json!("# 详细步骤\n- [ ] 检查"));
    }

    #[test]
    fn attachment_outbox_item_builds_upsert_and_delete_events() {
        let att = json!({
            "id": "att-9",
            "kind": "image",
            "originalName": "shot.png",
            "fileName": "att-9.png",
            "thumbFileName": "thumb_att-9.png",
            "sha256": "deadbeef",
            "mimeType": "image/png",
            "sizeBytes": 2048,
            "width": 800,
            "height": 600,
            "orientation": "landscape",
            "focalPoint": { "x": 0.5, "y": 0.5 },
            "previewMode": "cover",
            "createdAt": "1234"
        });
        let upsert =
            make_attachment_outbox_item("card-1", Some("sub-2"), &att, OutboxOperation::Upsert)
                .unwrap();
        assert_eq!(upsert.entity_kind, OutboxEntityKind::Attachment);
        assert_eq!(upsert.entity_id, "att-9");
        assert_eq!(upsert.payload["subtaskId"], json!("sub-2"));
        assert_eq!(upsert.payload["sha256"], json!("deadbeef"));

        let delete =
            make_attachment_outbox_item("card-1", None, &att, OutboxOperation::Delete).unwrap();
        assert_eq!(delete.operation, OutboxOperation::Delete);
        assert_eq!(delete.payload["attachmentId"], json!("att-9"));
        assert_eq!(delete.payload["fileName"], json!("att-9.png"));
    }

    #[test]
    fn collect_card_attachment_refs_gathers_card_and_subtask_items() {
        let card = json!({
            "id": "card-1",
            "attachments": [{ "id": "a1", "fileName": "a1.png" }],
            "subtasks": [
                { "id": "sub-1", "attachments": [{ "id": "a2", "fileName": "a2.png" }] },
                { "id": "sub-2", "attachments": [] }
            ]
        });
        let refs = collect_card_attachment_refs(&card);
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].0, None);
        assert_eq!(refs[0].1["id"], json!("a1"));
        assert_eq!(refs[1].0.as_deref(), Some("sub-1"));
        assert_eq!(refs[1].1["id"], json!("a2"));
    }
}
