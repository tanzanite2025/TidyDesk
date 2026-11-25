use crate::persistence::atomic_write_json;
use crate::quick_notes::with_quick_notes_store_lock;
use crate::sticky_notes::with_sticky_notes_store_lock;
use crate::sync::outbox::with_outbox_lock;
use crate::todos::compute_sha256_hex;
use crate::todos::store::{clear_todo_content_cache, with_todo_store_lock};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager};

const SNAPSHOT_MANIFEST_FILE: &str = "snapshot-manifest.json";
const SNAPSHOT_VERSION: u32 = 1;
const SNAPSHOT_DIR_PREFIX: &str = "snapshot-";
const PRE_RESTORE_PREFIX: &str = "pre-restore-";
static SNAPSHOT_FOLDER_SEQ: AtomicU64 = AtomicU64::new(1);

fn next_snapshot_folder_name(prefix: &str, now_ms: &str) -> String {
    let seq = SNAPSHOT_FOLDER_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}{now_ms}-{seq}")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotFileEntry {
    pub relative_path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotManifest {
    pub version: u32,
    pub created_at_ms: String,
    pub app_version: String,
    pub scope_id: String,
    pub file_count: usize,
    pub total_bytes: u64,
    pub files: Vec<SnapshotFileEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSnapshotSummary {
    pub snapshot_dir: String,
    pub folder_name: String,
    pub created_at_ms: String,
    pub app_version: String,
    pub scope_id: String,
    pub file_count: usize,
    pub total_bytes: u64,
    pub corrupt_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotVerificationReport {
    pub snapshot_dir: String,
    pub scope_id: String,
    pub verified_files: usize,
    pub total_bytes: u64,
    pub valid: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataRestoreSummary {
    pub snapshot_dir: String,
    pub restored_files: usize,
    pub pre_restore_snapshot_dir: Option<String>,
    pub scope_id: String,
}

#[derive(Debug, Clone)]
pub struct BackupSourceSpec {
    pub archive_prefix: String,
    pub source_path: PathBuf,
    pub is_dir: bool,
}

#[derive(Debug, Clone)]
pub struct RestoreTargetSpec {
    pub archive_prefix: String,
    pub target_path: PathBuf,
    pub is_dir: bool,
}

fn validate_safe_relative_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("[CRITICAL] 快照清单包含空相对路径".to_string());
    }
    let rel = Path::new(trimmed);
    let mut clean = PathBuf::new();
    for component in rel.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("[CRITICAL] 快照清单存在非法越界路径 \"{trimmed}\""));
            }
        }
    }
    if clean.as_os_str().is_empty() {
        return Err("[CRITICAL] 快照清单相对路径解析为空".to_string());
    }
    Ok(clean)
}

fn collect_files_recursive(
    root_dir: &Path,
    current_dir: &Path,
    archive_prefix: &str,
    out: &mut Vec<(String, PathBuf)>,
) -> Result<(), String> {
    if !current_dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(current_dir)
        .map_err(|err| format!("读取待备份目录失败 {}: {err}", current_dir.display()))?
    {
        let entry = entry.map_err(|err| format!("读取目录项失败: {err}"))?;
        let file_type = entry
            .file_type()
            .map_err(|err| format!("识别目录项类型失败: {err}"))?;
        let path = entry.path();
        if file_type.is_dir() {
            collect_files_recursive(root_dir, &path, archive_prefix, out)?;
        } else if file_type.is_file() {
            let rel = path
                .strip_prefix(root_dir)
                .map_err(|err| format!("计算备份相对路径失败: {err}"))?;
            let rel_posix = rel
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/");
            let archive_rel = format!("{archive_prefix}/{rel_posix}");
            out.push((archive_rel, path));
        }
    }
    Ok(())
}

