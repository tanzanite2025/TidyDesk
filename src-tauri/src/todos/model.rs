use super::ranking::{initial_rank, rank_between};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};

static TODO_ID_SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub fn is_card_deleted(card: &Value) -> bool {
    !card["deletedAt"].is_null()
}

pub fn is_subtask_deleted(subtask: &Value) -> bool {
    !subtask["deletedAt"].is_null()
}

pub(super) fn bump_card_revision(card: &mut Value, actor_id: &str, now: &str) {
    let next_rev = card["revision"].as_u64().unwrap_or(0).saturating_add(1);
    card["revision"] = json!(next_rev);
    card["updatedBy"] = json!(actor_id);
    card["updatedAt"] = json!(now);
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTodoAttachmentBytesPayload {
    pub card_id: String,
    #[serde(default)]
    pub subtask_id: Option<String>,
    pub file_name: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTodoAttachmentPayload {
    pub card_id: String,
    #[serde(default)]
    pub subtask_id: Option<String>,
    pub attachment_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTodoCardCoverPayload {
    pub card_id: String,
    pub attachment_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoFocalPointInput {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTodoAttachmentMetaPayload {
    pub card_id: String,
    #[serde(default)]
    pub subtask_id: Option<String>,
    pub attachment_id: String,
    pub focal_point: Option<TodoFocalPointInput>,
    pub preview_mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoSubtaskInput {
    pub id: Option<String>,
    pub title: String,
    pub completed: Option<bool>,
    pub position: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTodoCardPayload {
    pub title: Option<String>,
    pub content: Option<String>,
    pub column_id: Option<String>,
    pub subtasks: Option<Vec<TodoSubtaskInput>>,
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
    pub subtasks: Option<Vec<TodoSubtaskInput>>,
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
    if let Some(raw_cards) = normalized["cards"].as_array() {
        for (idx, card) in raw_cards.iter().enumerate() {
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
            let attachments = filter_valid_attachments(card_obj.get("attachments"));

            let deleted_at = card_obj
                .get("deletedAt")
                .and_then(Value::as_str)
                .filter(|v| !v.trim().is_empty())
                .map(|v| json!(v))
                .unwrap_or(Value::Null);
            let revision = card_obj
                .get("revision")
                .and_then(Value::as_u64)
                .filter(|rev| *rev >= 1)
                .unwrap_or(1);
            let updated_by = card_obj
                .get("updatedBy")
                .and_then(Value::as_str)
                .filter(|v| !v.trim().is_empty())
                .unwrap_or("local")
                .to_string();
            let position = card_obj
                .get("position")
                .and_then(Value::as_str)
                .filter(|v| !v.trim().is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| initial_rank(idx));
            let subtasks = normalize_stored_subtasks(card_obj.get("subtasks"), &updated_at);
            let cover_attachment_id = card_obj
                .get("coverAttachmentId")
                .and_then(Value::as_str)
                .filter(|cover_id| card_has_attachment_id(&attachments, &subtasks, cover_id))
                .map(|value| json!(value))
                .unwrap_or(Value::Null);

            let mut next_card = card_obj.clone();
            next_card.insert("id".to_string(), json!(id));
            next_card.insert("boardId".to_string(), json!(board_id));
            next_card.insert("columnId".to_string(), json!(column_id));
            next_card.insert("title".to_string(), json!(title));
            next_card.insert("tags".to_string(), Value::Array(tags));
            next_card.insert("archived".to_string(), json!(archived));
            next_card.insert("subtasks".to_string(), Value::Array(subtasks));
            next_card.insert("attachments".to_string(), Value::Array(attachments));
            next_card.insert("coverAttachmentId".to_string(), cover_attachment_id);
            next_card.insert("position".to_string(), json!(position));
            next_card.insert("revision".to_string(), json!(revision));
            next_card.insert("updatedBy".to_string(), json!(updated_by));
            next_card.insert("deletedAt".to_string(), deleted_at);
            next_card.insert("createdAt".to_string(), json!(created_at));
            next_card.insert("updatedAt".to_string(), json!(updated_at));
            cards.push(Value::Object(next_card));
        }
    }

    let cards_slice = cards.as_slice();
    for column_id in &column_ids {
        let ordered_ids: Vec<Value> = sort_column_card_ids(cards_slice, column_id)
            .into_iter()
            .map(|id| json!(id))
            .collect();
        board["cardOrder"][column_id] = json!(ordered_ids);
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

pub fn todo_counts(index: &Value) -> Value {
    let mut total = 0;
    let mut open = 0;
    let mut done = 0;
    for card in index["cards"].as_array().into_iter().flatten() {
        if is_card_deleted(card) || card["archived"].as_bool().unwrap_or(false) {
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
        .position(|card| card["id"].as_str() == Some(card_id) && !is_card_deleted(card))
        .ok_or_else(|| "Todo card not found".to_string())
}

fn card_position_by_id<'a>(index: &'a Value, card_id: &str) -> Option<&'a str> {
    index["cards"]
        .as_array()?
        .iter()
        .find(|card| card["id"].as_str() == Some(card_id) && !is_card_deleted(card))
        .and_then(|card| card["position"].as_str())
}

pub(super) fn sort_column_card_ids(cards: &[Value], column_id: &str) -> Vec<String> {
    let mut matching: Vec<&Value> = cards
        .iter()
        .filter(|card| !is_card_deleted(card) && card["columnId"].as_str() == Some(column_id))
        .collect();
    matching.sort_by(|a, b| {
        let pos_a = a["position"].as_str().unwrap_or("");
        let pos_b = b["position"].as_str().unwrap_or("");
        pos_a
            .cmp(pos_b)
            .then_with(|| {
                let ca = a["createdAt"].as_str().unwrap_or("");
                let cb = b["createdAt"].as_str().unwrap_or("");
                ca.cmp(cb)
            })
            .then_with(|| {
                let ia = a["id"].as_str().unwrap_or("");
                let ib = b["id"].as_str().unwrap_or("");
                ia.cmp(ib)
            })
    });
    matching
        .into_iter()
        .filter_map(|card| card["id"].as_str().map(str::to_string))
        .collect()
}

pub(super) fn column_position_for_prepend(index: &Value, column_id: &str) -> String {
    let cards = index["cards"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let sorted = sort_column_card_ids(cards, column_id);
    let upper = sorted.first().and_then(|id| card_position_by_id(index, id));
    rank_between(None, upper)
}

pub(super) fn column_position_for_insert(
    index: &Value,
    column_id: &str,
    before_id: Option<&str>,
) -> String {
    let cards = index["cards"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let sorted = sort_column_card_ids(cards, column_id);
    if let Some(target_id) = before_id {
        if let Some(pos) = sorted.iter().position(|id| id == target_id) {
            let prev = pos
                .checked_sub(1)
                .and_then(|idx| sorted.get(idx))
                .and_then(|id| card_position_by_id(index, id));
            let next = card_position_by_id(index, target_id);
            return rank_between(prev, next);
        }
    }
    let lower = sorted.last().and_then(|id| card_position_by_id(index, id));
    rank_between(lower, None)
}

pub fn merge_imported_todo_index(
    mut current: Value,
    legacy: &Value,
    actor_id: &str,
) -> (Value, Vec<Value>) {
    let normalized_legacy = normalize_todo_index(legacy.clone());
    let mut existing_ids: HashSet<String> = current["cards"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|card| card["id"].as_str().map(str::to_string))
        .collect();
    let board_id = todo_board_id(&current);
    let mut imported_cards = Vec::new();

    if let (Some(target_cards), Some(legacy_cards)) = (
        current["cards"].as_array_mut(),
        normalized_legacy["cards"].as_array(),
    ) {
        for raw_card in legacy_cards {
            if is_card_deleted(raw_card) {
                continue;
            }
            let Some(card_id) = raw_card["id"].as_str() else {
                continue;
            };
            if existing_ids.contains(card_id) {
                continue;
            }
            let mut next_card = raw_card.clone();
            next_card["boardId"] = json!(board_id);
            next_card["updatedBy"] = json!(actor_id);
            existing_ids.insert(card_id.to_string());
            imported_cards.push(next_card.clone());
            target_cards.push(next_card);
        }
    }

    (normalize_todo_index(current), imported_cards)
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

pub fn create_uuid_v4() -> String {
    let mut bytes = [0u8; 16];
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Security::Cryptography::{
            BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        };
        let status = unsafe { BCryptGenRandom(None, &mut bytes, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
        if status.is_err() {
            fill_fallback_random_bytes(&mut bytes);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        fill_fallback_random_bytes(&mut bytes);
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}

fn fill_fallback_random_bytes(bytes: &mut [u8; 16]) {
    let seq = TODO_ID_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pid = u64::from(std::process::id());
    let hi = (nanos as u64) ^ seq.wrapping_mul(0x9e37_79b9_7f4a_7c15);
    let lo = ((nanos >> 64) as u64) ^ pid.rotate_left(17) ^ seq;
    bytes[..8].copy_from_slice(&hi.to_le_bytes());
    bytes[8..].copy_from_slice(&lo.to_le_bytes());
}

pub(super) fn filter_valid_attachments(raw: Option<&Value>) -> Vec<Value> {
    raw.and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| {
                    item.get("id").and_then(Value::as_str).is_some()
                        && (item.get("fileName").and_then(Value::as_str).is_some()
                            || item.get("relativePath").and_then(Value::as_str).is_some())
                })
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn card_has_attachment_id(
    card_attachments: &[Value],
    subtasks: &[Value],
    target_id: &str,
) -> bool {
    if card_attachments
        .iter()
        .any(|item| item.get("id").and_then(Value::as_str) == Some(target_id))
    {
        return true;
    }
    subtasks.iter().any(|subtask| {
        if is_subtask_deleted(subtask) {
            return false;
        }
        subtask
            .get("attachments")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .any(|item| item.get("id").and_then(Value::as_str) == Some(target_id))
            })
            .unwrap_or(false)
    })
}

pub(super) fn find_fallback_cover_id(card: &Value) -> Value {
    if let Some(id) = card["attachments"]
        .as_array()
        .and_then(|items| items.first())
        .and_then(|item| item["id"].as_str())
    {
        return json!(id);
    }
    if let Some(subtasks) = card["subtasks"].as_array() {
        for subtask in subtasks {
            if is_subtask_deleted(subtask) {
                continue;
            }
            if let Some(id) = subtask["attachments"]
                .as_array()
                .and_then(|items| items.first())
                .and_then(|item| item["id"].as_str())
            {
                return json!(id);
            }
        }
    }
    Value::Null
}

struct NormalizedSubtaskSeed<'a> {
    idx: usize,
    raw_id: Option<&'a str>,
    raw_title: &'a str,
    completed: bool,
    raw_position: Option<&'a str>,
    raw_created_at: Option<&'a str>,
    raw_updated_at: Option<&'a str>,
    attachments: Vec<Value>,
    fallback_now: &'a str,
}

fn build_normalized_subtask(seed: NormalizedSubtaskSeed<'_>) -> Option<Value> {
    let title = safe_todo_title(seed.raw_title, "");
    if title.is_empty() {
        return None;
    }
    let id = seed
        .raw_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| create_todo_id("sub"));
    let position = seed
        .raw_position
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| initial_rank(seed.idx));
    let created_at = seed
        .raw_created_at
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(seed.fallback_now)
        .to_string();
    let updated_at = seed
        .raw_updated_at
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(seed.fallback_now)
        .to_string();

    Some(json!({
        "id": id,
        "title": title,
        "completed": seed.completed,
        "position": position,
        "attachments": seed.attachments,
        "createdAt": created_at,
        "updatedAt": updated_at,
    }))
}

pub(super) fn merge_subtask_inputs_preserving_attachments(
    inputs: &[TodoSubtaskInput],
    existing_subtasks: Option<&Value>,
    now: &str,
    preserve_tombstones: bool,
) -> (Vec<Value>, Vec<Value>) {
    let existing_list = existing_subtasks
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut next_subtasks = Vec::with_capacity(inputs.len());
    let mut retained_ids = HashSet::new();

    for (idx, item) in inputs.iter().enumerate() {
        let matched_attachments = item
            .id
            .as_deref()
            .and_then(|sid| {
                existing_list
                    .iter()
                    .find(|existing| existing["id"].as_str() == Some(sid))
            })
            .map(|existing| filter_valid_attachments(existing.get("attachments")))
            .unwrap_or_default();

        if let Some(mut normalized) = build_normalized_subtask(NormalizedSubtaskSeed {
            idx,
            raw_id: item.id.as_deref(),
            raw_title: &item.title,
            completed: item.completed.unwrap_or(false),
            raw_position: item.position.as_deref(),
            raw_created_at: item.created_at.as_deref(),
            raw_updated_at: item.updated_at.as_deref(),
            attachments: matched_attachments,
            fallback_now: now,
        }) {
            normalized["deletedAt"] = Value::Null;
            if let Some(id) = normalized["id"].as_str() {
                retained_ids.insert(id.to_string());
            }
            next_subtasks.push(normalized);
        }
    }

    let mut removed_attachments = Vec::new();
    for existing in &existing_list {
        let Some(sid) = existing["id"].as_str() else {
            continue;
        };
        if !retained_ids.contains(sid) {
            removed_attachments.extend(filter_valid_attachments(existing.get("attachments")));
            if preserve_tombstones {
                let mut tombstone = existing.clone();
                if let Some(obj) = tombstone.as_object_mut() {
                    if obj
                        .get("deletedAt")
                        .and_then(Value::as_str)
                        .filter(|v| !v.trim().is_empty())
                        .is_none()
                    {
                        obj.insert("deletedAt".to_string(), json!(now));
                        obj.insert("updatedAt".to_string(), json!(now));
                    }
                    obj.insert("attachments".to_string(), json!([]));
                    next_subtasks.push(Value::Object(obj.clone()));
                }
            }
        }
    }

    (next_subtasks, removed_attachments)
}

pub(super) fn normalize_subtasks_from_inputs(inputs: &[TodoSubtaskInput], now: &str) -> Vec<Value> {
    merge_subtask_inputs_preserving_attachments(inputs, None, now, false).0
}

pub(super) fn normalize_stored_subtasks(raw: Option<&Value>, fallback_now: &str) -> Vec<Value> {
    let Some(items) = raw.and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .enumerate()
        .filter_map(|(idx, item)| {
            let obj = item.as_object()?;
            let attachments = filter_valid_attachments(obj.get("attachments"));
            let mut normalized = build_normalized_subtask(NormalizedSubtaskSeed {
                idx,
                raw_id: obj.get("id").and_then(Value::as_str),
                raw_title: obj.get("title").and_then(Value::as_str).unwrap_or(""),
                completed: obj
                    .get("completed")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                raw_position: obj.get("position").and_then(Value::as_str),
                raw_created_at: obj.get("createdAt").and_then(Value::as_str),
                raw_updated_at: obj.get("updatedAt").and_then(Value::as_str),
                attachments,
                fallback_now,
            })?;
            if let (Some(target), Some(_)) = (normalized.as_object_mut(), Some(obj)) {
                for (k, v) in obj {
                    target.entry(k.clone()).or_insert_with(|| v.clone());
                }
            }
            Some(normalized)
        })
        .collect()
}

pub(super) fn summarize_card_text(content: &str) -> String {
    for raw_line in content.lines() {
        let stripped = raw_line
            .trim()
            .trim_start_matches('#')
            .trim()
            .trim_start_matches("- [ ]")
            .trim_start_matches("- [x]")
            .trim_start_matches("- [X]")
            .trim();
        if !stripped.is_empty() {
            return stripped.chars().take(140).collect();
        }
    }
    String::new()
}

pub(super) fn create_todo_id(_prefix: &str) -> String {
    create_uuid_v4()
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

    #[test]
    fn create_uuid_v4_formats_rfc4122_and_is_unique() {
        let a = create_uuid_v4();
        let b = create_uuid_v4();
        assert_ne!(a, b);
        assert_eq!(a.len(), 36);
        assert_eq!(&a[14..15], "4");
    }

    #[test]
    fn deleted_cards_are_excluded_from_counts_and_orders() {
        let raw = json!({
            "version": 2,
            "activeBoardId": "default-board",
            "boards": [{
                "id": "default-board",
                "title": "待办",
                "columns": [
                    { "id": "todo", "title": "待处理" },
                    { "id": "doing", "title": "进行中" },
                    { "id": "done", "title": "已完成" }
                ],
                "cardOrder": { "todo": ["c1", "c2"], "doing": [], "done": [] },
                "createdAt": "100",
                "updatedAt": "100"
            }],
            "cards": [
                { "id": "c1", "columnId": "todo", "title": "保留", "deletedAt": null },
                { "id": "c2", "columnId": "todo", "title": "已删", "deletedAt": "200" }
            ]
        });

        let normalized = normalize_todo_index(raw);
        let counts = todo_counts(&normalized);
        assert_eq!(counts["total"], json!(1));
        assert_eq!(counts["open"], json!(1));
        assert_eq!(normalized["boards"][0]["cardOrder"]["todo"], json!(["c1"]));
        assert_eq!(normalized["cards"].as_array().map(Vec::len), Some(2));
    }

    #[test]
    fn merge_imported_todo_index_skips_duplicates_and_deleted() {
        let current = create_default_todo_index();
        let legacy = json!({
            "version": 1,
            "activeBoardId": "default-board",
            "boards": create_default_todo_index()["boards"],
            "cards": [
                { "id": "legacy-1", "columnId": "todo", "title": "单机旧任务" },
                { "id": "legacy-2", "columnId": "todo", "title": "已删旧任务", "deletedAt": "99" }
            ]
        });

        let (merged, imported) = merge_imported_todo_index(current, &legacy, "u1");
        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0]["id"], json!("legacy-1"));
        assert_eq!(merged["cards"][0]["id"], json!("legacy-1"));
        assert_eq!(merged["cards"][0]["updatedBy"], json!("u1"));
    }

    #[test]
    fn position_drives_card_order_consistently() {
        let raw = json!({
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
                "cardOrder": { "todo": ["c1", "c2"], "doing": [], "done": [] },
                "createdAt": "100",
                "updatedAt": "100"
            }],
            "cards": [
                { "id": "c1", "columnId": "todo", "title": "后排", "position": "0010", "createdAt": "100" },
                { "id": "c2", "columnId": "todo", "title": "前排", "position": "0008", "createdAt": "200" }
            ]
        });

        let normalized = normalize_todo_index(raw);
        assert_eq!(
            normalized["boards"][0]["cardOrder"]["todo"],
            json!(["c2", "c1"])
        );
        let head_rank = column_position_for_prepend(&normalized, "todo");
        assert!(head_rank.as_str() < "0008");
    }

    #[test]
    fn normalize_subtasks_filters_blank_and_preserves_state() {
        let normalized = normalize_subtasks_from_inputs(
            &[
                TodoSubtaskInput {
                    id: None,
                    title: "  准备测试环境  ".to_string(),
                    completed: Some(true),
                    position: None,
                    created_at: None,
                    updated_at: None,
                },
                TodoSubtaskInput {
                    id: Some("sub-fixed".to_string()),
                    title: "   ".to_string(),
                    completed: Some(false),
                    position: None,
                    created_at: None,
                    updated_at: None,
                },
            ],
            "1000",
        );

        assert_eq!(normalized.len(), 1);
        assert_eq!(normalized[0]["title"], json!("准备测试环境"));
        assert_eq!(normalized[0]["completed"], json!(true));
        assert!(!normalized[0]["id"].as_str().unwrap_or("").is_empty());
        assert_eq!(normalized[0]["createdAt"], json!("1000"));
        assert_eq!(normalized[0]["attachments"], json!([]));
    }

    #[test]
    fn merge_subtasks_preserves_existing_attachments_and_tracks_removed() {
        let existing = json!([
            {
                "id": "sub-1",
                "title": "保留的子任务",
                "completed": false,
                "attachments": [{ "id": "att-1", "fileName": "att-1.png" }]
            },
            {
                "id": "sub-2",
                "title": "被删的子任务",
                "completed": true,
                "attachments": [{ "id": "att-2", "fileName": "att-2.png" }]
            }
        ]);

        let (next, removed) = merge_subtask_inputs_preserving_attachments(
            &[TodoSubtaskInput {
                id: Some("sub-1".to_string()),
                title: "重命名后子任务".to_string(),
                completed: Some(true),
                position: None,
                created_at: None,
                updated_at: None,
            }],
            Some(&existing),
            "2000",
            false,
        );

        assert_eq!(next.len(), 1);
        assert_eq!(next[0]["title"], json!("重命名后子任务"));
        assert_eq!(next[0]["attachments"][0]["id"], json!("att-1"));
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0]["id"], json!("att-2"));

        let (with_tombstone, _) = merge_subtask_inputs_preserving_attachments(
            &[TodoSubtaskInput {
                id: Some("sub-1".to_string()),
                title: "重命名后子任务".to_string(),
                completed: Some(true),
                position: None,
                created_at: None,
                updated_at: None,
            }],
            Some(&existing),
            "3000",
            true,
        );
        assert_eq!(with_tombstone.len(), 2);
        assert_eq!(with_tombstone[1]["id"], json!("sub-2"));
        assert_eq!(with_tombstone[1]["deletedAt"], json!("3000"));
        assert_eq!(with_tombstone[1]["attachments"], json!([]));
    }
}
