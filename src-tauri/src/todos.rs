use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTodoCardPayload {
    title: Option<String>,
    content: Option<String>,
    column_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTodoCardPayload {
    id: String,
    title: Option<String>,
    content: Option<String>,
    column_id: Option<String>,
    tags: Option<Vec<String>>,
    archived: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveTodoCardPayload {
    id: String,
    column_id: String,
    before_id: Option<String>,
}

#[tauri::command]
pub fn todos_read_state(app: AppHandle) -> Result<Value, String> {
    todo_state(&app)
}

#[tauri::command]
pub fn todos_get_counts(app: AppHandle) -> Result<Value, String> {
    let index = read_todo_index(&app)?;
    Ok(todo_counts(&index))
}

#[tauri::command]
pub fn todos_create_card(app: AppHandle, payload: CreateTodoCardPayload) -> Result<Value, String> {
    let mut index = read_todo_index(&app)?;
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

    index["cards"].as_array_mut()
        .ok_or_else(|| "todo index cards is not an array".to_string())?
        .push(card);
    prepend_card_order(&mut index, &column_id, &card_id)?;
    index["boards"][0]["updatedAt"] = json!(now);
    write_todo_card_content(&app, &card_id, &content)?;
    write_todo_index(&app, &index)?;
    broadcast_todo_counts(&app)?;
    todo_state(&app)
}

#[tauri::command]
pub fn todos_update_card(app: AppHandle, payload: UpdateTodoCardPayload) -> Result<Value, String> {
    if payload.id.trim().is_empty() {
        return Err("Missing todo card id".to_string());
    }

    let mut index = read_todo_index(&app)?;
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
    if let Some(content) = payload.content {
        write_todo_card_content(&app, &payload.id, &content)?;
    }

    index["cards"][card_index]["updatedAt"] = json!(now.clone());
    index["boards"][0]["updatedAt"] = json!(now);
    write_todo_index(&app, &index)?;
    broadcast_todo_counts(&app)?;
    todo_state(&app)
}

#[tauri::command]
pub fn todos_delete_card(app: AppHandle, card_id: String) -> Result<Value, String> {
    let mut index = read_todo_index(&app)?;
    index["cards"]
        .as_array_mut()
        .ok_or_else(|| "todo index cards is not an array".to_string())?
        .retain(|card| card["id"].as_str() != Some(card_id.as_str()));
    remove_card_from_orders(&mut index, &card_id)?;
    index["boards"][0]["updatedAt"] = json!(crate::timestamp_string());
    let card_path = todo_card_path(&app, &card_id)?;
    if let Err(err) = fs::remove_file(card_path) {
        if err.kind() != std::io::ErrorKind::NotFound {
            return Err(format!("failed to delete todo card content: {err}"));
        }
    }
    write_todo_index(&app, &index)?;
    broadcast_todo_counts(&app)?;
    todo_state(&app)
}

#[tauri::command]
pub fn todos_move_card(app: AppHandle, payload: MoveTodoCardPayload) -> Result<Value, String> {
    if payload.id.trim().is_empty() {
        return Err("Missing todo card id".to_string());
    }
    if payload.column_id.trim().is_empty() {
        return Err("Missing todo column id".to_string());
    }

    let mut index = read_todo_index(&app)?;
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
    index["cards"][card_index]["columnId"] = json!(payload.column_id);
    index["cards"][card_index]["updatedAt"] = json!(now.clone());
    index["boards"][0]["updatedAt"] = json!(now);
    write_todo_index(&app, &index)?;
    broadcast_todo_counts(&app)?;
    todo_state(&app)
}

fn todo_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("todos"))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

fn todo_cards_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(todo_root(app)?.join("cards"))
}

fn todo_index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(todo_root(app)?.join("boards.json"))
}

fn ensure_todo_storage(app: &AppHandle) -> Result<(), String> {
    fs::create_dir_all(todo_cards_root(app)?)
        .map_err(|err| format!("failed to create todo storage: {err}"))?;
    let index_path = todo_index_path(app)?;
    if !index_path.exists() {
        write_todo_index(app, &create_default_todo_index())?;
    }
    Ok(())
}

