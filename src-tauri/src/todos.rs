use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

// 重新导出底层定义的类型和辅助方法，确保接口契约完全一致
#[allow(unused_imports)]
pub use crate::todos_rules::{
    create_todo_id, find_todo_card_index, insert_card_order, prepend_card_order,
    read_todo_card_content_unlocked, read_todo_index_unlocked, remove_card_from_orders,
    safe_todo_title, todo_board_id, todo_card_path, todo_column_ids, todo_counts,
    todo_state_from_index_unlocked, with_todo_store_lock, write_todo_card_content_unlocked,
    write_todo_index_unlocked, CreateTodoCardPayload, MoveTodoCardPayload, UpdateTodoCardPayload,
};

#[derive(Debug, Default)]
pub struct TodoStoreState(pub Mutex<()>);

#[tauri::command]
pub fn todos_read_state(app: AppHandle) -> Result<Value, String> {
    with_todo_store_lock(&app, || {
        let index = read_todo_index_unlocked(&app)?;
        todo_state_from_index_unlocked(&app, &index, todo_counts(&index))
    })
}

#[tauri::command]
pub fn todos_get_counts(app: AppHandle) -> Result<Value, String> {
    with_todo_store_lock(&app, || {
        let index = read_todo_index_unlocked(&app)?;
        Ok(todo_counts(&index))
    })
}

#[tauri::command]
pub fn todos_create_card(app: AppHandle, payload: CreateTodoCardPayload) -> Result<Value, String> {
    let (state, counts) = with_todo_store_lock(&app, || {
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
        let card = json!({
            "id": card_id,
            "boardId": board_id,
            "columnId": column_id,
            "title": title,
            "tags": [],
            "archived": false,
            "createdAt": now,
            "updatedAt": now,
        });

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
        let counts = todo_counts(&index);
        let state = todo_state_from_index_unlocked(&app, &index, counts.clone())?;
        Ok((state, counts))
    })?;
    emit_todo_counts(&app, &counts)?;
    Ok(state)
}

#[tauri::command]
pub fn todos_update_card(app: AppHandle, payload: UpdateTodoCardPayload) -> Result<Value, String> {
    if payload.id.trim().is_empty() {
        return Err("Missing todo card id".to_string());
    }

    let (state, counts) = with_todo_store_lock(&app, || {
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
                prepend_card_order(&mut index, &column_id, &payload.id)?;
                index["cards"][card_index]["columnId"] = json!(column_id);
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
        if let Some(content) = payload.content {
            if let Err(err) = write_todo_card_content_unlocked(&app, &payload.id, &content) {
                if let Some(content_path) = &content_path {
                    let _ = rollback_todo_card_content_update(
                        content_path,
                        staged_content_path.as_deref(),
                    );
                }
                return Err(err);
            }
        }

        index["cards"][card_index]["updatedAt"] = json!(now.clone());
        index["boards"][0]["updatedAt"] = json!(now);
        if let Err(err) = write_todo_index_unlocked(&app, &index) {
            if let Some(content_path) = &content_path {
                if let Err(restore_err) =
                    rollback_todo_card_content_update(content_path, staged_content_path.as_deref())
                {
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
        let counts = todo_counts(&index);
        let state = todo_state_from_index_unlocked(&app, &index, counts.clone())?;
        Ok((state, counts))
    })?;
    emit_todo_counts(&app, &counts)?;
    Ok(state)
}

#[tauri::command]
pub fn todos_delete_card(app: AppHandle, card_id: String) -> Result<Value, String> {
    let (state, counts) = with_todo_store_lock(&app, || {
        let mut index = read_todo_index_unlocked(&app)?;
        index["cards"]
            .as_array_mut()
            .ok_or_else(|| "todo index cards is not an array".to_string())?
            .retain(|card| card["id"].as_str() != Some(card_id.as_str()));
        remove_card_from_orders(&mut index, &card_id)?;
        index["boards"][0]["updatedAt"] = json!(crate::timestamp_string());
        let card_path = todo_card_path(&app, &card_id)?;
        let staged_content_path = stage_todo_card_content_delete(&card_path, &card_id)?;
        if let Err(err) = write_todo_index_unlocked(&app, &index) {
            if let Some(staged_path) = &staged_content_path {
                let _ = fs::rename(staged_path, &card_path);
            }
            return Err(err);
        }
        if let Some(staged_path) = staged_content_path {
            remove_staged_todo_card_content(&staged_path);
        }
        let counts = todo_counts(&index);
        let state = todo_state_from_index_unlocked(&app, &index, counts.clone())?;
        Ok((state, counts))
    })?;
    emit_todo_counts(&app, &counts)?;
    Ok(state)
}

#[tauri::command]
pub fn todos_move_card(app: AppHandle, payload: MoveTodoCardPayload) -> Result<Value, String> {
    if payload.id.trim().is_empty() {
        return Err("Missing todo card id".to_string());
    }
    if payload.column_id.trim().is_empty() {
        return Err("Missing todo column id".to_string());
    }

    let (state, counts) = with_todo_store_lock(&app, || {
        let mut index = read_todo_index_unlocked(&app)?;
        let valid_column_ids = todo_column_ids(&index);
        if !valid_column_ids.contains(&payload.column_id) {
            return Err("Todo column not found".to_string());
        }
        let card_index = find_todo_card_index(&index, &payload.id)?;
        remove_card_from_orders(&mut index, &payload.id)?;
        insert_card_order(
            &mut index,
            &payload.column_id,
            &payload.id,
            payload.before_id.as_deref(),
        )?;
        let now = crate::timestamp_string();
        index["cards"][card_index]["columnId"] = json!(payload.column_id.clone());
        index["cards"][card_index]["updatedAt"] = json!(now.clone());
        index["boards"][0]["updatedAt"] = json!(now);
        write_todo_index_unlocked(&app, &index)?;
        let counts = todo_counts(&index);
        let state = todo_state_from_index_unlocked(&app, &index, counts.clone())?;
        Ok((state, counts))
    })?;
    emit_todo_counts(&app, &counts)?;
    Ok(state)
}

fn emit_todo_counts(app: &AppHandle, counts: &Value) -> Result<(), String> {
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
