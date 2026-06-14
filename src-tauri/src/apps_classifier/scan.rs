use super::{classify, ScanMetadataResult, ShortcutMetadata};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub fn scan_shortcut_metadata() -> ScanMetadataResult {
    let started = Instant::now();
    let max_depth = 3;
    let skip_directories = [
        "Accessories",
        "Administrative Tools",
        "Maintenance",
        "System Tools",
        "Startup",
    ]
    .into_iter()
    .map(|name| name.to_lowercase())
    .collect::<HashSet<_>>();
    let mut shortcuts = Vec::new();
    let mut scanned_paths = Vec::new();
    let mut seen_shortcuts = HashSet::new();

    for start_menu_path in start_menu_paths() {
        let path = PathBuf::from(&start_menu_path);
        if !path.exists() {
            continue;
        }
        scanned_paths.push(start_menu_path);
        scan_shortcut_directory(
            &path,
            "startMenu",
            true,
            0,
            max_depth,
            &skip_directories,
            &mut seen_shortcuts,
            &mut shortcuts,
        );
    }

    let desktop_path = crate::files::desktop_path();
    if !desktop_path.is_empty() {
        let path = PathBuf::from(&desktop_path);
        if path.exists() {
            scanned_paths.push(desktop_path);
            scan_shortcut_directory(
                &path,
                "desktop",
                false,
                0,
                max_depth,
                &skip_directories,
                &mut seen_shortcuts,
                &mut shortcuts,
            );
        }
    }

    shortcuts.sort_by(|a, b| {
        a.name
            .as_deref()
            .unwrap_or_default()
            .to_lowercase()
            .cmp(&b.name.as_deref().unwrap_or_default().to_lowercase())
    });

    ScanMetadataResult {
        shortcuts,
        scanned_paths,
        duration_ms: started.elapsed().as_millis() as i64,
    }
}

fn scan_shortcut_directory(
    dir_path: &Path,
    source: &str,
    recursive: bool,
    depth: usize,
    max_depth: usize,
    skip_directories: &HashSet<String>,
    seen_shortcuts: &mut HashSet<String>,
    shortcuts: &mut Vec<ShortcutMetadata>,
) {
    if depth > max_depth {
        return;
    }

    let Ok(entries) = fs::read_dir(dir_path) else {
        return;
    };

    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        let full_path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if recursive && !skip_directories.contains(&name.to_lowercase()) {
                scan_shortcut_directory(
                    &full_path,
                    source,
                    recursive,
                    depth + 1,
                    max_depth,
                    skip_directories,
                    seen_shortcuts,
                    shortcuts,
                );
            }
            continue;
        }

        if !file_type.is_file() || !super::is_lnk_path(&full_path) {
            continue;
        }

        let name = full_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        if name.is_empty() || classify::should_skip_shortcut_name(&name) {
            continue;
        }

        let normalized_path = full_path.to_string_lossy().to_lowercase();
        if !seen_shortcuts.insert(normalized_path) {
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        shortcuts.push(ShortcutMetadata {
            name: Some(name.clone()),
            shortcut_path: Some(full_path.display().to_string()),
            source: Some(source.to_string()),
            category: Some(classify::categorize_shortcut(&name, &full_path)),
            size: Some(metadata.len()),
            modified_at: metadata.modified().ok().and_then(system_time_millis),
            depth: Some(depth),
        });
    }
}

fn system_time_millis(value: SystemTime) -> Option<i64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as i64)
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
