use super::model::{create_todo_id, find_todo_card_index};
use super::store::{read_todo_index_unlocked, todo_state_from_cache_or_disk, with_todo_store_lock};
use crate::accounts::session::load_session;
use crate::local_db::open_workspace_db;
use crate::sync::{enqueue_outbox_batch, OutboxBatchItem, OutboxEntityKind, OutboxOperation};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TodoCardComment {
    pub id: String,
    pub card_id: String,
    pub parent_id: Option<String>,
    pub author_id: String,
    pub author_name: String,
    pub body: String,
    pub mentions: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTodoCardCommentPayload {
    pub card_id: String,
    pub body: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTodoCardCommentPayload {
    pub card_id: String,
    pub comment_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TodoUnreadCommentItem {
    pub card_id: String,
    pub card_title: String,
    pub unread_count: usize,
    pub mention_count: usize,
    pub latest_comment_id: String,
    pub latest_author_id: String,
    pub latest_author_name: String,
    pub latest_body_preview: String,
    pub latest_created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TodoUnreadCommentSummary {
    pub unread_total: usize,
    pub mention_total: usize,
    pub items: Vec<TodoUnreadCommentItem>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct CardCommentBadgeMetrics {
    pub total_count: usize,
    pub unread_count: usize,
    pub unread_mention_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncedCommentAlert {
    pub comment_id: String,
    pub card_id: String,
    pub card_title: String,
    pub author_id: String,
    pub author_name: String,
    pub body_preview: String,
    pub is_mention_for_me: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct ApplySyncedCommentsResult {
    pub affected_card_ids: Vec<String>,
    pub new_alerts: Vec<SyncedCommentAlert>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopCommentNotification {
    pub title: String,
    pub body: String,
    pub card_id: String,
    pub mention_count: usize,
    pub comment_count: usize,
}

/// Extract deduplicated `@mention` identifiers matching `/@([a-zA-Z0-9_-]{1,64})/g`.
pub fn extract_comment_mentions(body: &str) -> Vec<String> {
    let bytes = body.as_bytes();
    let mut seen = HashSet::new();
    let mut mentions = Vec::new();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'@' {
            let start = i + 1;
            let mut end = start;
            while end < bytes.len() && (end - start) < 64 {
                let b = bytes[end];
                if b.is_ascii_alphanumeric() || b == b'_' || b == b'-' {
                    end += 1;
                } else {
                    break;
                }
            }
            if end > start {
                let token = &body[start..end];
                if seen.insert(token.to_string()) {
                    mentions.push(token.to_string());
                }
            }
            i = end;
        } else {
            i += 1;
        }
    }

    mentions
}

fn truncate_comment_preview(raw: &str, max_chars: usize) -> String {
    let normalized = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = normalized.chars();
    let head: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
}

fn resolve_comment_actor(app: &AppHandle) -> (String, String) {
    let Ok(session) = load_session(app) else {
        return ("local".to_string(), "本地用户".to_string());
    };
    let actor_id = session
        .active_user_id
        .clone()
        .or(session.detached_user_id.clone())
        .unwrap_or_else(|| "local".to_string());
    let actor_name = session
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            if actor_id == "local" {
                "本地用户".to_string()
            } else {
                actor_id.clone()
            }
        });
    (actor_id, actor_name)
}

fn parse_mentions_json(raw: &str) -> Result<Vec<String>, String> {
    serde_json::from_str::<Vec<String>>(raw)
        .map_err(|err| format!("[CRITICAL] 评论 mentions_json 损坏: {err}"))
}

fn parse_card_title_from_metadata(metadata_json: Option<&str>) -> String {
    metadata_json
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|val| {
            val["title"]
                .as_str()
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| "未命名待办".to_string())
}

fn row_to_comment(row: &rusqlite::Row<'_>) -> Result<TodoCardComment, rusqlite::Error> {
    let mentions_raw: String = row.get(6)?;
    let mentions = serde_json::from_str::<Vec<String>>(&mentions_raw).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(err))
    })?;
    Ok(TodoCardComment {
        id: row.get(0)?,
        card_id: row.get(1)?,
        parent_id: row.get(2)?,
        author_id: row.get(3)?,
        author_name: row.get(4)?,
        body: row.get(5)?,
        mentions,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        deleted_at: row.get(9)?,
    })
}

pub(crate) fn list_active_comments_in_conn(
    conn: &Connection,
    card_id: &str,
) -> Result<Vec<TodoCardComment>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, card_id, parent_id, author_id, author_name, body, mentions_json, created_at, updated_at, deleted_at
             FROM card_comments
             WHERE card_id = ?1 AND deleted_at IS NULL
             ORDER BY CAST(created_at AS INTEGER) ASC, created_at ASC, id ASC",
        )
        .map_err(|err| format!("准备评论查询失败: {err}"))?;
    let rows = stmt
        .query_map(params![card_id], row_to_comment)
        .map_err(|err| format!("查询卡片评论失败: {err}"))?;
    let mut comments = Vec::new();
    for row in rows {
        comments.push(row.map_err(|err| format!("解析卡片评论行失败: {err}"))?);
    }
    Ok(comments)
}

pub(crate) fn read_all_active_comments_from_conn(
    conn: &Connection,
) -> Result<Vec<TodoCardComment>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, card_id, parent_id, author_id, author_name, body, mentions_json, created_at, updated_at, deleted_at
             FROM card_comments
             WHERE deleted_at IS NULL
             ORDER BY CAST(created_at AS INTEGER) ASC, created_at ASC, id ASC",
        )
        .map_err(|err| format!("准备全量评论查询失败: {err}"))?;
    let rows = stmt
        .query_map([], row_to_comment)
        .map_err(|err| format!("读取本地全量评论失败: {err}"))?;
    let mut comments = Vec::new();
    for row in rows {
        comments.push(row.map_err(|err| format!("解析本地全量评论行失败: {err}"))?);
    }
    Ok(comments)
}

