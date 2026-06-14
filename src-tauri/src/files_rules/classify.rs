use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

pub fn file_extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default()
}

pub fn modified_at(metadata: &fs::Metadata) -> String {
    metadata
        .modified()
        .unwrap_or(UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

pub fn path_identity(path: &Path, metadata: &fs::Metadata) -> String {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("item")
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    format!("{}-{}-{file_name}", metadata.len(), modified_at(metadata))
}

pub fn category_by_extension(ext: &str, file_name: &str) -> String {
    let name_lower = file_name.to_lowercase();
    let ext_lower = ext.trim_start_matches('.').to_lowercase();

    if name_lower.starts_with("新建")
        || name_lower.starts_with("untitled")
        || name_lower.contains("screenshot")
        || name_lower.starts_with("temp")
        || name_lower.starts_with("tmp")
    {
        return "temporary".to_string();
    }

    if matches!(
        ext_lower.as_str(),
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "svg" | "webp" | "ico"
    ) {
        return "image".to_string();
    }
    if matches!(
        ext_lower.as_str(),
        "doc"
            | "docx"
            | "xls"
            | "xlsx"
            | "ppt"
            | "pptx"
            | "pdf"
            | "txt"
            | "csv"
            | "md"
            | "key"
            | "numbers"
            | "pages"
    ) {
        return "document".to_string();
    }
    if matches!(
        ext_lower.as_str(),
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2"
    ) {
        return "archive".to_string();
    }
    if matches!(
        ext_lower.as_str(),
        "exe" | "msi" | "bat" | "cmd" | "dmg" | "pkg" | "lnk" | "url"
    ) {
        return "app".to_string();
    }
    if matches!(
        ext_lower.as_str(),
        "ts" | "tsx"
            | "js"
            | "jsx"
            | "json"
            | "html"
            | "css"
            | "py"
            | "go"
            | "rs"
            | "cpp"
            | "h"
            | "java"
            | "sh"
            | "yaml"
            | "yml"
    ) {
        return "developer".to_string();
    }

    "other".to_string()
}