fn create_default_todo_index() -> Value {
    let now = crate::timestamp_string();
    json!({
        "version": 1,
        "activeBoardId": "default-board",
        "boards": [{
            "id": "default-board",
            "title": "待办",
            "columns": [
                { "id": "todo", "title": "待处理" },
                { "id": "doing", "title": "进行中" },
                { "id": "done", "title": "已完成" }
            ],
            "cardOrder": {
                "todo": [],
                "doing": [],
                "done": []
            },
            "createdAt": now,
            "updatedAt": now
        }],
        "cards": []
    })
}

fn read_todo_index(app: &AppHandle) -> Result<Value, String> {
    ensure_todo_storage(app)?;
    let index_path = todo_index_path(app)?;
    let raw = fs::read_to_string(index_path).unwrap_or_default();
    let parsed =
        serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| create_default_todo_index());
    let normalized = normalize_todo_index(parsed);
    write_todo_index(app, &normalized)?;
    Ok(normalized)
}

fn write_todo_index(app: &AppHandle, index: &Value) -> Result<(), String> {
    fs::create_dir_all(todo_root(app)?)
        .map_err(|err| format!("failed to create todo root: {err}"))?;
    let normalized = normalize_todo_index(index.clone());
    let content = serde_json::to_string_pretty(&normalized)
        .map_err(|err| format!("failed to serialize todo index: {err}"))?;
    fs::write(todo_index_path(app)?, content)
        .map_err(|err| format!("failed to write todo index: {err}"))
}

fn normalize_todo_index(index: Value) -> Value {
    let mut normalized = if index.is_object() {
        index
    } else {
        create_default_todo_index()
    };
    let fallback = create_default_todo_index();
    let mut board = normalized["boards"]
        .as_array()
        .and_then(|boards| boards.first())
        .cloned()
        .unwrap_or_else(|| fallback["boards"][0].clone());

    board["id"] = json!(board["id"].as_str().unwrap_or("default-board"));
    board["title"] = json!(safe_todo_title(
        board["title"].as_str().unwrap_or("待办"),
        "待办"
    ));
    if !board["columns"]
        .as_array()
        .map(|value| !value.is_empty())
        .unwrap_or(false)
    {
        board["columns"] = fallback["boards"][0]["columns"].clone();
    }
    if !board["cardOrder"].is_object() {
        board["cardOrder"] = json!({});
    }

    let column_ids: Vec<String> = board["columns"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|column| column["id"].as_str().map(str::to_string))
        .collect();
    for column_id in &column_ids {
        if !board["cardOrder"][column_id].is_array() {
            board["cardOrder"][column_id] = json!([]);
        }
    }

    let mut cards = Vec::new();
    let mut card_ids = HashSet::new();
    if let Some(raw_cards) = normalized["cards"].as_array() {
        for card in raw_cards {
            let Some(id) = card["id"].as_str() else {
                continue;
            };
            let column_id = card["columnId"]
                .as_str()
                .filter(|value| column_ids.contains(&value.to_string()))
                .unwrap_or("todo");
            card_ids.insert(id.to_string());
            cards.push(json!({
                "id": id,
                "boardId": card["boardId"].as_str().unwrap_or(board["id"].as_str().unwrap_or("default-board")),
                "columnId": column_id,
                "title": safe_todo_title(card["title"].as_str().unwrap_or("未命名待办"), "未命名待办"),
                "tags": card["tags"].as_array().cloned().unwrap_or_default(),
                "archived": card["archived"].as_bool().unwrap_or(false),
                "createdAt": card["createdAt"].as_str().unwrap_or_else(|| crate::timestamp_string().leak()),
                "updatedAt": card["updatedAt"].as_str().unwrap_or_else(|| crate::timestamp_string().leak()),
            }));
        }
    }

    for column_id in &column_ids {
        let filtered: Vec<Value> = board["cardOrder"][column_id]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|id| id.as_str())
            .filter(|id| card_ids.contains(*id))
            .map(|id| json!(id))
            .collect();
        board["cardOrder"][column_id] = json!(filtered);
    }
    for card in &cards {
        let Some(card_id) = card["id"].as_str() else { continue; };
        let column_id = card["columnId"].as_str().unwrap_or("todo");
        if let Some(order) = board["cardOrder"][column_id].as_array_mut() {
            if !order.iter().any(|id| id.as_str() == Some(card_id)) {
                order.push(json!(card_id));
            }
        }
    }

    normalized["version"] = json!(1);
    normalized["activeBoardId"] = json!(board["id"].as_str().unwrap_or("default-board"));
    normalized["boards"] = json!([board]);
    normalized["cards"] = json!(cards);
    normalized
}

