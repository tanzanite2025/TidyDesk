use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTodoCardPayload {
    pub title: Option<String>,
    pub content: Option<String>,
    pub column_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTodoCardPayload {
    pub id: String,
    pub title: Option<String>,
    pub content: Option<String>,
    pub column_id: Option<String>,
    pub tags: Option<Vec<String>>,
    pub archived: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveTodoCardPayload {
    pub id: String,
    pub column_id: String,
    pub before_id: Option<String>,
}

pub(super) fn create_default_todo_index() -> Value {
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

pub(super) fn normalize_todo_index(index: Value) -> Value {
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
            let Some(card_obj) = card.as_object() else {
                continue;
            };
            let Some(id) = card_obj.get("id").and_then(Value::as_str) else {
                continue;
            };
            let column_id = card_obj
                .get("columnId")
                .and_then(Value::as_str)
                .filter(|value| column_ids.iter().any(|column| column == *value))
                .unwrap_or("todo")
                .to_string();
            let created_at = card_obj
                .get("createdAt")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(crate::timestamp_string);
            let updated_at = card_obj
                .get("updatedAt")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(crate::timestamp_string);
            let board_id = card_obj
                .get("boardId")
                .and_then(Value::as_str)
                .unwrap_or(board["id"].as_str().unwrap_or("default-board"))
                .to_string();
            let title = safe_todo_title(
                card_obj
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("未命名待办"),
                "未命名待办",
            );
            let tags = card_obj
                .get("tags")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let archived = card_obj
                .get("archived")
                .and_then(Value::as_bool)
                .unwrap_or(false);

            card_ids.insert(id.to_string());
            let mut next_card = card_obj.clone();
            next_card.insert("id".to_string(), json!(id));
            next_card.insert("boardId".to_string(), json!(board_id));
            next_card.insert("columnId".to_string(), json!(column_id));
            next_card.insert("title".to_string(), json!(title));
            next_card.insert("tags".to_string(), Value::Array(tags));
            next_card.insert("archived".to_string(), json!(archived));
            next_card.insert("createdAt".to_string(), json!(created_at));
            next_card.insert("updatedAt".to_string(), json!(updated_at));
            cards.push(Value::Object(next_card));
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
        let Some(card_id) = card["id"].as_str() else {
            continue;
        };
        let column_id = card["columnId"].as_str().unwrap_or("todo");
        if let Some(order) = board["cardOrder"][column_id].as_array_mut() {
            if !order.iter().any(|id| id.as_str() == Some(card_id)) {
                order.push(json!(card_id));
            }
        }
    }

    if normalized["version"].as_u64().unwrap_or(0) < 1 {
        normalized["version"] = json!(1);
    }
    normalized["activeBoardId"] = json!(board["id"].as_str().unwrap_or("default-board"));
    if let Some(existing_boards) = normalized["boards"].as_array_mut() {
        if existing_boards.is_empty() {
            existing_boards.push(board);
        } else {
            existing_boards[0] = board;
        }
    } else {
        normalized["boards"] = json!([board]);
    }
    normalized["cards"] = json!(cards);
    normalized
}

pub(super) fn todo_counts(index: &Value) -> Value {
    let mut total = 0;
    let mut open = 0;
    let mut done = 0;
    for card in index["cards"].as_array().into_iter().flatten() {
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

pub(super) fn todo_board_id(index: &Value) -> String {
    index["boards"][0]["id"]
        .as_str()
        .unwrap_or("default-board")
        .to_string()
}

pub(super) fn todo_column_ids(index: &Value) -> HashSet<String> {
    index["boards"][0]["columns"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|column| column["id"].as_str().map(str::to_string))
        .collect()
}

pub(super) fn find_todo_card_index(index: &Value, card_id: &str) -> Result<usize, String> {
    index["cards"]
        .as_array()
        .ok_or_else(|| "todo index cards is not an array".to_string())?
        .iter()
        .position(|card| card["id"].as_str() == Some(card_id))
        .ok_or_else(|| "Todo card not found".to_string())
}

pub(super) fn remove_card_from_orders(index: &mut Value, card_id: &str) -> Result<(), String> {
    let column_ids: Vec<String> = todo_column_ids(index).into_iter().collect();
    for column_id in column_ids {
        if let Some(order) = index["boards"][0]["cardOrder"][&column_id].as_array_mut() {
            order.retain(|id| id.as_str() != Some(card_id));
        }
    }
    Ok(())
}

pub(super) fn prepend_card_order(
    index: &mut Value,
    column_id: &str,
    card_id: &str,
) -> Result<(), String> {
    let order = index["boards"][0]["cardOrder"][column_id]
        .as_array_mut()
        .ok_or_else(|| "Todo card order not found".to_string())?;
    order.insert(0, json!(card_id));
    Ok(())
}

pub(super) fn insert_card_order(
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

pub(super) fn safe_todo_title(title: &str, fallback: &str) -> String {
    let normalized = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let value = if normalized.is_empty() {
        fallback
    } else {
        &normalized
    };
    value.chars().take(120).collect()
}

pub(super) fn create_todo_id(prefix: &str) -> String {
    format!(
        "{prefix}-{}-{}",
        crate::timestamp_string(),
        std::process::id()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_todo_index_is_idempotent_for_clean_state() {
        let index = create_default_todo_index();
        let normalized = normalize_todo_index(index.clone());
        assert_eq!(normalized, index);
    }

    #[test]
    fn normalize_todo_index_preserves_future_extension_fields() {
        let index = json!({
            "version": 2,
            "activeBoardId": "default-board",
            "customMeta": { "mediaSchema": "v2" },
            "boards": [
                {
                    "id": "default-board",
                    "title": "待办",
                    "columns": [
                        { "id": "todo", "title": "待处理" },
                        { "id": "doing", "title": "进行中" },
                        { "id": "done", "title": "已完成" }
                    ],
                    "cardOrder": {
                        "todo": ["card-1"],
                        "doing": [],
                        "done": []
                    },
                    "boardTheme": "slate",
                    "createdAt": "100",
                    "updatedAt": "100"
                },
                {
                    "id": "board-2",
                    "title": "拍照巡检"
                }
            ],
            "cards": [
                {
                    "id": "card-1",
                    "boardId": "default-board",
                    "columnId": "todo",
                    "title": "拍照核对设备",
                    "tags": ["photo"],
                    "archived": false,
                    "createdAt": "100",
                    "updatedAt": "100",
                    "coverAttachmentId": "att-1",
                    "attachments": [
                        {
                            "id": "att-1",
                            "kind": "image",
                            "relativePath": "attachments/card-1/photo.png"
                        }
                    ],
                    "checklist": [{ "id": "chk-1", "text": "拍正反面", "done": false }]
                }
            ]
        });

        let normalized = normalize_todo_index(index);
        assert_eq!(normalized["version"], json!(2));
        assert_eq!(normalized["customMeta"]["mediaSchema"], json!("v2"));
        assert_eq!(normalized["boards"].as_array().map(Vec::len), Some(2));
        assert_eq!(normalized["boards"][0]["boardTheme"], json!("slate"));
        assert_eq!(normalized["cards"][0]["coverAttachmentId"], json!("att-1"));
        assert_eq!(
            normalized["cards"][0]["attachments"][0]["relativePath"],
            json!("attachments/card-1/photo.png")
        );
        assert_eq!(
            normalized["cards"][0]["checklist"][0]["text"],
            json!("拍正反面")
        );
    }
}