pub(crate) fn import_comments_into_conn(
    conn: &mut Connection,
    comments: &[TodoCardComment],
    allowed_card_ids: &HashSet<String>,
    user_id: &str,
    display_name: &str,
) -> Result<Vec<TodoCardComment>, String> {
    if comments.is_empty() || allowed_card_ids.is_empty() {
        return Ok(Vec::new());
    }
    let tx = conn
        .transaction()
        .map_err(|err| format!("开启导入评论事务失败: {err}"))?;
    let mut imported = Vec::new();
    for cmt in comments {
        if cmt.deleted_at.is_some() || !allowed_card_ids.contains(&cmt.card_id) {
            continue;
        }
        let next_author_id = if cmt.author_id == "local" {
            user_id.to_string()
        } else {
            cmt.author_id.clone()
        };
        let next_author_name = if cmt.author_id == "local" {
            if display_name.trim().is_empty() {
                user_id.to_string()
            } else {
                display_name.trim().to_string()
            }
        } else {
            cmt.author_name.clone()
        };
        let mentions_json = serde_json::to_string(&cmt.mentions)
            .map_err(|err| format!("序列化导入评论 mentions 失败: {err}"))?;
        let inserted = tx
            .execute(
                "INSERT OR IGNORE INTO card_comments
                   (id, card_id, parent_id, author_id, author_name, body, mentions_json, created_at, updated_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL)",
                params![
                    cmt.id,
                    cmt.card_id,
                    cmt.parent_id,
                    next_author_id,
                    next_author_name,
                    cmt.body,
                    mentions_json,
                    cmt.created_at,
                    cmt.updated_at,
                ],
            )
            .map_err(|err| format!("写入导入评论失败 ({}): {err}", cmt.id))?;
        if inserted > 0 {
            let mut normalized = cmt.clone();
            normalized.author_id = next_author_id;
            normalized.author_name = next_author_name;
            imported.push(normalized);
        }
    }
    tx.commit()
        .map_err(|err| format!("提交导入评论事务失败: {err}"))?;
    Ok(imported)
}

pub(crate) fn insert_comment_in_conn(
    conn: &Connection,
    card_id: &str,
    body: &str,
    parent_id: Option<&str>,
    author_id: &str,
    author_name: &str,
    now: &str,
) -> Result<TodoCardComment, String> {
    let trimmed_body = body.trim();
    if trimmed_body.is_empty() {
        return Err("评论内容不能为空".to_string());
    }
    if trimmed_body.chars().count() > 4000 {
        return Err("评论内容不能超过 4000 个字符".to_string());
    }

    let normalized_parent_id = parent_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);

    if let Some(ref pid) = normalized_parent_id {
        let parent_exists: Option<String> = conn
            .query_row(
                "SELECT id FROM card_comments WHERE id = ?1 AND card_id = ?2 AND deleted_at IS NULL",
                params![pid, card_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|err| format!("校验回复目标评论失败: {err}"))?;
        if parent_exists.is_none() {
            return Err("引用的父评论不存在或已被删除".to_string());
        }
    }

    let id = create_todo_id("cmt");
    let mentions = extract_comment_mentions(trimmed_body);
    let mentions_json =
        serde_json::to_string(&mentions).map_err(|err| format!("序列化 @提及 列表失败: {err}"))?;

    conn.execute(
        "INSERT INTO card_comments
           (id, card_id, parent_id, author_id, author_name, body, mentions_json, created_at, updated_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL)",
        params![
            id,
            card_id,
            normalized_parent_id,
            author_id,
            author_name,
            trimmed_body,
            mentions_json,
            now,
            now
        ],
    )
    .map_err(|err| format!("保存评论失败: {err}"))?;

    Ok(TodoCardComment {
        id,
        card_id: card_id.to_string(),
        parent_id: normalized_parent_id,
        author_id: author_id.to_string(),
        author_name: author_name.to_string(),
        body: trimmed_body.to_string(),
        mentions,
        created_at: now.to_string(),
        updated_at: now.to_string(),
        deleted_at: None,
    })
}

pub(crate) fn soft_delete_comment_in_conn(
    conn: &Connection,
    card_id: &str,
    comment_id: &str,
    actor_id: &str,
    now: &str,
) -> Result<(), String> {
    let existing: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT author_id, deleted_at FROM card_comments WHERE id = ?1 AND card_id = ?2",
            params![comment_id, card_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|err| format!("查询待删除评论失败: {err}"))?;

    let Some((author_id, deleted_at)) = existing else {
        return Err("评论不存在".to_string());
    };
    if deleted_at.is_some() {
        return Err("评论已被删除".to_string());
    }
    if actor_id != "local" && author_id != "local" && author_id != actor_id {
        return Err("无权删除他人发表的评论".to_string());
    }

    conn.execute(
        "UPDATE card_comments SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND card_id = ?3",
        params![now, comment_id, card_id],
    )
    .map_err(|err| format!("删除评论失败: {err}"))?;
    Ok(())
}

