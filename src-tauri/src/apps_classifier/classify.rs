use std::path::Path;

pub fn should_skip_shortcut_name(name: &str) -> bool {
    let name_lower = name.to_lowercase();
    name_lower.contains("uninstall")
        || name_lower.contains("unins")
        || name_lower.contains("setup")
        || name_lower.contains("installer")
}

pub(super) fn categorize_shortcut(name: &str, shortcut_path: &Path) -> String {
    let name_lower = name.to_lowercase();
    let path_lower = shortcut_path.to_string_lossy().to_lowercase();

    if name_lower.contains("chrome")
        || name_lower.contains("firefox")
        || name_lower.contains("edge")
        || name_lower.contains("browser")
    {
        return "browser".to_string();
    }

    if name_lower.contains("visual studio")
        || name_lower.contains("vscode")
        || name_lower.contains("code")
        || name_lower.contains("git")
        || path_lower.contains("\\microsoft vs code\\")
    {
        return "development".to_string();
    }

    if name_lower.contains("word")
        || name_lower.contains("excel")
        || name_lower.contains("powerpoint")
        || name_lower.contains("office")
        || name_lower.contains("wps")
    {
        return "office".to_string();
    }

    if name_lower.contains("wechat")
        || name_lower.contains("qq")
        || name_lower.contains("dingtalk")
        || name_lower.contains("teams")
        || name_lower.contains("微信")
        || name_lower.contains("钉钉")
    {
        return "communication".to_string();
    }

    if name_lower.contains("player")
        || name_lower.contains("music")
        || name_lower.contains("video")
        || name_lower.contains("photoshop")
    {
        return "media".to_string();
    }

    "other".to_string()
}
