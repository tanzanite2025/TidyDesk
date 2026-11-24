use super::outbox::OutboxEntry;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresignMediaResponse {
    pub deduplicated: bool,
    pub thumb_key: String,
    pub original_key: String,
    pub thumb_upload_path: String,
    pub original_upload_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AckedOutboxRef {
    pub entity_kind: super::outbox::OutboxEntityKind,
    pub entity_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpPushResponse {
    pub next_cursor: String,
    #[serde(default)]
    pub acked: Vec<AckedOutboxRef>,
    #[serde(default)]
    pub merged_cards: Vec<Value>,
    #[serde(default)]
    pub conflicts: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpPullResponse {
    pub next_cursor: String,
    #[serde(default)]
    pub cards: Vec<Value>,
    #[serde(default)]
    pub removed_card_ids: Vec<String>,
    #[serde(default)]
    pub quick_notes: Vec<Value>,
    #[serde(default)]
    pub removed_quick_note_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PushRequestBody<'a> {
    workspace_id: &'a str,
    entries: &'a [OutboxEntry],
}

pub struct HttpSyncClient {
    client: reqwest::Client,
    endpoint: String,
    user_id: String,
    token: String,
}

impl HttpSyncClient {
    pub fn new(endpoint: &str, user_id: &str, token: &str) -> Result<Self, String> {
        let trimmed_endpoint = endpoint.trim().trim_end_matches('/').to_string();
        if trimmed_endpoint.is_empty() {
            return Err("服务端地址不能为空".to_string());
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|err| format!("failed to initialize HTTP sync client: {err}"))?;
        Ok(Self {
            client,
            endpoint: trimmed_endpoint,
            user_id: user_id.trim().to_string(),
            token: token.trim().to_string(),
        })
    }

    fn apply_auth(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        builder
            .bearer_auth(&self.token)
            .header("X-TidyDesk-User", &self.user_id)
    }

    fn resolve_url(&self, path_or_url: &str) -> String {
        if path_or_url.starts_with("http://") || path_or_url.starts_with("https://") {
            path_or_url.to_string()
        } else {
            format!("{}/{}", self.endpoint, path_or_url.trim_start_matches('/'))
        }
    }

    pub async fn presign_media(
        &self,
        sha256: &str,
        mime_type: &str,
    ) -> Result<PresignMediaResponse, String> {
        let url = self.resolve_url("/api/v1/media/presign");
        let resp = self
            .apply_auth(self.client.post(&url))
            .json(&json!({ "sha256": sha256, "mimeType": mime_type }))
            .send()
            .await
            .map_err(|err| format!("媒体秒传预检请求失败: {err}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("媒体预检失败 ({status}): {text}"));
        }
        resp.json::<PresignMediaResponse>()
            .await
            .map_err(|err| format!("解析媒体预检响应失败: {err}"))
    }

    pub async fn upload_blob(
        &self,
        path_or_url: &str,
        bytes: Vec<u8>,
        sha256: &str,
    ) -> Result<(), String> {
        let url = self.resolve_url(path_or_url);
        let resp = self
            .apply_auth(self.client.put(&url))
            .header("x-tidydesk-sha256", sha256)
            .body(bytes)
            .send()
            .await
            .map_err(|err| format!("上传附件二进制失败: {err}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("上传附件失败 ({status}): {text}"));
        }
        Ok(())
    }

    pub async fn download_blob(&self, kind: &str, key: &str) -> Result<Vec<u8>, String> {
        let safe_key = key.trim().trim_start_matches('/');
        let url = self.resolve_url(&format!("/api/v1/media/blob/{kind}/{safe_key}"));
        let resp = self
            .apply_auth(self.client.get(&url))
            .send()
            .await
            .map_err(|err| format!("下载附件失败: {err}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            return Err(format!("下载远端附件失败 ({status})"));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|err| format!("读取远端附件字节失败: {err}"))?;
        Ok(bytes.to_vec())
    }

    pub async fn push_changes(&self, entries: &[OutboxEntry]) -> Result<HttpPushResponse, String> {
        if entries.is_empty() {
            return Ok(HttpPushResponse {
                next_cursor: String::new(),
                acked: Vec::new(),
                merged_cards: Vec::new(),
                conflicts: Vec::new(),
            });
        }
        let url = self.resolve_url("/api/v1/sync/push");
        let resp = self
            .apply_auth(self.client.post(&url))
            .json(&PushRequestBody {
                workspace_id: "default",
                entries,
            })
            .send()
            .await
            .map_err(|err| format!("推送同步变更失败: {err}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("推送同步被拒绝 ({status}): {text}"));
        }
        resp.json::<HttpPushResponse>()
            .await
            .map_err(|err| format!("解析推送响应失败: {err}"))
    }

    pub async fn pull_changes(&self, cursor: Option<&str>) -> Result<HttpPullResponse, String> {
        let mut url = self.resolve_url("/api/v1/sync/pull");
        if let Some(c) = cursor.map(str::trim).filter(|v| !v.is_empty()) {
            url = format!("{url}?cursor={c}");
        }
        let resp = self
            .apply_auth(self.client.get(&url))
            .send()
            .await
            .map_err(|err| format!("拉取远端更新失败: {err}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("拉取同步失败 ({status}): {text}"));
        }
        resp.json::<HttpPullResponse>()
            .await
            .map_err(|err| format!("解析拉取响应失败: {err}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_client_normalizes_endpoint_and_rejects_empty() {
        assert!(HttpSyncClient::new("   ", "alice", "tok").is_err());
        let client = HttpSyncClient::new("https://sync.example.com/", "alice", "tok").unwrap();
        assert_eq!(
            client.resolve_url("/api/v1/sync/pull"),
            "https://sync.example.com/api/v1/sync/pull"
        );
        assert_eq!(
            client.resolve_url("https://cdn.example.com/blob/1.png"),
            "https://cdn.example.com/blob/1.png"
        );
    }
}