pub(crate) fn mark_card_comments_read_in_conn(
    conn: &Connection,
    card_id: &str,
    now: &str,
) -> Result<(), String> {
    let trimmed = card_id.trim();
    if trimmed.is_empty() {
        return Err("Missing todo card id".to_string());
    }
    let latest_ts: Option<i64> = conn
        .query_row(
            "SELECT MAX(CAST(created_at AS INTEGER)) FROM card_comments WHERE card_id = ?1 AND deleted_at IS NULL",
            params![trimmed],
            |row| row.get(0),
        )
        .map_err(|err| format!("查询卡片最新评论时间失败: {err}"))?;
    let now_i64 = now.trim().parse::<i64>().unwrap_or(0);
    let effective_read_at = latest_ts.unwrap_or(0).max(now_i64).to_string();

    conn.execute(
        "INSERT INTO card_comment_reads (card_id, last_read_at, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(card_id) DO UPDATE SET
           last_read_at = CAST(MAX(CAST(card_comment_reads.last_read_at AS INTEGER), CAST(excluded.last_read_at AS INTEGER)) AS TEXT),
           updated_at = excluded.updated_at",
        params![trimmed, effective_read_at, now],
    )
    .map_err(|err| format!("更新卡片评论已读游标失败 ({trimmed}): {err}"))?;
    Ok(())
}

pub(crate) fn mark_all_comments_read_in_conn(
    conn: &mut Connection,
    now: &str,
) -> Result<usize, String> {
    let card_ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT DISTINCT card_id FROM card_comments WHERE deleted_at IS NULL")
            .map_err(|err| format!("查询存在评论的卡片失败: {err}"))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|err| format!("读取卡片列表失败: {err}"))?;
        let mut ids = Vec::new();
        for row in rows {
            ids.push(row.map_err(|err| format!("解析卡片 ID 失败: {err}"))?);
        }
        ids
    };

    if card_ids.is_empty() {
        return Ok(0);
    }

    let tx = conn
        .transaction()
        .map_err(|err| format!("开启批量已读事务失败: {err}"))?;
    for cid in &card_ids {
        mark_card_comments_read_in_conn(&tx, cid, now)?;
    }
    tx.commit()
        .map_err(|err| format!("提交批量已读事务失败: {err}"))?;
    Ok(card_ids.len())
}

pub(crate) fn read_card_comment_metrics_from_conn(
    conn: &Connection,
    actor_id: &str,
) -> Result<HashMap<String, CardCommentBadgeMetrics>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT c.card_id, c.author_id, c.mentions_json, c.created_at, r.last_read_at
             FROM card_comments c
             LEFT JOIN card_comment_reads r ON r.card_id = c.card_id
             WHERE c.deleted_at IS NULL",
        )
        .map_err(|err| format!("统计评论状态失败: {err}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(|err| format!("读取评论统计行失败: {err}"))?;

    let mut map: HashMap<String, CardCommentBadgeMetrics> = HashMap::new();
    for row in rows {
        let (card_id, author_id, mentions_raw, created_at, last_read_at) =
            row.map_err(|err| format!("解析评论统计行失败: {err}"))?;
        let entry = map.entry(card_id).or_default();
        entry.total_count += 1;

        if actor_id == "local" || author_id == "local" || author_id == actor_id {
            continue;
        }
        let created_ts = created_at.trim().parse::<i64>().unwrap_or(0);
        let read_ts = last_read_at
            .as_deref()
            .and_then(|v| v.trim().parse::<i64>().ok())
            .unwrap_or(0);
        if created_ts > read_ts {
            entry.unread_count += 1;
            let mentions = parse_mentions_json(&mentions_raw)?;
            if mentions.iter().any(|m| m == actor_id) {
                entry.unread_mention_count += 1;
            }
        }
    }
    Ok(map)
}

pub(crate) fn read_unread_comment_summary_from_conn(
    conn: &Connection,
    actor_id: &str,
) -> Result<TodoUnreadCommentSummary, String> {
    if actor_id == "local" {
        return Ok(TodoUnreadCommentSummary::default());
    }

    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.card_id, c.author_id, c.author_name, c.body, c.mentions_json, c.created_at,
                    tc.deleted_at AS card_deleted_at, tc.metadata_json
             FROM card_comments c
             LEFT JOIN card_comment_reads r ON r.card_id = c.card_id
             LEFT JOIN todo_cards tc ON tc.id = c.card_id
             WHERE c.deleted_at IS NULL
               AND c.author_id != 'local'
               AND c.author_id != ?1
               AND (tc.id IS NULL OR tc.deleted_at IS NULL)
               AND CAST(c.created_at AS INTEGER) > COALESCE(CAST(r.last_read_at AS INTEGER), 0)
             ORDER BY CAST(c.created_at AS INTEGER) ASC, c.id ASC",
        )
        .map_err(|err| format!("查询未读评论汇总失败: {err}"))?;

    let rows = stmt
        .query_map(params![actor_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, Option<String>>(8)?,
            ))
        })
        .map_err(|err| format!("读取未读评论列表失败: {err}"))?;

    let mut by_card: HashMap<String, TodoUnreadCommentItem> = HashMap::new();
    let mut unread_total = 0usize;
    let mut mention_total = 0usize;

    for row in rows {
        let (
            comment_id,
            card_id,
            author_id,
            author_name,
            body,
            mentions_raw,
            created_at,
            metadata_json,
        ) = row.map_err(|err| format!("解析未读评论行失败: {err}"))?;

        let mentions = parse_mentions_json(&mentions_raw)?;
        let is_mention = mentions.iter().any(|m| m == actor_id);
        unread_total += 1;
        if is_mention {
            mention_total += 1;
        }

        let card_title = parse_card_title_from_metadata(metadata_json.as_deref());
        let preview = truncate_comment_preview(&body, 72);

        by_card
            .entry(card_id.clone())
            .and_modify(|item| {
                item.unread_count += 1;
                if is_mention {
                    item.mention_count += 1;
                }
                item.card_title = card_title.clone();
                item.latest_comment_id = comment_id.clone();
                item.latest_author_id = author_id.clone();
                item.latest_author_name = author_name.clone();
                item.latest_body_preview = preview.clone();
                item.latest_created_at = created_at.clone();
            })
            .or_insert_with(|| TodoUnreadCommentItem {
                card_id,
                card_title,
                unread_count: 1,
                mention_count: usize::from(is_mention),
                latest_comment_id: comment_id,
                latest_author_id: author_id,
                latest_author_name: author_name,
                latest_body_preview: preview,
                latest_created_at: created_at,
            });
    }

    let mut items: Vec<TodoUnreadCommentItem> = by_card.into_values().collect();
    items.sort_by(|a, b| {
        b.mention_count
            .cmp(&a.mention_count)
            .then_with(|| {
                b.latest_created_at
                    .parse::<i64>()
                    .unwrap_or(0)
                    .cmp(&a.latest_created_at.parse::<i64>().unwrap_or(0))
            })
            .then_with(|| a.card_id.cmp(&b.card_id))
    });

    Ok(TodoUnreadCommentSummary {
        unread_total,
        mention_total,
        items,
    })
}