/// Create a verified filesystem snapshot with per-file SHA-256 checksums inside `dest_dir`.
pub fn create_data_snapshot_from_sources(
    sources: &[BackupSourceSpec],
    dest_dir: &Path,
    scope_id: &str,
    app_version: &str,
    created_at_ms: &str,
) -> Result<DataSnapshotSummary, String> {
    if dest_dir.exists()
        && fs::read_dir(dest_dir)
            .map_err(|e| e.to_string())?
            .next()
            .is_some()
    {
        return Err(format!(
            "[CRITICAL] 目标快照目录已存在且非空: {}",
            dest_dir.display()
        ));
    }

    let mut pairs: Vec<(String, PathBuf)> = Vec::new();
    for spec in sources {
        if !spec.source_path.exists() {
            continue;
        }
        if spec.is_dir {
            collect_files_recursive(
                &spec.source_path,
                &spec.source_path,
                &spec.archive_prefix,
                &mut pairs,
            )?;
        } else if spec.source_path.is_file() {
            pairs.push((spec.archive_prefix.clone(), spec.source_path.clone()));
        }
    }
    pairs.sort_by(|a, b| a.0.cmp(&b.0));

    let parent_dir = dest_dir
        .parent()
        .ok_or_else(|| "无法解析快照上级目录".to_string())?;
    fs::create_dir_all(parent_dir)
        .map_err(|err| format!("创建备份根目录失败 {}: {err}", parent_dir.display()))?;
    let staging_name = format!(".tmp-snapshot-{}-{}", created_at_ms, std::process::id());
    let staging_dir = parent_dir.join(staging_name);
    if staging_dir.exists() {
        let _ = fs::remove_dir_all(&staging_dir);
    }
    fs::create_dir_all(&staging_dir)
        .map_err(|err| format!("创建临时快照目录失败 {}: {err}", staging_dir.display()))?;

    let build_res: Result<SnapshotManifest, String> = (|| {
        let mut entries: Vec<SnapshotFileEntry> = Vec::with_capacity(pairs.len());
        let mut seen_rel = HashSet::new();
        let mut total_bytes: u64 = 0;

        for (rel_posix, src_path) in &pairs {
            let safe_rel = validate_safe_relative_path(rel_posix)?;
            if !seen_rel.insert(rel_posix.clone()) {
                return Err(format!("[CRITICAL] 备份源路径重复: {rel_posix}"));
            }
            let bytes = fs::read(src_path)
                .map_err(|err| format!("读取待备份文件失败 {}: {err}", src_path.display()))?;
            let sha256 = compute_sha256_hex(&bytes)?;
            let dst_file = staging_dir.join(&safe_rel);
            if let Some(parent) = dst_file.parent() {
                fs::create_dir_all(parent)
                    .map_err(|err| format!("创建快照子目录失败 {}: {err}", parent.display()))?;
            }
            fs::write(&dst_file, &bytes)
                .map_err(|err| format!("写入快照文件失败 {}: {err}", dst_file.display()))?;
            let size = u64::try_from(bytes.len()).map_err(|_| "文件体积溢出".to_string())?;
            total_bytes = total_bytes.saturating_add(size);
            entries.push(SnapshotFileEntry {
                relative_path: rel_posix.clone(),
                bytes: size,
                sha256,
            });
        }

        let manifest = SnapshotManifest {
            version: SNAPSHOT_VERSION,
            created_at_ms: created_at_ms.to_string(),
            app_version: app_version.to_string(),
            scope_id: scope_id.to_string(),
            file_count: entries.len(),
            total_bytes,
            files: entries,
        };
        atomic_write_json(
            &staging_dir.join(SNAPSHOT_MANIFEST_FILE),
            &manifest,
            "snapshot manifest",
        )?;
        Ok(manifest)
    })();

    let manifest = match build_res {
        Ok(m) => m,
        Err(err) => {
            let _ = fs::remove_dir_all(&staging_dir);
            return Err(err);
        }
    };

    if dest_dir.exists() {
        let _ = fs::remove_dir(dest_dir);
    }
    if let Err(err) = fs::rename(&staging_dir, dest_dir) {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(format!("提交快照目录失败 {}: {err}", dest_dir.display()));
    }

    Ok(summary_from_manifest(dest_dir, &manifest))
}

fn summary_from_manifest(snapshot_dir: &Path, manifest: &SnapshotManifest) -> DataSnapshotSummary {
    let folder_name = snapshot_dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    DataSnapshotSummary {
        snapshot_dir: snapshot_dir.to_string_lossy().into_owned(),
        folder_name,
        created_at_ms: manifest.created_at_ms.clone(),
        app_version: manifest.app_version.clone(),
        scope_id: manifest.scope_id.clone(),
        file_count: manifest.file_count,
        total_bytes: manifest.total_bytes,
        corrupt_error: None,
    }
}

