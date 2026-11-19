use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopFile {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub category: String,
    pub extension: String,
    pub modified_at: String,
    pub is_simulated: bool,
    pub parent_id: Option<String>,
    pub is_valid: Option<bool>,
    pub is_managed: bool,
    pub target_path: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopFolder {
    pub id: String,
    pub name: String,
    pub path: String,
    pub category: String,
    pub modified_at: String,
    pub is_simulated: bool,
    pub parent_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopFilesResult {
    pub files: Vec<DesktopFile>,
    pub folders: Vec<DesktopFolder>,
    pub desktop_path: String,
    pub tidy_box_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameItemPayload {
    pub old_name: String,
    pub new_name: String,
    pub parent_folder: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteItemPayload {
    pub name: String,
    pub parent_folder: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFilePayload {
    pub file_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportExternalFilesPayload {
    pub file_paths: Vec<String>,
    pub target_folder: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFileResult {
    pub source: String,
    pub shortcut: String,
    pub mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportSkippedReason {
    Missing,
    AlreadyInDrawer,
    Protected,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSkippedFileResult {
    pub source: String,
    pub reason: ImportSkippedReason,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailedFileResult {
    pub source: String,
    pub error: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportExternalFilesResult {
    pub success: bool,
    pub added: Vec<ImportedFileResult>,
    pub skipped: Vec<ImportSkippedFileResult>,
    pub failed: Vec<ImportFailedFileResult>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreToDesktopPayload {
    pub shortcut_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreToDesktopResult {
    pub success: bool,
    pub restored_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIconRequest {
    pub id: String,
    pub path: String,
    #[serde(default)]
    pub target_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIconBatchPayload {
    pub files: Vec<FileIconRequest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIconResult {
    pub id: String,
    pub icon: Option<String>,
}
