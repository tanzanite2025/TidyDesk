use serde_json::{json, Value};
use std::collections::HashMap;

fn to_epoch_ms(value: &Value) -> u128 {
    if let Some(n) = value.as_u64() {
        return u128::from(n);
    }
    if let Some(s) = value.as_str() {
        if let Ok(parsed) = s.trim().parse::<u128>() {
            return parsed;
        }
    }
    0
}

/// Merge subtask or attachment arrays at member-ID granularity so concurrent changes
/// across desktop and mobile preserve both updates and deletions cleanly.
pub fn merge_members_by_id(existing_list: &[Value], incoming_list: &[Value]) -> Vec<Value> {
    let mut by_id: HashMap<String, Value> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for item in existing_list {
        let Some(id) = item["id"].as_str().filter(|v| !v.is_empty()) else {
            continue;
        };
        by_id.insert(id.to_string(), item.clone());
        order.push(id.to_string());
    }

    for incoming in incoming_list {
        let Some(id) = incoming["id"].as_str().filter(|v| !v.is_empty()) else {
            continue;
        };
        let Some(existing) = by_id.get(id).cloned() else {
            by_id.insert(id.to_string(), incoming.clone());
            order.push(id.to_string());
            continue;
        };

        let existing_ts =
            to_epoch_ms(&existing["updatedAt"]).max(to_epoch_ms(&existing["deletedAt"]));
        let incoming_ts =
            to_epoch_ms(&incoming["updatedAt"]).max(to_epoch_ms(&incoming["deletedAt"]));

        let merged_sub_atts =
            if existing.get("attachments").is_some() || incoming.get("attachments").is_some() {
                let ex_atts = existing["attachments"]
                    .as_array()
                    .map(Vec::as_slice)
                    .unwrap_or(&[]);
                let in_atts = incoming["attachments"]
                    .as_array()
                    .map(Vec::as_slice)
                    .unwrap_or(&[]);
                Some(Value::Array(merge_members_by_id(ex_atts, in_atts)))
            } else {
                None
            };

        if incoming_ts >= existing_ts {
            let mut next = incoming.clone();
            if let Some(atts) = merged_sub_atts {
                next["attachments"] = atts;
            }
            if !existing["deletedAt"].is_null()
                && next["deletedAt"].is_null()
                && to_epoch_ms(&existing["deletedAt"]) >= incoming_ts
            {
                next["deletedAt"] = existing["deletedAt"].clone();
            }
            by_id.insert(id.to_string(), next);
        } else if let Some(atts) = merged_sub_atts {
            let mut next = existing;
            next["attachments"] = atts;
            by_id.insert(id.to_string(), next);
        }
    }

    order
        .into_iter()
        .filter_map(|id| by_id.remove(&id))
        .collect()
}

