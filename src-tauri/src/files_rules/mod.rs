mod classify;
mod names;
mod shell_open;
mod storage;
mod windows_shortcuts;

pub use classify::{category_by_extension, file_extension, modified_at, path_identity};
pub use names::{
    desktop_path, drawer_entry_rename_target, next_available_path, resolve_drawer_entry_path,
    resolve_drawer_path, safe_drawer_entry_name, safe_drawer_name,
};
pub use shell_open::open_path_with_shell;
pub use storage::{
    create_drawer_shortcut, file_storage_root, is_protected_desktop_item, move_path_with_fallback,
};
pub use windows_shortcuts::{create_shortcut_link, resolve_shortcut_target, write_shortcut_link};