fn read_snapshot_manifest(snapshot_dir: &Path) -> Result<SnapshotManifest, String> {
    let manifest_path = snapshot_dir.join(SNAPSHOT_MANIFEST_FILE);
    if !manifest_path.is_file() {
        return Err(format!(
            "[CRITICAL] 快照缺少校验清单 {SNAPSHOT_MANIFEST_FILE}: {}",
            snapshot_dir.display()
        ));
    }
    let raw = fs::read_to_string(&manifest_path)
        .map_err(|err| format!("读取快照校验清单失败 {}: {err}", manifest_path.display()))?;
    let manifest: SnapshotManifest = serde_json::from_str(&raw).map_err(|err| {
        format!(
            "[CRITICAL] 快照校验清单损坏 {}: {err}",
            manifest_path.display()
        )
    })?;
    if manifest.version != SNAPSHOT_VERSION {
        return Err(format!(
            "[CRITICAL] 不支持的快照版本: {} (期望 {})",
            manifest.version, SNAPSHOT_VERSION
        ));
    }
    Ok(manifest)
}

/// Verify every file listed in `snapshot-manifest.json` against exact byte size and SHA-256 digest.
pub fn verify_data_snapshot_dir(snapshot_dir: &Path) -> Result<SnapshotVerificationReport, String> {
    if !snapshot_dir.is_dir() {
        return Err(format!(
            "[CRITICAL] 快照目录不存在: {}",
            snapshot_dir.display()
        ));
    }
    let manifest = read_snapshot_manifest(snapshot_dir)?;
    if manifest.file_count != manifest.files.len() {
        return Err(format!(
            "[CRITICAL] 快照文件数量与清单不一致: 清单声明 {}，实际条目 {}",
            manifest.file_count,
            manifest.files.len()
        ));
    }

    let mut actual_total_bytes: u64 = 0;
    for entry in &manifest.files {
        let safe_rel = validate_safe_relative_path(&entry.relative_path)?;
        let file_path = snapshot_dir.join(&safe_rel);
        if !file_path.is_file() {
            return Err(format!(
                "[CRITICAL] 快照缺失文件 {}: {}",
                entry.relative_path,
                file_path.display()
            ));
        }
        let bytes = fs::read(&file_path)
            .map_err(|err| format!("读取快照文件失败 {}: {err}", file_path.display()))?;
        let actual_size = u64::try_from(bytes.len()).map_err(|_| "文件体积溢出".to_string())?;
        if actual_size != entry.bytes {
            return Err(format!(
                "[CRITICAL] 快照校验失败（大小不一致）{}: 期望 {} 字节，实际 {} 字节",
                entry.relative_path, entry.bytes, actual_size
            ));
        }
        let actual_sha = compute_sha256_hex(&bytes)?;
        if actual_sha != entry.sha256 {
            return Err(format!(
                "[CRITICAL] 快照校验失败（SHA-256 不匹配，可能已损坏或被篡改）{}",
                entry.relative_path
            ));
        }
        actual_total_bytes = actual_total_bytes.saturating_add(actual_size);
    }

    if actual_total_bytes != manifest.total_bytes {
        return Err(format!(
            "[CRITICAL] 快照总字节数不一致: 期望 {}，实际 {}",
            manifest.total_bytes, actual_total_bytes
        ));
    }

    Ok(SnapshotVerificationReport {
        snapshot_dir: snapshot_dir.to_string_lossy().into_owned(),
        scope_id: manifest.scope_id,
        verified_files: manifest.files.len(),
        total_bytes: actual_total_bytes,
        valid: true,
    })
}