/// Merge a remote card payload into local state without discarding un-synced concurrent edits.
pub fn merge_remote_card_into_local(
    local_card: Option<&Value>,
    local_content: &str,
    remote_card: &Value,
    local_has_unsynced_edit: bool,
) -> (Value, String) {
    let remote_content = remote_card["content"].as_str().unwrap_or("").to_string();
    let Some(local) = local_card else {
        let mut clean = remote_card.clone();
        if let Some(obj) = clean.as_object_mut() {
            obj.remove("content");
            obj.remove("baseRevision");
        }
        return (clean, remote_content);
    };

    if !local_has_unsynced_edit {
        let mut clean = remote_card.clone();
        let merged_subtasks = merge_members_by_id(
            local["subtasks"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or(&[]),
            remote_card["subtasks"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or(&[]),
        );
        let merged_atts = merge_members_by_id(
            local["attachments"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or(&[]),
            remote_card["attachments"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or(&[]),
        );
        clean["subtasks"] = Value::Array(merged_subtasks);
        clean["attachments"] = Value::Array(merged_atts);
        if let Some(obj) = clean.as_object_mut() {
            obj.remove("content");
            obj.remove("baseRevision");
        }
        return (clean, remote_content);
    }

    let merged_subtasks = merge_members_by_id(
        local["subtasks"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[]),
        remote_card["subtasks"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[]),
    );
    let merged_atts = merge_members_by_id(
        local["attachments"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[]),
        remote_card["attachments"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[]),
    );

    let local_ts = to_epoch_ms(&local["updatedAt"]);
    let remote_ts = to_epoch_ms(&remote_card["updatedAt"]);
    let base = if remote_ts > local_ts {
        remote_card.clone()
    } else {
        local.clone()
    };

    let mut next = base;
    next["subtasks"] = Value::Array(merged_subtasks);
    next["attachments"] = Value::Array(merged_atts);
    next["revision"] = json!(local["revision"]
        .as_u64()
        .unwrap_or(1)
        .max(remote_card["revision"].as_u64().unwrap_or(1)));
    if let Some(obj) = next.as_object_mut() {
        obj.remove("content");
        obj.remove("baseRevision");
    }

    let next_content = if local_content.trim() == remote_content.trim() {
        remote_content
    } else if remote_content.trim().is_empty() {
        local_content.to_string()
    } else if local_content.trim().is_empty() {
        remote_content
    } else if remote_ts > local_ts {
        format!("{remote_content}\n\n---\n> [本机离线修改保留副本]\n{local_content}")
    } else {
        format!("{local_content}\n\n---\n> [远端并发修改保留副本]\n{remote_content}")
    };

    (next, next_content)
}

/// Remove synced deletion tombstones older than `cutoff_epoch_ms` to keep index compact.
pub fn prune_synced_tombstones(index: &mut Value, cutoff_epoch_ms: u128) -> usize {
    let mut removed = 0usize;
    let Some(cards) = index["cards"].as_array_mut() else {
        return 0;
    };
    cards.retain(|card| {
        if !card["deletedAt"].is_null() {
            let deleted_ts = to_epoch_ms(&card["deletedAt"]);
            if deleted_ts > 0 && deleted_ts < cutoff_epoch_ms {
                removed += 1;
                return false;
            }
        }
        true
    });

    for card in cards.iter_mut() {
        if let Some(subtasks) = card["subtasks"].as_array_mut() {
            let before = subtasks.len();
            subtasks.retain(|sub| {
                if !sub["deletedAt"].is_null() {
                    let deleted_ts = to_epoch_ms(&sub["deletedAt"]);
                    return deleted_ts == 0 || deleted_ts >= cutoff_epoch_ms;
                }
                true
            });
            removed += before.saturating_sub(subtasks.len());
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_members_preserves_independent_subtask_and_attachment_edits() {
        let local = vec![
            json!({
                "id": "s1",
                "title": "步骤一",
                "completed": true,
                "updatedAt": "2000",
                "attachments": []
            }),
            json!({
                "id": "s2",
                "title": "步骤二",
                "completed": false,
                "updatedAt": "1000",
                "attachments": []
            }),
        ];
        let remote = vec![
            json!({
                "id": "s1",
                "title": "步骤一",
                "completed": false,
                "updatedAt": "1000",
                "attachments": []
            }),
            json!({
                "id": "s2",
                "title": "步骤二",
                "completed": false,
                "updatedAt": "2500",
                "attachments": [{ "id": "a-mobile", "fileName": "a-mobile.png", "updatedAt": "2500" }]
            }),
        ];

        let merged = merge_members_by_id(&local, &remote);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0]["completed"], json!(true));
        assert_eq!(merged[1]["attachments"][0]["id"], json!("a-mobile"));
    }

    #[test]
    fn prune_synced_tombstones_cleans_only_expired_items() {
        let mut index = json!({
            "cards": [
                {
                    "id": "c-live",
                    "deletedAt": null,
                    "subtasks": [
                        { "id": "s-old", "deletedAt": "100" },
                        { "id": "s-fresh", "deletedAt": "5000" }
                    ]
                },
                { "id": "c-expired", "deletedAt": "200" }
            ]
        });

        let pruned = prune_synced_tombstones(&mut index, 1000);
        assert_eq!(pruned, 2);
        assert_eq!(index["cards"].as_array().map(Vec::len), Some(1));
        assert_eq!(
            index["cards"][0]["subtasks"].as_array().map(Vec::len),
            Some(1)
        );
        assert_eq!(index["cards"][0]["subtasks"][0]["id"], json!("s-fresh"));
    }
}