fn todo_state(app: &AppHandle) -> Result<Value, String> {
    let index = read_todo_index(app)?;
    let cards = index["cards"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|card| {
            let mut next = card.clone();
            let card_id = next["id"].as_str().unwrap_or_default().to_string();
            next["content"] = json!(read_todo_card_content(app, &card_id).unwrap_or_default());
            next
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "activeBoardId": index["activeBoardId"],
        "boards": index["boards"],
        "cards": cards,
        "counts": todo_counts(&index),
    }))
}

fn todo_counts(index: &Value) -> Value {
    let mut total = 0;
    let mut open = 0;
    let mut done = 0;
    for card in index["cards"].as_array().unwrap_or(&Vec::new()) {
        if card["archived"].as_bool().unwrap_or(false) {
            continue;
        }
        total += 1;
        if card["columnId"].as_str() == Some("done") {
            done += 1;
        } else {
            open += 1;
        }
    }
    json!({ "total": total, "open": open, "done": done })
}

fn broadcast_todo_counts(app: &AppHandle) -> Result<(), String> {
    let index = read_todo_index(app)?;
    let counts = todo_counts(&index);
    for label in ["handle", "main", "todos", "capture"] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .emit("todo-counts-updated", counts.clone())
                .map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn todo_board_id(index: &Value) -> String {
    index["boards"][0]["id"]
        .as_str()
        .unwrap_or("default-board")
        .to_string()
}

fn todo_column_ids(index: &Value) -> HashSet<String> {
    index["boards"][0]["columns"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|column| column["id"].as_str().map(str::to_string))
        .collect()
}

fn find_todo_card_index(index: &Value, card_id: &str) -> Result<usize, String> {
    index["cards"]
        .as_array()
        .ok_or_else(|| "todo index cards is not an array".to_string())?
        .iter()
        .position(|card| card["id"].as_str() == Some(card_id))
        .ok_or_else(|| "Todo card not found".to_string())
}

fn remove_card_from_orders(index: &mut Value, card_id: &str) -> Result<(), String> {
    let column_ids: Vec<String> = todo_column_ids(index).into_iter().collect();
    for column_id in column_ids {
        if let Some(order) = index["boards"][0]["cardOrder"][&column_id].as_array_mut() {
            order.retain(|id| id.as_str() != Some(card_id));
        }
    }
    Ok(())
}

fn prepend_card_order(index: &mut Value, column_id: &str, card_id: &str) -> Result<(), String> {
    let order = index["boards"][0]["cardOrder"][column_id]
        .as_array_mut()
        .ok_or_else(|| "Todo card order not found".to_string())?;
    order.insert(0, json!(card_id));
    Ok(())
}

fn insert_card_order(
    index: &mut Value,
    column_id: &str,
    card_id: &str,
    before_id: Option<&str>,
) -> Result<(), String> {
    let order = index["boards"][0]["cardOrder"][column_id]
        .as_array_mut()
        .ok_or_else(|| "Todo card order not found".to_string())?;
    if let Some(before_id) = before_id {
        if let Some(position) = order.iter().position(|id| id.as_str() == Some(before_id)) {
            order.insert(position, json!(card_id));
            return Ok(());
        }
    }
    order.push(json!(card_id));
    Ok(())
}

fn todo_card_path(app: &AppHandle, card_id: &str) -> Result<PathBuf, String> {
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

fn read_todo_card_content(app: &AppHandle, card_id: &str) -> Result<String, String> {
    match fs::read_to_string(todo_card_path(app, card_id)?) {
        Ok(content) => Ok(content),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(format!("failed to read todo card content: {err}")),
    }
}

fn write_todo_card_content(app: &AppHandle, card_id: &str, content: &str) -> Result<(), String> {
    fs::create_dir_all(todo_cards_root(app)?)
        .map_err(|err| format!("failed to create todo cards root: {err}"))?;
    fs::write(todo_card_path(app, card_id)?, content)
        .map_err(|err| format!("failed to write todo card content: {err}"))
}

fn safe_todo_title(title: &str, fallback: &str) -> String {
    let normalized = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let value = if normalized.is_empty() {
        fallback
    } else {
        &normalized
    };
    value.chars().take(120).collect()
}

fn create_todo_id(prefix: &str) -> String {
    format!("{prefix}-{}-{}", crate::timestamp_string(), std::process::id())
}