pub(crate) fn read_card_comment_metrics_unlocked(
    app: &AppHandle,
) -> Result<HashMap<String, CardCommentBadgeMetrics>, String> {
    let conn = open_workspace_db(app)?;
    let (actor_id, _) = resolve_comment_actor(app);
    read_card_comment_metrics_from_conn(&conn, &actor_id)
}

pub(crate) fn read_single_card_comment_metrics_unlocked(
    app: &AppHandle,
    card_id: &str,
) -> Result<CardCommentBadgeMetrics, String> {
    let conn = open_workspace_db(app)?;
    let (actor_id, _) = resolve_comment_actor(app);
    let mut metrics = read_card_comment_metrics_from_conn(&conn, &actor_id)?;
    Ok(metrics.remove(card_id).unwrap_or_default())
}

pub(crate) fn read_unread_comment_summary_unlocked(
    app: &AppHandle,
) -> Result<TodoUnreadCommentSummary, String> {
    let conn = open_workspace_db(app)?;
    let (actor_id, _) = resolve_comment_actor(app);
    read_unread_comment_summary_from_conn(&conn, &actor_id)
}

pub(crate) fn emit_unread_comment_summary(
    app: &AppHandle,
) -> Result<TodoUnreadCommentSummary, String> {
    let summary = read_unread_comment_summary_unlocked(app)?;
    app.emit("todo-comment-unread-updated", summary.clone())
        .map_err(|err| err.to_string())?;
    Ok(summary)
}

pub(crate) fn build_desktop_comment_notification(
    alerts: &[SyncedCommentAlert],
) -> Option<DesktopCommentNotification> {
    if alerts.is_empty() {
        return None;
    }

    let mention_alerts: Vec<&SyncedCommentAlert> =
        alerts.iter().filter(|a| a.is_mention_for_me).collect();
    let mention_count = mention_alerts.len();
    let lead = mention_alerts.first().copied().unwrap_or(&alerts[0]);

    let (title, body) = if alerts.len() == 1 {
        let title = if lead.is_mention_for_me {
            format!("{} 在「{}」@了你", lead.author_name, lead.card_title)
        } else {
            format!("{} 评论了「{}」", lead.author_name, lead.card_title)
        };
        (title, lead.body_preview.clone())
    } else {
        let title = if mention_count > 0 {
            format!(
                "收到 {} 条新评论（含 {} 条 @提及）",
                alerts.len(),
                mention_count
            )
        } else {
            format!("收到 {} 条新待办评论", alerts.len())
        };
        let body = format!(
            "{}（{}）: {}",
            lead.card_title, lead.author_name, lead.body_preview
        );
        (title, body)
    };

    Some(DesktopCommentNotification {
        title,
        body,
        card_id: lead.card_id.clone(),
        mention_count,
        comment_count: alerts.len(),
    })
}

