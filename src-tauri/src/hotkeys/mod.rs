mod accelerator;
pub mod commands;
mod runtime;
mod store;

pub use commands::{
    hotkeys_get_settings, hotkeys_reset_defaults, hotkeys_update_binding, hotkeys_validate_binding,
};
pub use runtime::{register_configured_hotkeys, HotkeyRuntimeState};
