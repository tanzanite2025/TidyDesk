use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutMetadata {
    pub name: Option<String>,
    pub shortcut_path: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanMetadataResult {
    pub shortcuts: Vec<ShortcutMetadata>,
    pub scanned_paths: Vec<String>,
    pub duration_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub name: String,
    pub shortcut_path: String,
    pub target_path: String,
    pub icon: Option<String>,
    pub category: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanInstalledResult {
    pub apps: Vec<InstalledApp>,
    pub metadata: ScanMetadataResult,
    pub skipped_count: usize,
}

fn is_lnk_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("lnk"))
        == Some(true)
}

pub fn validate_importable_shortcut(shortcut_path: &Path) -> Result<(), String> {
    if shortcut_path.as_os_str().is_empty() {
        return Err("Missing shortcut path".to_string());
    }
    if !shortcut_path.exists() {
        return Err("Shortcut does not exist".to_string());
    }
    if !is_lnk_path(shortcut_path) {
        return Err("Only .lnk shortcuts can be added to a drawer".to_string());
    }

    let display_name = shortcut_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if should_skip_shortcut_name(display_name) {
        return Err("Installer and uninstaller shortcuts cannot be added to a drawer".to_string());
    }

    let shortcut_path_string = shortcut_path.to_string_lossy();
    let target_path = crate::resolve_shortcut_target(shortcut_path_string.as_ref())
        .map_err(|err| format!("failed to resolve shortcut target: {err}"))?
        .ok_or_else(|| "Shortcut target could not be resolved".to_string())?;
    let target = Path::new(&target_path);
    if !target.exists() {
        return Err("Shortcut target does not exist".to_string());
    }
    if target
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("exe"))
        != Some(true)
    {
        return Err("Only shortcuts targeting .exe files can be added to a drawer".to_string());
    }

    Ok(())
}

pub fn copy_shortcut_to_drawer(shortcut_path: &Path, target_dir: &Path) -> Result<PathBuf, String> {
    validate_importable_shortcut(shortcut_path)?;

    let file_name = shortcut_path
        .file_name()
        .ok_or_else(|| "Invalid shortcut path".to_string())?;
    let destination = crate::files::next_available_path(target_dir, file_name);
    fs::copy(shortcut_path, &destination)
        .map_err(|err| format!("failed to copy shortcut to drawer: {err}"))?;
    Ok(destination)
}

pub fn complete_installed_apps(metadata: ScanMetadataResult) -> ScanInstalledResult {
    let mut apps = Vec::new();
    let mut seen_targets = HashSet::new();
    let mut skipped_count = 0;

    for shortcut in &metadata.shortcuts {
        let shortcut_path = match shortcut.shortcut_path.as_deref() {
            Some(value) if !value.is_empty() => value,
            _ => {
                skipped_count += 1;
                continue;
            }
        };

        if Path::new(shortcut_path)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("lnk"))
            != Some(true)
        {
            skipped_count += 1;
            continue;
        }

        let display_name = shortcut
            .name
            .as_deref()
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| {
                Path::new(shortcut_path)
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "Unknown App".to_string());

        if should_skip_shortcut_name(&display_name) {
            skipped_count += 1;
            continue;
        }

        let target_path = match crate::resolve_shortcut_target(shortcut_path) {
            Ok(Some(value)) if !value.is_empty() => value,
            _ => {
                skipped_count += 1;
                continue;
            }
        };

        let target = Path::new(&target_path);
        if !target.exists() {
            skipped_count += 1;
            continue;
        }

        if target
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("exe"))
            != Some(true)
        {
            skipped_count += 1;
            continue;
        }

        let normalized_target = target_path.to_lowercase();
        if seen_targets.contains(&normalized_target) {
            skipped_count += 1;
            continue;
        }
        seen_targets.insert(normalized_target);

        apps.push(InstalledApp {
            name: display_name.clone(),
            shortcut_path: shortcut_path.to_string(),
            target_path: target_path.clone(),
            icon: crate::icons::extract_icon_data_url(target),
            category: categorize_app(
                &display_name,
                &target_path,
                shortcut.category.as_deref().unwrap_or("other"),
            ),
        });
    }

    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    ScanInstalledResult {
        apps,
        metadata,
        skipped_count,
    }
}

pub fn should_skip_shortcut_name(name: &str) -> bool {
    let name_lower = name.to_lowercase();
    name_lower.contains("uninstall")
        || name_lower.contains("unins")
        || name_lower.contains("setup")
        || name_lower.contains("installer")
}

pub fn categorize_app(name: &str, target_path: &str, fallback: &str) -> String {
    let name_lower = name.to_lowercase();
    let path_lower = target_path.to_lowercase();

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

    fallback.to_string()
}

pub fn scan_metadata_params() -> Value {
    json!({
        "startMenuPaths": start_menu_paths(),
        "desktopPath": crate::files::desktop_path(),
        "maxDepth": 3,
        "skipDirectories": [
            "Accessories",
            "Administrative Tools",
            "Maintenance",
            "System Tools",
            "Startup"
        ]
    })
}

