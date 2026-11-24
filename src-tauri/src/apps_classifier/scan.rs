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
    let resolver = crate::ShortcutResolver::new().ok();

    let mut ctx = ShortcutScanContext {
        source: "startMenu",
        recursive: true,
        max_depth,
        skip_directories: &skip_directories,
        seen_shortcuts: &mut seen_shortcuts,
        shortcuts: &mut shortcuts,
        resolver: resolver.as_ref(),
    };

    for start_menu_path in start_menu_paths() {
        let path = PathBuf::from(&start_menu_path);
        if !path.exists() {
            continue;
        }
        scanned_paths.push(start_menu_path);
        scan_shortcut_directory(&path, 0, &mut ctx);
    }

    let desktop_path = crate::files::desktop_path();
    if !desktop_path.is_empty() {
        let path = PathBuf::from(&desktop_path);
        if path.exists() {
            scanned_paths.push(desktop_path);
            ctx.source = "desktop";
            ctx.recursive = false;
            scan_shortcut_directory(&path, 0, &mut ctx);
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

struct ShortcutScanContext<'a> {
    source: &'a str,
    recursive: bool,
    max_depth: usize,
    skip_directories: &'a HashSet<String>,
    seen_shortcuts: &'a mut HashSet<String>,
    shortcuts: &'a mut Vec<ShortcutMetadata>,
    resolver: Option<&'a crate::ShortcutResolver>,
}

fn scan_shortcut_directory(dir_path: &Path, depth: usize, ctx: &mut ShortcutScanContext<'_>) {
    if depth > ctx.max_depth {
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
            if ctx.recursive && !ctx.skip_directories.contains(&name.to_lowercase()) {
                scan_shortcut_directory(&full_path, depth + 1, ctx);
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
        if !ctx.seen_shortcuts.insert(normalized_path) {
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        let shortcut_path_str = full_path.display().to_string();
        let target_path = ctx
            .resolver
            .and_then(|active| active.resolve_target(&shortcut_path_str).ok())
            .flatten()
            .filter(|value| !value.is_empty());

        ctx.shortcuts.push(ShortcutMetadata {
            name: Some(name.clone()),
            shortcut_path: Some(shortcut_path_str),
            target_path,
            source: Some(ctx.source.to_string()),
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