/// Verify snapshot, optionally back up current state, and restore every target atomically.
pub fn restore_data_snapshot_dir(
    snapshot_dir: &Path,
    targets: &[RestoreTargetSpec],
    pre_restore_backup_dir: Option<&Path>,
    current_scope_id: &str,
    app_version: &str,
    created_at_ms: &str,
) -> Result<DataRestoreSummary, String> {
    let report = verify_data_snapshot_dir(snapshot_dir)?;
    let manifest = read_snapshot_manifest(snapshot_dir)?;
    if manifest.scope_id != current_scope_id {
        return Err(format!(
            "[CRITICAL] 快照作用域不匹配：快照属于 \"{}\"，当前处于 \"{}\"，请先切换到对应账号/工作区再恢复",
            manifest.scope_id, current_scope_id
        ));
    }

    let mut pre_restore_path_out: Option<String> = None;
    if let Some(backup_dir) = pre_restore_backup_dir {
        let sources: Vec<BackupSourceSpec> = targets
            .iter()
            .map(|t| BackupSourceSpec {
                archive_prefix: t.archive_prefix.clone(),
                source_path: t.target_path.clone(),
                is_dir: t.is_dir,
            })
            .collect();
        let summary = create_data_snapshot_from_sources(
            &sources,
            backup_dir,
            current_scope_id,
            app_version,
            created_at_ms,
        )?;
        pre_restore_path_out = Some(summary.snapshot_dir);
    }

    let mut restored_files: usize = 0;
    for target in targets {
        let src_in_snapshot = snapshot_dir.join(&target.archive_prefix);
        if target.is_dir {
            restored_files += restore_directory_atomically(
                src_in_snapshot
                    .is_dir()
                    .then_some(src_in_snapshot.as_path()),
                &target.target_path,
                created_at_ms,
            )?;
        } else if src_in_snapshot.is_file() {
            let content = fs::read(&src_in_snapshot).map_err(|err| {
                format!("读取快照恢复文件失败 {}: {err}", src_in_snapshot.display())
            })?;
            if let Some(parent) = target.target_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|err| format!("创建恢复目标目录失败 {}: {err}", parent.display()))?;
            }
            let tmp_name = format!(
                ".{}.restore-{}-{}",
                target
                    .target_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("file"),
                created_at_ms,
                std::process::id()
            );
            let tmp_path = target.target_path.with_file_name(tmp_name);
            fs::write(&tmp_path, &content)
                .map_err(|err| format!("写入恢复临时文件失败 {}: {err}", tmp_path.display()))?;
            if let Err(err) = fs::rename(&tmp_path, &target.target_path) {
                let _ = fs::remove_file(&tmp_path);
                return Err(format!(
                    "提交恢复目标文件失败 {}: {err}",
                    target.target_path.display()
                ));
            }
            restored_files += 1;
        } else if target.target_path.exists() {
            fs::remove_file(&target.target_path).map_err(|err| {
                format!(
                    "移除快照中不存在的旧文件失败 {}: {err}",
                    target.target_path.display()
                )
            })?;
        }
    }

    Ok(DataRestoreSummary {
        snapshot_dir: report.snapshot_dir,
        restored_files,
        pre_restore_snapshot_dir: pre_restore_path_out,
        scope_id: manifest.scope_id,
    })
}

fn restore_directory_atomically(
    src_in_snapshot: Option<&Path>,
    target_path: &Path,
    created_at_ms: &str,
) -> Result<usize, String> {
    let seq = SNAPSHOT_FOLDER_SEQ.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let parent_dir = target_path
        .parent()
        .ok_or_else(|| format!("无法解析恢复目录父路径 {}", target_path.display()))?;
    fs::create_dir_all(parent_dir)
        .map_err(|err| format!("创建恢复上级目录失败 {}: {err}", parent_dir.display()))?;
    let base_name = target_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("dir");

    let mut staged_count = 0usize;
    let staged_dir = match src_in_snapshot {
        Some(src) => {
            let dir = parent_dir.join(format!(
                ".{base_name}.restore-stage-{created_at_ms}-{pid}-{seq}"
            ));
            if dir.exists() {
                let _ = fs::remove_dir_all(&dir);
            }
            match copy_dir_exact(src, &dir) {
                Ok(n) => {
                    staged_count = n;
                    Some(dir)
                }
                Err(err) => {
                    let _ = fs::remove_dir_all(&dir);
                    return Err(err);
                }
            }
        }
        None => None,
    };

    let backup_old_dir = if target_path.exists() {
        let old_dir = parent_dir.join(format!(
            ".{base_name}.restore-old-{created_at_ms}-{pid}-{seq}"
        ));
        if old_dir.exists() {
            let _ = fs::remove_dir_all(&old_dir);
        }
        if let Err(err) = fs::rename(target_path, &old_dir) {
            if let Some(ref staged) = staged_dir {
                let _ = fs::remove_dir_all(staged);
            }
            return Err(format!(
                "暂存原目录以准备恢复失败 {}: {err}",
                target_path.display()
            ));
        }
        Some(old_dir)
    } else {
        None
    };

    if let Some(staged) = staged_dir {
        if let Err(err) = fs::rename(&staged, target_path) {
            let _ = fs::remove_dir_all(&staged);
            if let Some(ref old_dir) = backup_old_dir {
                let _ = fs::rename(old_dir, target_path);
            }
            return Err(format!("提交恢复目录失败 {}: {err}", target_path.display()));
        }
    }

    if let Some(old_dir) = backup_old_dir {
        let _ = fs::remove_dir_all(old_dir);
    }
    Ok(staged_count)
}