pub fn start_menu_paths() -> Vec<String> {
    let mut paths = Vec::new();
    if let Ok(program_data) = std::env::var("PROGRAMDATA") {
        paths.push(format!(
            "{program_data}\\Microsoft\\Windows\\Start Menu\\Programs"
        ));
    }
    if let Ok(app_data) = std::env::var("APPDATA") {
        paths.push(format!(
            "{app_data}\\Microsoft\\Windows\\Start Menu\\Programs"
        ));
    }
    paths
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("tidydesk-{name}-{}-{unique}", std::process::id()));
        fs::create_dir_all(&dir).expect("failed to create temp test directory");
        dir
    }

    #[cfg(windows)]
    fn shortcut_test_target_exe() -> PathBuf {
        let windows_dir = std::env::var_os("WINDIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        [
            windows_dir.join("System32").join("notepad.exe"),
            windows_dir.join("System32").join("cmd.exe"),
            windows_dir.join("explorer.exe"),
        ]
        .into_iter()
        .find(|candidate| candidate.exists())
        .unwrap_or_else(|| panic!("failed to locate a Windows executable for shortcut tests"))
    }

    #[test]
    fn copy_shortcut_to_drawer_creates_unique_destination() {
        let root = temp_test_dir("drawer-copy");
        let source_dir = root.join("source");
        let target_dir = root.join("target");
        fs::create_dir_all(&source_dir).expect("failed to create source dir");
        fs::create_dir_all(&target_dir).expect("failed to create target dir");

        let source_path = source_dir.join("Calculator.lnk");
        fs::write(&source_path, "shortcut-a").expect("failed to write shortcut");

        let first_copy =
            copy_shortcut_to_drawer(&source_path, &target_dir).expect("first copy should succeed");
        let second_copy = copy_shortcut_to_drawer(&source_path, &target_dir)
            .expect("second copy should get unique name");

        assert!(first_copy.exists());
        assert!(second_copy.exists());
        assert_ne!(first_copy, second_copy);
        assert_eq!(
            second_copy.file_name(),
            Some(OsStr::new("Calculator (1).lnk"))
        );
    }

    #[test]
    fn copy_shortcut_to_drawer_rejects_non_shortcut_files() {
        let root = temp_test_dir("drawer-copy-invalid");
        let target_dir = root.join("target");
        fs::create_dir_all(&target_dir).expect("failed to create target dir");
        let source_path = root.join("notes.txt");
        fs::write(&source_path, "not a shortcut").expect("failed to write test file");

        let error = copy_shortcut_to_drawer(&source_path, &target_dir)
            .expect_err("non-shortcut files must be rejected");
        assert!(error.contains(".lnk"));
    }

    #[cfg(windows)]
    #[test]
    fn scanned_shortcut_can_be_imported_into_drawer() {
        let root = temp_test_dir("apps-scan-import");
        let source_dir = root.join("source");
        let target_dir = root.join("drawer");
        fs::create_dir_all(&source_dir).expect("failed to create source dir");
        fs::create_dir_all(&target_dir).expect("failed to create target dir");

        let target_exe = shortcut_test_target_exe();
        let primary_shortcut = source_dir.join("System Tool.lnk");
        let duplicate_shortcut = source_dir.join("System Tool Copy.lnk");
        crate::write_shortcut_link(&primary_shortcut, &target_exe, "primary shortcut")
            .expect("failed to create primary shortcut");
        crate::write_shortcut_link(&duplicate_shortcut, &target_exe, "duplicate shortcut")
            .expect("failed to create duplicate shortcut");

        let ignored_file = source_dir.join("readme.txt");
        fs::write(&ignored_file, "ignore me").expect("failed to create ignored file");

        let installed = complete_installed_apps(ScanMetadataResult {
            shortcuts: vec![
                ShortcutMetadata {
                    name: Some("System Tool".to_string()),
                    shortcut_path: Some(primary_shortcut.display().to_string()),
                    category: Some("other".to_string()),
                },
                ShortcutMetadata {
                    name: Some("System Tool Copy".to_string()),
                    shortcut_path: Some(duplicate_shortcut.display().to_string()),
                    category: Some("other".to_string()),
                },
                ShortcutMetadata {
                    name: Some("Ignored".to_string()),
                    shortcut_path: Some(ignored_file.display().to_string()),
                    category: Some("other".to_string()),
                },
                ShortcutMetadata {
                    name: Some("Missing Shortcut".to_string()),
                    shortcut_path: None,
                    category: Some("other".to_string()),
                },
            ],
            scanned_paths: vec![source_dir.display().to_string()],
            duration_ms: 1,
        });

        assert_eq!(installed.apps.len(), 1);
        assert_eq!(installed.skipped_count, 3);

        let app = installed.apps.first().expect("one app should remain");
        assert_eq!(app.name, "System Tool");
        assert_eq!(app.shortcut_path, primary_shortcut.display().to_string());
        assert_eq!(
            PathBuf::from(&app.target_path)
                .canonicalize()
                .expect("resolved target should exist"),
            target_exe.canonicalize().expect("target exe should exist")
        );

        let copied_shortcut = copy_shortcut_to_drawer(Path::new(&app.shortcut_path), &target_dir)
            .expect("drawer import should copy the shortcut");
        assert!(copied_shortcut.exists());

        let copied_target = crate::resolve_shortcut_target(&copied_shortcut.display().to_string())
            .expect("copied shortcut should resolve")
            .expect("copied shortcut should have a target");
        assert_eq!(
            PathBuf::from(copied_target)
                .canonicalize()
                .expect("copied target should exist"),
            target_exe.canonicalize().expect("target exe should exist")
        );
    }
}
