use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Debug)]
pub(super) struct ShortcutValidationResult {
    pub is_valid: bool,
    pub target_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairShortcutPayload {
    pub shortcut_path: String,
    pub target_path: String,
}

#[derive(Debug, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutValidationStats {
    pub total: usize,
    pub valid: usize,
    pub invalid: usize,
    pub repaired: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairShortcutResult {
    pub repaired: bool,
    pub new_path: Option<String>,
}

fn validate_shortcut_with(
    shortcut_path: &Path,
    resolver: Option<&crate::ShortcutResolver>,
) -> ShortcutValidationResult {
    let shortcut_str = shortcut_path.display().to_string();
    let target_path = match resolver {
        Some(active_resolver) => active_resolver.resolve_target(&shortcut_str).ok().flatten(),
        None => crate::resolve_shortcut_target(&shortcut_str).ok().flatten(),
    }
    .filter(|value| !value.is_empty());

    match target_path {
        Some(target_path) => ShortcutValidationResult {
            is_valid: Path::new(&target_path).exists(),
            target_path: Some(target_path),
        },
        None => ShortcutValidationResult {
            is_valid: false,
            target_path: None,
        },
    }
}

pub(super) fn attempt_shortcut_repair(
    shortcut_path: &Path,
    target_path: &str,
) -> Result<RepairShortcutResult, String> {
    if target_path.trim().is_empty() {
        return Ok(RepairShortcutResult {
            repaired: false,
            new_path: None,
        });
    }

    let Some(file_name) = Path::new(target_path).file_name() else {
        return Ok(RepairShortcutResult {
            repaired: false,
            new_path: None,
        });
    };

    let repair_candidates = shortcut_repair_candidates(file_name);
    if repair_candidates.len() != 1 {
        if repair_candidates.len() > 1 {
            eprintln!(
                "[TIDYDESK] Skip auto-repair for {} because {} candidates matched {}",
                shortcut_path.display(),
                repair_candidates.len(),
                Path::new(target_path).display()
            );
        }
        return Ok(RepairShortcutResult {
            repaired: false,
            new_path: None,
        });
    }

    let possible_path = &repair_candidates[0];
    let description = format!(
        "TidyDesk shortcut for {} (auto-repaired)",
        possible_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
    );

    match crate::write_shortcut_link(shortcut_path, possible_path, &description) {
        Ok(()) => {
            return Ok(RepairShortcutResult {
                repaired: true,
                new_path: Some(possible_path.display().to_string()),
            });
        }
        Err(err) => {
            eprintln!(
                "[TIDYDESK] Failed to repair shortcut {} with {}: {}",
                shortcut_path.display(),
                possible_path.display(),
                err
            );
        }
    }

    Ok(RepairShortcutResult {
        repaired: false,
        new_path: None,
    })
}

fn shortcut_repair_search_paths() -> Vec<PathBuf> {
    let Ok(profile) = std::env::var("USERPROFILE") else {
        return Vec::new();
    };
    let mut paths = Vec::new();
    paths.push(PathBuf::from(format!("{profile}\\Desktop")));
    paths.push(PathBuf::from(format!("{profile}\\Documents")));
    paths.push(PathBuf::from(format!("{profile}\\Downloads")));
    paths.push(PathBuf::from(format!("{profile}\\Pictures")));
    paths.push(PathBuf::from(format!("{profile}\\Videos")));
    if let Ok(programs) = std::env::var("ProgramFiles") {
        paths.push(PathBuf::from(programs));
    }
    if let Ok(programs) = std::env::var("ProgramFiles(x86)") {
        paths.push(PathBuf::from(programs));
    }
    paths
}

fn shortcut_repair_candidates(file_name: &std::ffi::OsStr) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for search_path in shortcut_repair_search_paths() {
        let possible_path = search_path.join(file_name);
        if possible_path.is_file() {
            candidates.push(possible_path);
        }
    }
    candidates
}

pub(super) fn shortcuts_validate_all_internal(
    app: &AppHandle,
) -> Result<ShortcutValidationStats, String> {
    crate::prepare_drawer_storage(app)?;
    let drawer_root = crate::drawer_root(app)?;
    let resolver = crate::ShortcutResolver::new().ok();
    let mut stats = ShortcutValidationStats::default();

    let drawer_items =
        fs::read_dir(&drawer_root).map_err(|err| format!("failed to read drawer root: {err}"))?;

    for drawer_item in drawer_items {
        let Ok(drawer_item) = drawer_item else {
            continue;
        };
        let Ok(file_type) = drawer_item.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }

        let drawer_path = drawer_item.path();
        let Ok(entries) = fs::read_dir(&drawer_path) else {
            continue;
        };

        for entry in entries {
            let Ok(entry) = entry else {
                continue;
            };
            let Ok(entry_type) = entry.file_type() else {
                continue;
            };
            if !entry_type.is_file() {
                continue;
            }

            let shortcut_path = entry.path();
            if shortcut_path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case("lnk"))
                != Some(true)
            {
                continue;
            }

            stats.total += 1;
            let validation = validate_shortcut_with(&shortcut_path, resolver.as_ref());
            if validation.is_valid {
                stats.valid += 1;
                continue;
            }

            if let Some(target_path) = validation.target_path {
                let repair = attempt_shortcut_repair(&shortcut_path, &target_path)?;
                if repair.repaired {
                    stats.repaired += 1;
                    stats.valid += 1;
                } else {
                    stats.invalid += 1;
                }
            } else {
                stats.invalid += 1;
            }
        }
    }

    Ok(stats)
}
