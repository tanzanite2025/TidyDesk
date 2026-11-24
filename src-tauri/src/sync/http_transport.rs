use super::outbox::OutboxEntry;
use crate::accounts::session::{sanitize_workspace_id, validate_server_endpoint};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use url::form_urlencoded;

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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResponse {
    pub user_id: String,
    pub display_name: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAuthSessionInfo {
    pub token_id: String,
    pub label: String,
    pub created_at: String,
    #[serde(default)]
    pub last_used_at: Option<String>,
    #[serde(default)]
    pub revoked_at: Option<String>,
    #[serde(default)]
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteWorkspaceInfo {
    pub workspace_id: String,
    pub title: String,
    pub role: String,
    #[serde(default)]
    pub is_private: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct RemoteSessionsResponse {
    #[serde(default)]
    sessions: Vec<RemoteAuthSessionInfo>,
}

#[derive(Debug, Clone, Deserialize)]
struct RemoteWorkspacesResponse {
    #[serde(default)]
    workspaces: Vec<RemoteWorkspaceInfo>,
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
    workspace_id: String,
}

impl HttpSyncClient {
    pub fn new(endpoint: &str, user_id: &str, token: &str) -> Result<Self, String> {
        let trimmed_endpoint = validate_server_endpoint(Some(endpoint))?
            .ok_or_else(|| "服务端地址不能为空".to_string())?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|err| format!("failed to initialize HTTP sync client: {err}"))?;
        Ok(Self {
            client,
            endpoint: trimmed_endpoint,
            user_id: user_id.trim().to_string(),
            token: token.trim().to_string(),
            workspace_id: "default".to_string(),
        })
    }

    pub fn with_workspace(mut self, workspace_id: &str) -> Result<Self, String> {
        self.workspace_id = sanitize_workspace_id(Some(workspace_id))?;
        Ok(self)
    }

    pub async fn login_with_password(
        endpoint: &str,
        user_id: &str,
        password: &str,
        device_label: &str,
    ) -> Result<LoginResponse, String> {
        let base = validate_server_endpoint(Some(endpoint))?
            .ok_or_else(|| "服务端地址不能为空".to_string())?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|err| format!("failed to build auth HTTP client: {err}"))?;
        let resp = client
            .post(format!("{base}/api/v1/auth/login"))
            .json(&json!({
                "userId": user_id.trim(),
                "password": password,
                "deviceLabel": device_label,
            }))
            .send()
            .await
            .map_err(|err| format!("连接同步服务端登录失败: {err}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("登录失败 ({status}): {text}"));
        }
        resp.json::<LoginResponse>()
            .await
            .map_err(|err| format!("解析登录响应失败: {err}"))
    }

    pub async fn verify_credentials(&self) -> Result<(), String> {
        let url = self.resolve_url("/api/v1/auth/verify");
        let resp = self
            .apply_auth(self.client.post(&url))
            .json(&json!({
                "userId": self.user_id,
                "workspaceId": self.workspace_id,
            }))
            .send()
            .await
            .map_err(|err| format!("校验服务端凭据失败: {err}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("凭据或工作区权限校验失败 ({status}): {text}"));
        }
        Ok(())
    }

    pub async fn logout_session(&self) -> Result<(), String> {
        let url = self.resolve_url("/api/v1/auth/logout");
        let resp = self
            .apply_auth(self.client.post(&url))
            .send()
            .await
            .map_err(|err| format!("通知服务端登出吊销凭据失败: {err}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("服务端吊销会话失败 ({status}): {text}"));
        }
        Ok(())
    }

    pub async fn change_password(
        &self,
        old_password: &str,
        new_password: &str,
        revoke_all: bool,
    ) -> Result<(), String> {
        let url = self.resolve_url("/api/v1/auth/password");
        let resp = self
            .apply_auth(self.client.post(&url))
            .json(&json!({
                "oldPassword": old_password,
                "newPassword": new_password,
                "revokeAll": revoke_all,
            }))
            .send()
            .await
            .map_err(|err| format!("修改密码请求失败: {err}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("修改密码被拒绝 ({status}): {text}"));
        }
        Ok(())
    }

    pub async fn list_remote_sessions(&self) -> Result<Vec<RemoteAuthSessionInfo>, String> {
        let url = self.resolve_url("/api/v1/auth/sessions");
        let resp = self
            .apply_auth(self.client.get(&url))
            .send()
            .await
            .map_err(|err| format!("查询设备会话失败: {err}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("读取设备会话被拒绝 ({status}): {text}"));
        }
        let parsed = resp
            .json::<RemoteSessionsResponse>()
            .await
            .map_err(|err| format!("解析设备会话响应失败: {err}"))?;
        Ok(parsed.sessions)
    }

    pub async fn revoke_remote_session(&self, token_id: &str) -> Result<(), String> {
        let url = self.resolve_url("/api/v1/auth/sessions/revoke");
        let resp = self
            .apply_auth(self.client.post(&url))
            .json(&json!({ "tokenId": token_id }))
            .send()
            .await
            .map_err(|err| format!("吊销设备会话请求失败: {err}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("吊销设备会话失败 ({status}): {text}"));
        }
        Ok(())
    }

    pub async fn list_workspaces(&self) -> Result<Vec<RemoteWorkspaceInfo>, String> {
        let url = self.resolve_url("/api/v1/workspaces");
        let resp = self
            .apply_auth(self.client.get(&url))
            .send()
            .await
            .map_err(|err| format!("查询可访问工作区失败: {err}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("读取工作区列表失败 ({status}): {text}"));
        }
        let parsed = resp
            .json::<RemoteWorkspacesResponse>()
            .await
            .map_err(|err| format!("解析工作区列表失败: {err}"))?;
        Ok(parsed.workspaces)
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
                workspace_id: &self.workspace_id,
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
        let query = {
            let mut ser = form_urlencoded::Serializer::new(String::new());
            ser.append_pair("workspaceId", &self.workspace_id);
            if let Some(c) = cursor.map(str::trim).filter(|v| !v.is_empty()) {
                ser.append_pair("cursor", c);
            }
            ser.finish()
        };
        let url = self.resolve_url(&format!("/api/v1/sync/pull?{query}"));
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
