use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Mutex;

#[derive(Debug, Default)]
pub struct UserInteractionState(Mutex<HashSet<String>>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendEventPayload {
    channel: String,
}

#[tauri::command]
pub fn events_send(
    state: tauri::State<'_, UserInteractionState>,
    payload: SendEventPayload,
) -> Result<Value, String> {
    match payload.channel.as_str() {
        "user-first-interaction" | "drawer-opened" | "file-dropped" => {}
        _ => return Err(format!("Unsupported send channel: {}", payload.channel)),
    }

    let mut seen = state
        .0
        .lock()
        .map_err(|_| "failed to lock user interaction state".to_string())?;
    let first_time = seen.insert(payload.channel.clone());
    Ok(json!({
        "success": true,
        "channel": payload.channel,
        "firstTime": first_time,
    }))
}
