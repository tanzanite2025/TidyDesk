use super::dto::{
    ImportExternalFilesPayload, ImportExternalFilesResult, ImportFailedFileResult,
    ImportSkippedFileResult, ImportSkippedReason, ImportedFileResult,
};
use crate::files_rules::{create_drawer_shortcut, is_protected_desktop_item, resolve_drawer_path};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

#[tauri::command]
pub async fn files_import_external_files(
    app: AppHandle,
    payload: ImportExternalFilesPayload,
) -> Result<ImportExternalFilesResult, String> {
    tauri::async_runtime::spawn_blocking(move || files_import_external_files_sync(&app, payload))
        .await
        .map_err(|err| format!("import files task failed: {err}"))?
}

fn files_import_external_files_sync(
    app: &AppHandle,
    payload: ImportExternalFilesPayload,
) -> Result<ImportExternalFilesResult, String> {
    if payload.file_paths.is_empty() {
        return Err("Missing files to import".to_string());
    }
    if payload.file_paths.len() > 100 {
        return Err("Too many files (max 100 per batch)".to_string());
    }
    crate::prepare_drawer_storage(app)?;
    let target_dir = resolve_drawer_path(app, payload.target_folder.as_deref().unwrap_or(""))?;
    fs::create_dir_all(&target_dir).map_err(|err| format!("failed to create drawer: {err}"))?;
    let drawer_root = crate::drawer_root(app)?;
    let resolved_drawer_root = crate::resolve_path_for_comparison(&drawer_root);
    let mut added = Vec::new();
    let mut skipped = Vec::new();
    let mut failed = Vec::new();

    for file_path in payload.file_paths {
        if file_path.trim().is_empty() || file_path.len() > 260 {
            failed.push(ImportFailedFileResult {
                source: file_path,
                error: "Invalid file path".to_string(),
            });
            continue;
        }

        let source_path = PathBuf::from(file_path);
        if !source_path.exists() {
            skipped.push(ImportSkippedFileResult {
                source: source_path.display().to_string(),
                reason: ImportSkippedReason::Missing,
            });
            continue;
        }
        let resolved_source = match source_path.canonicalize() {
            Ok(path) => path,
            Err(err) => {
                failed.push(ImportFailedFileResult {
                    source: source_path.display().to_string(),
                    error: format!("failed to resolve source path: {err}"),
                });
                continue;
            }
        };
        if crate::is_path_inside_resolved(&resolved_source, &resolved_drawer_root) {
            skipped.push(ImportSkippedFileResult {
                source: resolved_source.display().to_string(),
                reason: ImportSkippedReason::AlreadyInDrawer,
            });
            continue;
        }
        let Some(source_name) = resolved_source.file_name().and_then(|value| value.to_str()) else {
            failed.push(ImportFailedFileResult {
                source: resolved_source.display().to_string(),
                error: "Invalid source file name".to_string(),
            });
            continue;
        };
        if is_protected_desktop_item(source_name) {
            skipped.push(ImportSkippedFileResult {
                source: resolved_source.display().to_string(),
                reason: ImportSkippedReason::Protected,
            });
            continue;
        }

        match create_drawer_shortcut(app, &resolved_source, &target_dir) {
            Ok(shortcut) => added.push(ImportedFileResult {
                source: resolved_source.display().to_string(),
                shortcut: shortcut.display().to_string(),
                mode: "shortcut".to_string(),
            }),
            Err(err) => failed.push(ImportFailedFileResult {
                source: resolved_source.display().to_string(),
                error: err,
            }),
        }
    }

    Ok(ImportExternalFilesResult {
        success: failed.is_empty(),
        added,
        skipped,
        failed,
    })
}