fn copy_dir_exact(src: &Path, dst: &Path) -> Result<usize, String> {
    fs::create_dir_all(dst).map_err(|err| format!("创建恢复目录失败 {}: {err}", dst.display()))?;
    let mut count = 0usize;
    for entry in
        fs::read_dir(src).map_err(|err| format!("读取快照目录失败 {}: {err}", src.display()))?
    {
        let entry = entry.map_err(|err| format!("读取快照目录项失败: {err}"))?;
        let file_type = entry
            .file_type()
            .map_err(|err| format!("识别快照文件类型失败: {err}"))?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            count += copy_dir_exact(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &target)
                .map_err(|err| format!("复制恢复文件失败 {}: {err}", target.display()))?;
            count += 1;
        }
    }
    Ok(count)
}

pub fn list_data_snapshots_in_dir(backups_root: &Path) -> Result<Vec<DataSnapshotSummary>, String> {
    if !backups_root.exists() {
        return Ok(Vec::new());
    }
    let mut items = Vec::new();
    for entry in fs::read_dir(backups_root)
        .map_err(|err| format!("读取备份根目录失败 {}: {err}", backups_root.display()))?
    {
        let entry = entry.map_err(|err| format!("读取备份目录项失败: {err}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let manifest_path = path.join(SNAPSHOT_MANIFEST_FILE);
        if !manifest_path.is_file() {
            continue;
        }
        match read_snapshot_manifest(&path) {
            Ok(manifest) => items.push(summary_from_manifest(&path, &manifest)),
            Err(err) => {
                eprintln!(
                    "[CRITICAL] Corrupt snapshot manifest skipped with warning at {}: {err}",
                    path.display()
                );
                items.push(DataSnapshotSummary {
                    snapshot_dir: path.to_string_lossy().into_owned(),
                    folder_name: name,
                    created_at_ms: "0".to_string(),
                    app_version: "?".to_string(),
                    scope_id: "unknown".to_string(),
                    file_count: 0,
                    total_bytes: 0,
                    corrupt_error: Some(err),
                });
            }
        }
    }
    items.sort_by(|a, b| {
        let num_a = a.created_at_ms.parse::<u128>().unwrap_or(0);
        let num_b = b.created_at_ms.parse::<u128>().unwrap_or(0);
        num_b
            .cmp(&num_a)
            .then_with(|| b.folder_name.cmp(&a.folder_name))
    });
    Ok(items)
}

fn backups_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("backups"))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

fn active_scope_id(app: &AppHandle) -> Result<String, String> {
    let session = crate::accounts::session::load_session(app)?;
    Ok(match session.active_user_id {
        Some(uid) => format!("{uid}:{}", session.workspace_id),
        None => "local".to_string(),
    })
}

fn active_backup_specs(
    app: &AppHandle,
) -> Result<(String, Vec<BackupSourceSpec>, Vec<RestoreTargetSpec>), String> {
    let scope_id = active_scope_id(app)?;
    let todos_root = crate::accounts::account_todos_root(app)?;
    let notes_root = crate::accounts::account_quick_notes_root(app)?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data directory: {err}"))?;

    let mut pairs: Vec<(String, PathBuf, bool)> = vec![
        ("todos".to_string(), todos_root, true),
        (
            "quick-notes.json".to_string(),
            notes_root.join("quick-notes.json"),
            false,
        ),
        (
            "sticky-notes.json".to_string(),
            notes_root.join("sticky-notes.json"),
            false,
        ),
        (
            "hotkeys.json".to_string(),
            app_data_dir.join("hotkeys.json"),
            false,
        ),
    ];

    let session = crate::accounts::session::load_session(app)?;
    if let Some(uid) = session.active_user_id.as_deref() {
        if let Some(sync_root) = crate::accounts::account_sync_root(app)? {
            pairs.push((
                "sync-outbox.json".to_string(),
                sync_root.join("sync-outbox.json"),
                false,
            ));
        }
        let account_dir = crate::accounts::session::account_workspace_dir(app, uid)?;
        pairs.push((
            "sync-profile.json".to_string(),
            account_dir.join("sync-profile.json"),
            false,
        ));
    }

    let sources = pairs
        .iter()
        .map(|(prefix, path, is_dir)| BackupSourceSpec {
            archive_prefix: prefix.clone(),
            source_path: path.clone(),
            is_dir: *is_dir,
        })
        .collect();
    let targets = pairs
        .into_iter()
        .map(|(prefix, path, is_dir)| RestoreTargetSpec {
            archive_prefix: prefix,
            target_path: path,
            is_dir,
        })
        .collect();

    Ok((scope_id, sources, targets))
}

fn with_all_store_locks<T>(
    app: &AppHandle,
    clear_cache: bool,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    with_todo_store_lock(app, |todo_store| {
        let res = with_quick_notes_store_lock(app, || {
            with_sticky_notes_store_lock(app, || with_outbox_lock(app, operation))
        });
        if clear_cache && res.is_ok() {
            clear_todo_content_cache(todo_store);
        }
        res
    })
}

#[tauri::command]
pub async fn backup_list_snapshots(app: AppHandle) -> Result<Vec<DataSnapshotSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = backups_root_dir(&app)?;
        list_data_snapshots_in_dir(&root)
    })
    .await
    .map_err(|err| format!("backup list task failed: {err}"))?
}

