use super::model::{StickerRecord, StickerStateFile};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Debug, Default)]
pub struct StickerStoreState(pub Mutex<()>);

pub fn ensure_storage(app: &AppHandle) -> Result<(), String> {
    with_sticker_store_lock(app, || ensure_storage_unlocked(app))
}

pub fn with_sticker_store_lock<T>(
    app: &AppHandle,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<StickerStoreState>();
    let _guard = state
        .0
        .lock()
        .map_err(|_| "failed to lock sticker store".to_string())?;
    operation()
}

pub fn mutate_sticker_state<T>(
    app: &AppHandle,
    operation: impl FnOnce(&mut StickerStateFile) -> Result<T, String>,
) -> Result<T, String> {
    with_sticker_store_lock(app, || {
        ensure_storage_unlocked(app)?;
        let mut state = read_sticker_state_unlocked(app)?;
        let result = operation(&mut state)?;
        write_sticker_state_unlocked(app, &state)?;
        Ok(result)
    })
}

pub fn ensure_storage_unlocked(app: &AppHandle) -> Result<(), String> {
    fs::create_dir_all(images_root(app)?)
        .map_err(|err| format!("failed to create sticker image root: {err}"))?;
    let state_path = sticker_state_path(app)?;
    if !state_path.exists() {
        write_sticker_state_unlocked(
            app,
            &StickerStateFile {
                stickers: Vec::new(),
            },
        )?;
    }
    Ok(())
}

pub fn upsert_sticker(state: &mut StickerStateFile, sticker: StickerRecord) {
    if let Some(existing) = state.stickers.iter_mut().find(|item| item.id == sticker.id) {
        *existing = sticker;
    } else {
        state.stickers.push(sticker);
    }
}

pub fn read_sticker_state(app: &AppHandle) -> Result<StickerStateFile, String> {
    with_sticker_store_lock(app, || {
        ensure_storage_unlocked(app)?;
        read_sticker_state_unlocked(app)
    })
}

fn read_sticker_state_unlocked(app: &AppHandle) -> Result<StickerStateFile, String> {
    let path = sticker_state_path(app)?;
    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(state) => Ok(state),
            Err(err) => {
                let backup_path = crate::persistence::backup_corrupt_file(&path, "sticker state")?;
                eprintln!(
                    "[TIDYDESK] Backed up corrupt sticker state to {}: {err}",
                    backup_path.display()
                );
                Ok(StickerStateFile {
                    stickers: Vec::new(),
                })
            }
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(StickerStateFile {
            stickers: Vec::new(),
        }),
        Err(err) => Err(format!("failed to read sticker state: {err}")),
    }
}

fn write_sticker_state_unlocked(app: &AppHandle, state: &StickerStateFile) -> Result<(), String> {
    ensure_storage_dirs(app)?;
    let path = sticker_state_path(app)?;
    crate::persistence::atomic_write_json_fast(&path, state, "sticker state")
}

fn ensure_storage_dirs(app: &AppHandle) -> Result<(), String> {
    fs::create_dir_all(sticker_root(app)?)
        .map_err(|err| format!("failed to create sticker root: {err}"))?;
    fs::create_dir_all(images_root(app)?)
        .map_err(|err| format!("failed to create sticker images root: {err}"))?;
    Ok(())
}

fn sticker_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("stickers"))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

pub fn images_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(sticker_root(app)?.join("images"))
}

fn sticker_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(sticker_root(app)?.join("stickers.json"))
}

pub fn pictures_dir() -> PathBuf {
    std::env::var("USERPROFILE")
        .map(|profile| Path::new(&profile).join("Pictures"))
        .unwrap_or_else(|_| PathBuf::from("."))
}
