use super::model::{create_default_todo_index, normalize_todo_index};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Debug, Default)]
pub struct TodoStoreState {
    pub lock: Mutex<()>,
    pub content_cache: Mutex<HashMap<String, String>>,
}

pub(super) fn with_todo_store_lock<T>(
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

fn ensure_todo_storage_unlocked(app: &AppHandle) -> Result<(), String> {
    fs::create_dir_all(todo_cards_root(app)?)
        .map_err(|err| format!("failed to create todo storage: {err}"))?;
    let index_path = todo_index_path(app)?;
    if !index_path.exists() {
        write_todo_index_unlocked(app, &create_default_todo_index())?;
    }
    Ok(())
}

pub(super) fn read_todo_index_unlocked(app: &AppHandle) -> Result<Value, String> {
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

pub(super) fn write_todo_index_unlocked(app: &AppHandle, index: &Value) -> Result<(), String> {
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

pub(super) fn read_todo_card_content_unlocked(
    app: &AppHandle,
    card_id: &str,
) -> Result<String, String> {
    match fs::read_to_string(todo_card_path(app, card_id)?) {
        Ok(content) => Ok(content),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(format!("failed to read todo card content: {err}")),
    }
}

pub(super) fn write_todo_card_content_unlocked(
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

pub(super) fn todo_state_from_index_unlocked(
    app: &AppHandle,
    index: &Value,
    counts: Value,
) -> Result<Value, String> {
    let cards = index["cards"]
        .as_array()
        .map(|cards| {
            cards
                .iter()
                .map(|card| {
                    let mut next = card.clone();
                    let card_id = next["id"].as_str().unwrap_or_default().to_string();
                    next["content"] = json!(read_todo_card_content_unlocked(app, &card_id)?);
                    Ok(next)
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

pub(super) fn cache_todo_state_contents(store: &TodoStoreState, state: &Value) {
    let Ok(mut cache) = store.content_cache.lock() else {
        return;
    };
    cache.clear();
    if let Some(cards) = state["cards"].as_array() {
        for card in cards {
            if let (Some(id), Some(content)) = (card["id"].as_str(), card["content"].as_str()) {
                cache.insert(id.to_string(), content.to_string());
            }
        }
    }
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
                .map(|card| {
                    let mut next = card.clone();
                    let card_id = next["id"].as_str().unwrap_or_default().to_string();
                    let content = if let Some(cached) = cache.get(&card_id) {
                        cached.clone()
                    } else {
                        let loaded = read_todo_card_content_unlocked(app, &card_id)?;
                        cache.insert(card_id, loaded.clone());
                        loaded
                    };
                    next["content"] = json!(content);
                    Ok(next)
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