pub(crate) fn apply_synced_card_comments_in_conn(
    conn: &mut Connection,
    remote_comments: &[Value],
    removed_ids: &[String],
    unsynced_comment_ids: &HashSet<String>,
    actor_id: &str,
    now: &str,
) -> Result<ApplySyncedCommentsResult, String> {
    let tx = conn
        .transaction()
        .map_err(|err| format!("开启评论同步事务失败: {err}"))?;
    let mut affected_card_ids: Vec<String> = Vec::new();
    let mut seen_cards: HashSet<String> = HashSet::new();
    let mut new_alerts: Vec<SyncedCommentAlert> = Vec::new();
    let mut push_card = |cid: &str| {
        if !cid.is_empty() && seen_cards.insert(cid.to_string()) {
            affected_card_ids.push(cid.to_string());
        }
    };

    for remote in remote_comments {
        let Some(id) = remote["id"]
            .as_str()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        else {
            continue;
        };
        if unsynced_comment_ids.contains(id) {
            continue;
        }
        let Some(card_id) = remote["cardId"]
            .as_str()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        else {
            continue;
        };
        let existed_before: bool = tx
            .query_row(
                "SELECT 1 FROM card_comments WHERE id = ?1",
                params![id],
                |_| Ok(true),
            )
            .optional()
            .map_err(|err| format!("查询已有同步评论状态失败 ({id}): {err}"))?
            .unwrap_or(false);

        let parent_id = remote["parentId"]
            .as_str()
            .or_else(|| remote["replyToId"].as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty());
        let comment_author_id = remote["authorId"]
            .as_str()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or("unknown");
        let author_name = remote["authorName"]
            .as_str()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or(comment_author_id);
        let body = remote["body"].as_str().unwrap_or("");
        let mentions: Vec<String> = remote["mentions"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|v| v.as_str().map(ToString::to_string))
                    .collect()
            })
            .unwrap_or_else(|| extract_comment_mentions(body));
        let mentions_json = serde_json::to_string(&mentions)
            .map_err(|err| format!("序列化远端评论 mentions 失败: {err}"))?;
        let created_at = remote["createdAt"].as_str().unwrap_or(now);
        let updated_at = remote["updatedAt"].as_str().unwrap_or(created_at);
        let deleted_at = remote["deletedAt"]
            .as_str()
            .map(str::trim)
            .filter(|v| !v.is_empty());

        tx.execute(
            "INSERT INTO card_comments
               (id, card_id, parent_id, author_id, author_name, body, mentions_json, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
               parent_id = excluded.parent_id,
               author_id = excluded.author_id,
               author_name = excluded.author_name,
               body = excluded.body,
               mentions_json = excluded.mentions_json,
               updated_at = excluded.updated_at,
               deleted_at = excluded.deleted_at
             WHERE CAST(excluded.updated_at AS INTEGER) >= CAST(card_comments.updated_at AS INTEGER)",
            params![
                id,
                card_id,
                parent_id,
                comment_author_id,
                author_name,
                body,
                mentions_json,
                created_at,
                updated_at,
                deleted_at,
            ],
        )
        .map_err(|err| format!("写入同步评论失败 ({id}): {err}"))?;
        push_card(card_id);

        if !existed_before
            && deleted_at.is_none()
            && actor_id != "local"
            && comment_author_id != "local"
            && comment_author_id != actor_id
        {
            let read_ts: i64 = tx
                .query_row(
                    "SELECT last_read_at FROM card_comment_reads WHERE card_id = ?1",
                    params![card_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|err| format!("读取卡片已读时间失败 ({card_id}): {err}"))?
                .and_then(|v| v.trim().parse::<i64>().ok())
                .unwrap_or(0);
            let created_ts = created_at.trim().parse::<i64>().unwrap_or(0);
            if created_ts > read_ts {
                let card_row: Option<(Option<String>, String)> = tx
                    .query_row(
                        "SELECT deleted_at, metadata_json FROM todo_cards WHERE id = ?1",
                        params![card_id],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .optional()
                    .map_err(|err| format!("查询评论所属卡片标题失败 ({card_id}): {err}"))?;
                let card_deleted = card_row
                    .as_ref()
                    .and_then(|(del, _)| del.as_ref())
                    .is_some();
                if !card_deleted {
                    let card_title = parse_card_title_from_metadata(
                        card_row.as_ref().map(|(_, meta)| meta.as_str()),
                    );
                    let is_mention_for_me = mentions.iter().any(|m| m == actor_id);
                    new_alerts.push(SyncedCommentAlert {
                        comment_id: id.to_string(),
                        card_id: card_id.to_string(),
                        card_title,
                        author_id: comment_author_id.to_string(),
                        author_name: author_name.to_string(),
                        body_preview: truncate_comment_preview(body, 72),
                        is_mention_for_me,
                        created_at: created_at.to_string(),
                    });
                }
            }
        }
    }

    for removed_id in removed_ids {
        let trimmed = removed_id.trim();
        if trimmed.is_empty() || unsynced_comment_ids.contains(trimmed) {
            continue;
        }
        let card_id: Option<String> = tx
            .query_row(
                "SELECT card_id FROM card_comments WHERE id = ?1",
                params![trimmed],
                |row| row.get(0),
            )
            .optional()
            .map_err(|err| format!("查询待移除同步评论失败: {err}"))?;
        if let Some(cid) = card_id {
            tx.execute(
                "UPDATE card_comments
                 SET deleted_at = COALESCE(deleted_at, ?1), updated_at = ?1
                 WHERE id = ?2",
                params![now, trimmed],
            )
            .map_err(|err| format!("标记同步删除评论失败 ({trimmed}): {err}"))?;
            push_card(&cid);
        }
    }

    tx.commit()
        .map_err(|err| format!("提交评论同步事务失败: {err}"))?;
    Ok(ApplySyncedCommentsResult {
        affected_card_ids,
        new_alerts,
    })
}

pub(crate) fn apply_synced_card_comments(
    app: &AppHandle,
    remote_comments: &[Value],
    removed_ids: &[String],
    unsynced_comment_ids: &HashSet<String>,
) -> Result<ApplySyncedCommentsResult, String> {
    if remote_comments.is_empty() && removed_ids.is_empty() {
        return Ok(ApplySyncedCommentsResult::default());
    }
    let mut conn = open_workspace_db(app)?;
    let (actor_id, _) = resolve_comment_actor(app);
    let now = crate::timestamp_string();
    let result = apply_synced_card_comments_in_conn(
        &mut conn,
        remote_comments,
        removed_ids,
        unsynced_comment_ids,
        &actor_id,
        &now,
    )?;
    if !result.affected_card_ids.is_empty() {
        app.emit(
            "todo-comments-updated",
            json!({ "cardIds": result.affected_card_ids }),
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(result)
}

#[tauri::command]
pub async fn todos_list_card_comments(
    app: AppHandle,
    card_id: String,
) -> Result<Vec<TodoCardComment>, String> {
    let trimmed_card_id = card_id.trim().to_string();
    if trimmed_card_id.is_empty() {
        return Err("Missing todo card id".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_workspace_db(&app)?;
        list_active_comments_in_conn(&conn, &trimmed_card_id)
    })
    .await
    .map_err(|err| format!("todo comments list task failed: {err}"))?
}

#[tauri::command]
pub async fn todos_add_card_comment(
    app: AppHandle,
    payload: AddTodoCardCommentPayload,
) -> Result<TodoCardComment, String> {
    let card_id = payload.card_id.trim().to_string();
    if card_id.is_empty() {
        return Err("Missing todo card id".to_string());
    }
    let body = payload.body;
    let parent_id = payload.parent_id;

    tauri::async_runtime::spawn_blocking(move || {
        let (comment, state, counts) = with_todo_store_lock(&app, |store| {
            let index = read_todo_index_unlocked(&app)?;
            let _ = find_todo_card_index(&index, &card_id)?;

            let (actor_id, actor_name) = resolve_comment_actor(&app);
            let now = crate::timestamp_string();
            let conn = open_workspace_db(&app)?;
            let comment = insert_comment_in_conn(
                &conn,
                &card_id,
                &body,
                parent_id.as_deref(),
                &actor_id,
                &actor_name,
                &now,
            )?;
            mark_card_comments_read_in_conn(&conn, &card_id, &now)?;
            let comment_value = serde_json::to_value(&comment)
                .map_err(|err| format!("序列化评论同步载荷失败: {err}"))?;
            enqueue_outbox_batch(
                &app,
                vec![OutboxBatchItem {
                    entity_kind: OutboxEntityKind::CardComment,
                    entity_id: comment.id.clone(),
                    operation: OutboxOperation::Upsert,
                    payload: comment_value,
                }],
            )?;
            let counts = super::model::todo_counts(&index);
            let state = todo_state_from_cache_or_disk(&app, store, &index, counts.clone())?;
            Ok((comment, state, counts))
        })?;

        super::card_commands::emit_todo_counts(&app, &counts)?;
        super::card_commands::emit_todos_updated(&app, &state)?;
        let _ = emit_unread_comment_summary(&app)?;
        app.emit("todo-comments-updated", json!({ "cardIds": [card_id] }))
            .map_err(|err| err.to_string())?;
        Ok(comment)
    })
    .await
    .map_err(|err| format!("todo add comment task failed: {err}"))?
}

#[tauri::command]
pub async fn todos_delete_card_comment(
    app: AppHandle,
    payload: DeleteTodoCardCommentPayload,
) -> Result<Vec<TodoCardComment>, String> {
    let card_id = payload.card_id.trim().to_string();
    let comment_id = payload.comment_id.trim().to_string();
    if card_id.is_empty() {
        return Err("Missing todo card id".to_string());
    }
    if comment_id.is_empty() {
        return Err("Missing todo comment id".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let (remaining, state, counts) = with_todo_store_lock(&app, |store| {
            let index = read_todo_index_unlocked(&app)?;
            let (actor_id, _) = resolve_comment_actor(&app);
            let now = crate::timestamp_string();
            let conn = open_workspace_db(&app)?;
            soft_delete_comment_in_conn(&conn, &card_id, &comment_id, &actor_id, &now)?;
            enqueue_outbox_batch(
                &app,
                vec![OutboxBatchItem {
                    entity_kind: OutboxEntityKind::CardComment,
                    entity_id: comment_id.clone(),
                    operation: OutboxOperation::Delete,
                    payload: json!({
                        "id": comment_id,
                        "cardId": card_id,
                        "deletedAt": now,
                        "updatedAt": now,
                    }),
                }],
            )?;
            let remaining = list_active_comments_in_conn(&conn, &card_id)?;
            let counts = super::model::todo_counts(&index);
            let state = todo_state_from_cache_or_disk(&app, store, &index, counts.clone())?;
            Ok((remaining, state, counts))
        })?;

        super::card_commands::emit_todo_counts(&app, &counts)?;
        super::card_commands::emit_todos_updated(&app, &state)?;
        let _ = emit_unread_comment_summary(&app)?;
        app.emit("todo-comments-updated", json!({ "cardIds": [card_id] }))
            .map_err(|err| err.to_string())?;
        Ok(remaining)
    })
    .await
    .map_err(|err| format!("todo delete comment task failed: {err}"))?
}

#[tauri::command]
pub async fn todos_get_unread_comment_summary(
    app: AppHandle,
) -> Result<TodoUnreadCommentSummary, String> {
    tauri::async_runtime::spawn_blocking(move || read_unread_comment_summary_unlocked(&app))
        .await
        .map_err(|err| format!("todo unread summary task failed: {err}"))?
}

#[tauri::command]
pub async fn todos_mark_card_comments_read(
    app: AppHandle,
    card_id: String,
) -> Result<TodoUnreadCommentSummary, String> {
    let trimmed = card_id.trim().to_string();
    if trimmed.is_empty() {
        return Err("Missing todo card id".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (summary, state) = with_todo_store_lock(&app, |store| {
            let now = crate::timestamp_string();
            let conn = open_workspace_db(&app)?;
            mark_card_comments_read_in_conn(&conn, &trimmed, &now)?;
            let (actor_id, _) = resolve_comment_actor(&app);
            let summary = read_unread_comment_summary_from_conn(&conn, &actor_id)?;
            let index = read_todo_index_unlocked(&app)?;
            let counts = super::model::todo_counts(&index);
            let state = todo_state_from_cache_or_disk(&app, store, &index, counts)?;
            Ok((summary, state))
        })?;

        super::card_commands::emit_todos_updated(&app, &state)?;
        app.emit("todo-comment-unread-updated", summary.clone())
            .map_err(|err| err.to_string())?;
        Ok(summary)
    })
    .await
    .map_err(|err| format!("todo mark card read task failed: {err}"))?
}

#[tauri::command]
pub async fn todos_mark_all_comments_read(
    app: AppHandle,
) -> Result<TodoUnreadCommentSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (summary, state) = with_todo_store_lock(&app, |store| {
            let now = crate::timestamp_string();
            let mut conn = open_workspace_db(&app)?;
            mark_all_comments_read_in_conn(&mut conn, &now)?;
            let (actor_id, _) = resolve_comment_actor(&app);
            let summary = read_unread_comment_summary_from_conn(&conn, &actor_id)?;
            let index = read_todo_index_unlocked(&app)?;
            let counts = super::model::todo_counts(&index);
            let state = todo_state_from_cache_or_disk(&app, store, &index, counts)?;
            Ok((summary, state))
        })?;

        super::card_commands::emit_todos_updated(&app, &state)?;
        app.emit("todo-comment-unread-updated", summary.clone())
            .map_err(|err| err.to_string())?;
        Ok(summary)
    })
    .await
    .map_err(|err| format!("todo mark all read task failed: {err}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_db::open_workspace_db_at;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static CMT_TEST_SEQ: AtomicU64 = AtomicU64::new(1);

    fn temp_comment_db(label: &str) -> PathBuf {
        let seq = CMT_TEST_SEQ.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "tidydesk-comments-test-{label}-{}-{seq}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        dir.join("workspace.db")
    }

    #[test]
    fn extract_mentions_handles_unicode_punctuation_and_deduplicates() {
        let found = extract_comment_mentions(
            "请 @alice 和 @bob_team 核对，@alice 顺便抄送 @charlie-1，忽略单独的 @ 符号",
        );
        assert_eq!(found, vec!["alice", "bob_team", "charlie-1"]);
    }

    #[test]
    fn comment_crud_soft_delete_and_auth_guard_work_correctly() {
        let db_path = temp_comment_db("crud");
        let conn = open_workspace_db_at(&db_path).unwrap();

        let root_cmt = insert_comment_in_conn(
            &conn,
            "card-1",
            "第一条排查记录 @bob",
            None,
            "alice",
            "Alice",
            "1000",
        )
        .unwrap();
        assert_eq!(root_cmt.mentions, vec!["bob"]);

        let reply_cmt = insert_comment_in_conn(
            &conn,
            "card-1",
            "收到，已处理",
            Some(&root_cmt.id),
            "bob",
            "Bob",
            "2000",
        )
        .unwrap();
        assert_eq!(reply_cmt.parent_id.as_deref(), Some(root_cmt.id.as_str()));

        // Bob cannot delete Alice's comment locally
        let err = soft_delete_comment_in_conn(&conn, "card-1", &root_cmt.id, "bob", "2500")
            .expect_err("other user cannot delete alice comment");
        assert!(err.contains("无权删除"));

        // Alice deletes her own comment
        soft_delete_comment_in_conn(&conn, "card-1", &root_cmt.id, "alice", "3000").unwrap();
        let active = list_active_comments_in_conn(&conn, "card-1").unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, reply_cmt.id);

        let metrics = read_card_comment_metrics_from_conn(&conn, "alice").unwrap();
        let card1 = metrics.get("card-1").unwrap();
        assert_eq!(card1.total_count, 1);
        assert_eq!(card1.unread_count, 1);

        drop(conn);
        if let Some(parent) = db_path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }

    #[test]
    fn sync_apply_respects_unsynced_comments_tombstones_and_new_alerts() {
        let db_path = temp_comment_db("sync");
        let mut conn = open_workspace_db_at(&db_path).unwrap();

        conn.execute(
            "INSERT INTO todo_cards (id, board_id, column_id, position, updated_at, deleted_at, metadata_json, content_md)
             VALUES ('card-9', 'default-board', 'todo', 'a0', '100', NULL, '{\"id\":\"card-9\",\"title\":\"发布前检查\"}', '')",
            [],
        )
        .unwrap();

        insert_comment_in_conn(&conn, "card-9", "本地草稿", None, "alice", "Alice", "1000")
            .unwrap();
        let local_draft_id = list_active_comments_in_conn(&conn, "card-9").unwrap()[0]
            .id
            .clone();

        let mut unsynced = HashSet::new();
        unsynced.insert(local_draft_id.clone());

        let remote_comments = vec![
            json!({
                "id": local_draft_id,
                "cardId": "card-9",
                "authorId": "bob",
                "authorName": "Bob",
                "body": "会被 unsynced 保护跳过",
                "mentions": [],
                "createdAt": "1500",
                "updatedAt": "1500",
                "deletedAt": null
            }),
            json!({
                "id": "cmt-remote-1",
                "cardId": "card-9",
                "authorId": "bob",
                "authorName": "Bob",
                "body": "远端同步评论 @alice 请确认",
                "mentions": ["alice"],
                "createdAt": "1600",
                "updatedAt": "1600",
                "deletedAt": null
            }),
        ];

        let sync_res = apply_synced_card_comments_in_conn(
            &mut conn,
            &remote_comments,
            &[],
            &unsynced,
            "alice",
            "2000",
        )
        .unwrap();
        assert_eq!(sync_res.affected_card_ids, vec!["card-9"]);
        assert_eq!(sync_res.new_alerts.len(), 1);
        assert_eq!(sync_res.new_alerts[0].card_title, "发布前检查");
        assert!(sync_res.new_alerts[0].is_mention_for_me);

        // Re-pulling the same remote comment must NOT emit duplicate alert
        let repeat_res = apply_synced_card_comments_in_conn(
            &mut conn,
            &remote_comments,
            &[],
            &unsynced,
            "alice",
            "2100",
        )
        .unwrap();
        assert!(repeat_res.new_alerts.is_empty());

        let list = list_active_comments_in_conn(&conn, "card-9").unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].body, "本地草稿");
        assert_eq!(list[1].id, "cmt-remote-1");

        // Remote removal deletes cmt-remote-1
        let rm_res = apply_synced_card_comments_in_conn(
            &mut conn,
            &[],
            &["cmt-remote-1".to_string()],
            &unsynced,
            "alice",
            "3000",
        )
        .unwrap();
        assert_eq!(rm_res.affected_card_ids, vec!["card-9"]);
        let list_after = list_active_comments_in_conn(&conn, "card-9").unwrap();
        assert_eq!(list_after.len(), 1);

        drop(conn);
        if let Some(parent) = db_path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }

    #[test]
    fn unread_comment_summary_and_mark_read_isolate_per_card_and_aggregate_alerts() {
        let db_path = temp_comment_db("unread");
        let mut conn = open_workspace_db_at(&db_path).unwrap();

        conn.execute(
            "INSERT INTO todo_cards (id, board_id, column_id, position, updated_at, deleted_at, metadata_json, content_md)
             VALUES ('card-a', 'b1', 'todo', 'a0', '100', NULL, '{\"title\":\"卡片 A\"}', ''),
                    ('card-b', 'b1', 'todo', 'a1', '100', NULL, '{\"title\":\"卡片 B\"}', ''),
                    ('card-deleted', 'b1', 'todo', 'a2', '100', '999', '{\"title\":\"已删卡片\"}', '')",
            [],
        )
        .unwrap();

        // Comments from alice (self -> never unread), bob on card-a (@alice), bob on card-b, bob on deleted card
        insert_comment_in_conn(
            &conn,
            "card-a",
            "我自己发的",
            None,
            "alice",
            "Alice",
            "1000",
        )
        .unwrap();
        insert_comment_in_conn(
            &conn,
            "card-a",
            "请 @alice 处理",
            None,
            "bob",
            "Bob",
            "1100",
        )
        .unwrap();
        insert_comment_in_conn(
            &conn,
            "card-b",
            "普通新回复",
            None,
            "charlie",
            "Charlie",
            "1200",
        )
        .unwrap();
        insert_comment_in_conn(
            &conn,
            "card-deleted",
            "不应统计",
            None,
            "bob",
            "Bob",
            "1300",
        )
        .unwrap();

        let summary = read_unread_comment_summary_from_conn(&conn, "alice").unwrap();
        assert_eq!(summary.unread_total, 2);
        assert_eq!(summary.mention_total, 1);
        assert_eq!(summary.items.len(), 2);
        assert_eq!(summary.items[0].card_id, "card-a");
        assert_eq!(summary.items[0].mention_count, 1);
        assert_eq!(summary.items[1].card_id, "card-b");

        // Mark card-a read: card-b remains unread!
        mark_card_comments_read_in_conn(&conn, "card-a", "1500").unwrap();
        let after_a = read_unread_comment_summary_from_conn(&conn, "alice").unwrap();
        assert_eq!(after_a.unread_total, 1);
        assert_eq!(after_a.mention_total, 0);
        assert_eq!(after_a.items[0].card_id, "card-b");

        // Mark all read clears remaining
        mark_all_comments_read_in_conn(&mut conn, "1600").unwrap();
        let after_all = read_unread_comment_summary_from_conn(&conn, "alice").unwrap();
        assert_eq!(after_all.unread_total, 0);
        assert!(after_all.items.is_empty());

        // Desktop notification formatting aggregates mentions first
        let notif = build_desktop_comment_notification(&[
            SyncedCommentAlert {
                comment_id: "c1".to_string(),
                card_id: "card-b".to_string(),
                card_title: "卡片 B".to_string(),
                author_id: "charlie".to_string(),
                author_name: "Charlie".to_string(),
                body_preview: "普通".to_string(),
                is_mention_for_me: false,
                created_at: "1200".to_string(),
            },
            SyncedCommentAlert {
                comment_id: "c2".to_string(),
                card_id: "card-a".to_string(),
                card_title: "卡片 A".to_string(),
                author_id: "bob".to_string(),
                author_name: "Bob".to_string(),
                body_preview: "请 @alice 处理".to_string(),
                is_mention_for_me: true,
                created_at: "1100".to_string(),
            },
        ])
        .unwrap();
        assert_eq!(notif.card_id, "card-a");
        assert!(notif.title.contains("2 条新评论"));
        assert!(notif.title.contains("1 条 @提及"));

        drop(conn);
        if let Some(parent) = db_path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }

    #[test]
    fn import_comments_carries_over_local_comments_and_rewrites_local_author() {
        let db_path = temp_comment_db("import");
        let conn = open_workspace_db_at(&db_path).unwrap();

        let local_cmt = insert_comment_in_conn(
            &conn,
            "card-1",
            "注册前的本地记录",
            None,
            "local",
            "本地用户",
            "1000",
        )
        .unwrap();
        let skipped_cmt = insert_comment_in_conn(
            &conn,
            "card-other",
            "不在目标导入范围",
            None,
            "local",
            "本地用户",
            "1100",
        )
        .unwrap();

        let target_db_path = temp_comment_db("import-target");
        let mut target_conn = open_workspace_db_at(&target_db_path).unwrap();
        let allowed: HashSet<String> = ["card-1".to_string()].into_iter().collect();

        let imported = import_comments_into_conn(
            &mut target_conn,
            &[local_cmt.clone(), skipped_cmt],
            &allowed,
            "alice",
            "Alice",
        )
        .unwrap();
        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].author_id, "alice");
        assert_eq!(imported[0].author_name, "Alice");

        // Re-importing is idempotent via INSERT OR IGNORE
        let imported_again =
            import_comments_into_conn(&mut target_conn, &[local_cmt], &allowed, "alice", "Alice")
                .unwrap();
        assert!(imported_again.is_empty());

        drop(conn);
        drop(target_conn);
        if let Some(parent) = db_path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
        if let Some(parent) = target_db_path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }
}