#[tauri::command]
pub async fn backup_create_snapshot(
    app: AppHandle,
    target_dir: Option<String>,
) -> Result<DataSnapshotSummary, String> {
    let sync_lock = app.state::<crate::sync::SyncExecutionLockState>();
    let _sync_guard = sync_lock.0.lock().await;
    let task_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let now_ms = crate::timestamp_string();
        let app_version = task_app.package_info().version.to_string();
        let dest_dir = match target_dir
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            Some(custom) => PathBuf::from(custom),
            None => backups_root_dir(&task_app)?
                .join(next_snapshot_folder_name(SNAPSHOT_DIR_PREFIX, &now_ms)),
        };
        with_all_store_locks(&task_app, false, || {
            let (scope_id, sources, _) = active_backup_specs(&task_app)?;
            create_data_snapshot_from_sources(&sources, &dest_dir, &scope_id, &app_version, &now_ms)
        })
    })
    .await
    .map_err(|err| format!("backup create task failed: {err}"))?
}

#[tauri::command]
pub async fn backup_verify_snapshot(
    snapshot_dir: String,
) -> Result<SnapshotVerificationReport, String> {
    let trimmed = snapshot_dir.trim().to_string();
    if trimmed.is_empty() {
        return Err("[CRITICAL] 未提供待校验的快照目录路径".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || verify_data_snapshot_dir(Path::new(&trimmed)))
        .await
        .map_err(|err| format!("backup verify task failed: {err}"))?
}

#[tauri::command]
pub async fn backup_restore_snapshot(
    app: AppHandle,
    snapshot_dir: String,
) -> Result<DataRestoreSummary, String> {
    let trimmed = snapshot_dir.trim().to_string();
    if trimmed.is_empty() {
        return Err("[CRITICAL] 未提供待恢复的快照目录路径".to_string());
    }
    let sync_lock = app.state::<crate::sync::SyncExecutionLockState>();
    let _sync_guard = sync_lock.0.lock().await;
    let task_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let now_ms = crate::timestamp_string();
        let app_version = task_app.package_info().version.to_string();
        let pre_restore_dir = backups_root_dir(&task_app)?
            .join(next_snapshot_folder_name(PRE_RESTORE_PREFIX, &now_ms));
        let summary = with_all_store_locks(&task_app, true, || {
            let (scope_id, _, targets) = active_backup_specs(&task_app)?;
            restore_data_snapshot_dir(
                Path::new(&trimmed),
                &targets,
                Some(&pre_restore_dir),
                &scope_id,
                &app_version,
                &now_ms,
            )
        })?;

        if let Some(refreshed_session) =
            crate::accounts::session::reload_active_profile_into_session(&task_app)?
        {
            crate::accounts::commands::emit_account_workspace_refreshed(
                &task_app,
                &refreshed_session,
            )?;
        }
        crate::todos::commands::refresh_and_emit_active_todo_state(&task_app)?;
        crate::quick_notes::refresh_and_emit_active_quick_notes_state(&task_app)?;
        crate::sticky_notes::reload_sticky_notes_for_active_account(&task_app);
        Ok(summary)
    })
    .await
    .map_err(|err| format!("backup restore task failed: {err}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

    fn temp_workspace_dir(label: &str) -> PathBuf {
        let seq = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "tidydesk-backup-test-{label}-{}-{}",
            std::process::id(),
            seq
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn snapshot_create_verify_and_tamper_detection_fail_loudly() {
        let root = temp_workspace_dir("verify");
        let todos_dir = root.join("live").join("todos");
        fs::create_dir_all(todos_dir.join("cards")).unwrap();
        fs::write(
            todos_dir.join("boards.json"),
            r#"{"version":1,"cards":[{"id":"c1"}]}"#,
        )
        .unwrap();
        fs::write(todos_dir.join("cards").join("c1.md"), "重要正文内容").unwrap();
        let notes_file = root.join("live").join("quick-notes.json");
        fs::write(&notes_file, r#"{"version":2,"notes":[{"id":"n1"}]}"#).unwrap();

        let snap_dir = root.join("backups").join("snapshot-100");
        let sources = vec![
            BackupSourceSpec {
                archive_prefix: "todos".to_string(),
                source_path: todos_dir,
                is_dir: true,
            },
            BackupSourceSpec {
                archive_prefix: "quick-notes.json".to_string(),
                source_path: notes_file,
                is_dir: false,
            },
        ];

        let summary =
            create_data_snapshot_from_sources(&sources, &snap_dir, "local", "0.0.4", "100")
                .unwrap();
        assert_eq!(summary.file_count, 3);
        assert!(summary.total_bytes > 0);

        let report = verify_data_snapshot_dir(&snap_dir).unwrap();
        assert!(report.valid);
        assert_eq!(report.verified_files, 3);

        // Tamper with backed up markdown body (keeping same byte length!)
        fs::write(snap_dir.join("todos/cards/c1.md"), "篡改正文内容").unwrap();
        let err = verify_data_snapshot_dir(&snap_dir).unwrap_err();
        assert!(err.contains("SHA-256"), "unexpected error: {err}");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restore_backs_up_current_state_and_rejects_cross_scope_restore() {
        let root = temp_workspace_dir("restore");
        let todos_dir = root.join("live").join("todos");
        fs::create_dir_all(&todos_dir).unwrap();
        fs::write(todos_dir.join("boards.json"), r#"{"cards":["v1"]}"#).unwrap();
        let notes_file = root.join("live").join("quick-notes.json");
        fs::write(&notes_file, r#"{"notes":["n1"]}"#).unwrap();

        let snap_dir = root.join("backups").join("snapshot-100");
        let sources = vec![
            BackupSourceSpec {
                archive_prefix: "todos".to_string(),
                source_path: todos_dir.clone(),
                is_dir: true,
            },
            BackupSourceSpec {
                archive_prefix: "quick-notes.json".to_string(),
                source_path: notes_file.clone(),
                is_dir: false,
            },
        ];
        create_data_snapshot_from_sources(&sources, &snap_dir, "local", "0.0.4", "100").unwrap();

        // Simulate data corruption or accidental edit in live workspace
        fs::write(todos_dir.join("boards.json"), r#"{"cards":["broken"]}"#).unwrap();
        fs::write(&notes_file, r#"{"notes":[]}"#).unwrap();

        let targets = vec![
            RestoreTargetSpec {
                archive_prefix: "todos".to_string(),
                target_path: todos_dir.clone(),
                is_dir: true,
            },
            RestoreTargetSpec {
                archive_prefix: "quick-notes.json".to_string(),
                target_path: notes_file.clone(),
                is_dir: false,
            },
        ];

        // Cross-scope restore must fail loudly without modifying live files
        let scope_err =
            restore_data_snapshot_dir(&snap_dir, &targets, None, "alice:default", "0.0.4", "200")
                .unwrap_err();
        assert!(
            scope_err.contains("作用域不匹配"),
            "unexpected error: {scope_err}"
        );
        assert_eq!(
            fs::read_to_string(todos_dir.join("boards.json")).unwrap(),
            r#"{"cards":["broken"]}"#
        );

        // Matching scope restore creates pre-restore safety snapshot and restores v1 cleanly
        let pre_restore_dir = root.join("backups").join("pre-restore-200");
        let restored = restore_data_snapshot_dir(
            &snap_dir,
            &targets,
            Some(&pre_restore_dir),
            "local",
            "0.0.4",
            "200",
        )
        .unwrap();
        assert_eq!(restored.restored_files, 2);
        assert!(restored.pre_restore_snapshot_dir.is_some());
        assert_eq!(
            fs::read_to_string(todos_dir.join("boards.json")).unwrap(),
            r#"{"cards":["v1"]}"#
        );
        assert_eq!(
            fs::read_to_string(&notes_file).unwrap(),
            r#"{"notes":["n1"]}"#
        );
        assert_eq!(
            fs::read_to_string(pre_restore_dir.join("todos/boards.json")).unwrap(),
            r#"{"cards":["broken"]}"#
        );

        let listed = list_data_snapshots_in_dir(&root.join("backups")).unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].created_at_ms, "200");
        assert_eq!(listed[1].created_at_ms, "100");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn verify_rejects_parent_traversal_in_manifest() {
        let root = temp_workspace_dir("traversal");
        let snap_dir = root.join("snapshot-evil");
        fs::create_dir_all(&snap_dir).unwrap();
        let evil_manifest = SnapshotManifest {
            version: SNAPSHOT_VERSION,
            created_at_ms: "100".to_string(),
            app_version: "0.0.4".to_string(),
            scope_id: "local".to_string(),
            file_count: 1,
            total_bytes: 4,
            files: vec![SnapshotFileEntry {
                relative_path: "../escape.json".to_string(),
                bytes: 4,
                sha256: "0".repeat(64),
            }],
        };
        atomic_write_json(
            &snap_dir.join(SNAPSHOT_MANIFEST_FILE),
            &evil_manifest,
            "evil",
        )
        .unwrap();

        let err = verify_data_snapshot_dir(&snap_dir).unwrap_err();
        assert!(err.contains("越界路径"), "unexpected error: {err}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn list_snapshots_sorts_numerically_and_surfaces_corrupt_entries_without_blocking() {
        let root = temp_workspace_dir("list-corrupt");
        let live_notes = root.join("live-notes.json");
        fs::write(&live_notes, r#"{"notes":[]}"#).unwrap();

        let src = vec![BackupSourceSpec {
            archive_prefix: "quick-notes.json".to_string(),
            source_path: live_notes,
            is_dir: false,
        }];
        let backups_dir = root.join("backups");
        create_data_snapshot_from_sources(
            &src,
            &backups_dir.join("snapshot-999"),
            "local",
            "0.0.4",
            "999",
        )
        .unwrap();
        create_data_snapshot_from_sources(
            &src,
            &backups_dir.join("snapshot-1000"),
            "local",
            "0.0.4",
            "1000",
        )
        .unwrap();

        // Inject a corrupted snapshot folder alongside healthy snapshots
        let corrupt_dir = backups_dir.join("snapshot-bad");
        fs::create_dir_all(&corrupt_dir).unwrap();
        fs::write(corrupt_dir.join(SNAPSHOT_MANIFEST_FILE), "{corrupt json").unwrap();

        let listed = list_data_snapshots_in_dir(&backups_dir).unwrap();
        assert_eq!(listed.len(), 3);
        assert_eq!(listed[0].created_at_ms, "1000");
        assert!(listed[0].corrupt_error.is_none());
        assert_eq!(listed[1].created_at_ms, "999");
        assert!(listed[1].corrupt_error.is_none());
        assert_eq!(listed[2].folder_name, "snapshot-bad");
        assert!(listed[2].corrupt_error.is_some());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restore_directory_cleans_post_snapshot_leftover_files_and_staging_temps() {
        let root = temp_workspace_dir("dir-clean");
        let todos_dir = root.join("live").join("todos");
        fs::create_dir_all(todos_dir.join("cards")).unwrap();
        fs::write(todos_dir.join("boards.json"), r#"{"v":1}"#).unwrap();

        let snap_dir = root.join("backups").join("snapshot-100");
        create_data_snapshot_from_sources(
            &[BackupSourceSpec {
                archive_prefix: "todos".to_string(),
                source_path: todos_dir.clone(),
                is_dir: true,
            }],
            &snap_dir,
            "local",
            "0.0.4",
            "100",
        )
        .unwrap();

        // Add an extra leftover file in live dir after snapshot
        fs::write(todos_dir.join("cards").join("extra.md"), "post-snapshot").unwrap();
        let summary = restore_data_snapshot_dir(
            &snap_dir,
            &[RestoreTargetSpec {
                archive_prefix: "todos".to_string(),
                target_path: todos_dir.clone(),
                is_dir: true,
            }],
            None,
            "local",
            "0.0.4",
            "200",
        )
        .unwrap();

        assert_eq!(summary.restored_files, 1);
        assert!(!todos_dir.join("cards").join("extra.md").exists());
        // No staging/old directories left in parent
        let temp_leftovers = fs::read_dir(root.join("live"))
            .unwrap()
            .filter_map(Result::ok)
            .any(|e| e.file_name().to_string_lossy().contains(".restore-"));
        assert!(!temp_leftovers);

        let _ = fs::remove_dir_all(&root);
    }
}
