use super::bounds::{apply_window_bounds, drawer_window_bounds, handle_window_bounds};
use super::state::{next_animation_generation, shell_snapshot, update_shell_state, ShellState};
use super::{DRAWER_WINDOW_LABEL, HANDLE_WINDOW_LABEL};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use url::Url;

const DRAWER_HIDE_DELAY_MS: u64 = 160;

pub fn set_handle_always_on_top(app: &AppHandle, always_on_top: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
        window
            .set_always_on_top(always_on_top)
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

pub fn apply_drawer_state(
    app: &AppHandle,
    shell: &tauri::State<'_, ShellState>,
    expanded: bool,
) -> Result<(), String> {
    let previous = shell_snapshot(shell)?;
    let handle_to = handle_window_bounds(app, expanded)?;
    let animation_generation = next_animation_generation(shell);

    if expanded {
        hide_module_windows(app)?;
        ensure_drawer_window(app)?;
        let drawer_target = drawer_window_bounds(app)?;
        let next_active_module = match previous.active_module.as_deref() {
            Some("capture") => Some("capture".to_string()),
            Some("files") => Some("files".to_string()),
            _ => Some("files".to_string()),
        };
        apply_window_bounds(app, DRAWER_WINDOW_LABEL, drawer_target)?;
        apply_window_bounds(app, HANDLE_WINDOW_LABEL, handle_to)?;
        if let Some(window) = app.get_webview_window(DRAWER_WINDOW_LABEL) {
            window.show().map_err(|err| err.to_string())?;
            window.set_focus().map_err(|err| err.to_string())?;
        }
        if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
            window.show().map_err(|err| err.to_string())?;
        }
        set_handle_always_on_top(app, false)?;
        update_shell_state(app, shell, true, next_active_module)?;
    } else {
        apply_window_bounds(app, HANDLE_WINDOW_LABEL, handle_to)?;
        if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
            window.show().map_err(|err| err.to_string())?;
        }
        set_handle_always_on_top(app, true)?;
        let active_module = previous.active_module;
        let next_module = if active_module.as_deref() == Some("files") {
            None
        } else {
            active_module
        };
        update_shell_state(app, shell, false, next_module)?;
        schedule_drawer_hide(app.clone(), animation_generation);
    }
    Ok(())
}

pub fn hide_drawer_window_now(
    app: &AppHandle,
    shell: &tauri::State<'_, ShellState>,
) -> Result<(), String> {
    next_animation_generation(shell);
    if let Some(window) = app.get_webview_window(DRAWER_WINDOW_LABEL) {
        window.hide().map_err(|err| err.to_string())?;
    }
    apply_window_bounds(app, HANDLE_WINDOW_LABEL, handle_window_bounds(app, false)?)?;
    if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
        window.show().map_err(|err| err.to_string())?;
    }
    set_handle_always_on_top(app, true)?;
    let previous = shell_snapshot(shell)?;
    let next_module = if previous.active_module.as_deref() == Some("files") {
        None
    } else {
        previous.active_module
    };
    update_shell_state(app, shell, false, next_module)
}

pub fn close_active_module(
    app: &AppHandle,
    shell: &tauri::State<'_, ShellState>,
) -> Result<(), String> {
    next_animation_generation(shell);
    let current = shell_snapshot(shell)?;
    let active_module = current.active_module.clone();
    if active_module.as_deref() == Some("files") {
        return apply_drawer_state(app, shell, false);
    }
    if let Some(module) = active_module {
        if let Some(window) = app.get_webview_window(&module) {
            window.hide().map_err(|err| err.to_string())?;
        }
    }
    apply_window_bounds(app, HANDLE_WINDOW_LABEL, handle_window_bounds(app, false)?)?;
    if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
        window.show().map_err(|err| err.to_string())?;
    }
    set_handle_always_on_top(app, true)?;
    update_shell_state(app, shell, false, None)
}

pub fn ensure_drawer_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(DRAWER_WINDOW_LABEL) {
        let needs_recreate = window
            .url()
            .map(|url| {
                let url_text = url.as_str().to_ascii_lowercase();
                url_text == "about:blank" || !url_text.contains("mode=drawer")
            })
            .unwrap_or(true);

        if !needs_recreate {
            return Ok(());
        }

        let _ = window.hide();
        window
            .destroy()
            .or_else(|_| window.close())
            .map_err(|err| err.to_string())?;
    }

    let bounds = drawer_window_bounds(app)?;
    let window =
        WebviewWindowBuilder::new(app, DRAWER_WINDOW_LABEL, webview_url_for_mode("drawer")?)
            .title("TidyDesk")
            .inner_size(bounds.width as f64, bounds.height as f64)
            .resizable(false)
            .visible(false)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .skip_taskbar(true)
            .always_on_top(false)
            .build()
            .map_err(|err| err.to_string())?;
    window
        .set_size(PhysicalSize::new(bounds.width, bounds.height))
        .map_err(|err| err.to_string())?;
    window
        .set_position(PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub fn recover_shell_windows(app: &AppHandle) -> Result<(), String> {
    let shell = app.state::<ShellState>();
    next_animation_generation(&shell);

    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.hide();
    }

    let mut snapshot = shell_snapshot(&shell)?;
    if snapshot.active_module.as_deref() == Some("todos")
        && app.get_webview_window("todos").is_none()
    {
        update_shell_state(app, &shell, false, None)?;
        snapshot = shell_snapshot(&shell)?;
    }

    if snapshot.active_module.as_deref() != Some("todos") {
        if let Some(window) = app.get_webview_window("todos") {
            let _ = window.hide();
        }
    }

    if snapshot.expanded {
        ensure_drawer_window(app)?;
        let drawer_bounds = drawer_window_bounds(app)?;
        apply_window_bounds(app, DRAWER_WINDOW_LABEL, drawer_bounds)?;
        if let Some(window) = app.get_webview_window(DRAWER_WINDOW_LABEL) {
            window.show().map_err(|err| err.to_string())?;
            if snapshot.active_module.as_deref() != Some("todos") {
                window.set_focus().map_err(|err| err.to_string())?;
            }
        }
        apply_window_bounds(app, HANDLE_WINDOW_LABEL, handle_window_bounds(app, true)?)?;
        if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
            window.show().map_err(|err| err.to_string())?;
        }
        set_handle_always_on_top(app, false)?;
    } else {
        if let Some(window) = app.get_webview_window(DRAWER_WINDOW_LABEL) {
            let _ = window.hide();
        }
        apply_window_bounds(app, HANDLE_WINDOW_LABEL, handle_window_bounds(app, false)?)?;
        if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
            window.show().map_err(|err| err.to_string())?;
            if snapshot.active_module.as_deref() != Some("todos") {
                window.set_focus().map_err(|err| err.to_string())?;
            }
        }
        set_handle_always_on_top(app, true)?;
    }

    if snapshot.active_module.as_deref() == Some("todos") {
        if let Some(window) = app.get_webview_window("todos") {
            window.show().map_err(|err| err.to_string())?;
            window.set_focus().map_err(|err| err.to_string())?;
        }
    }

    Ok(())
}

pub fn webview_url_for_mode(mode: &str) -> Result<WebviewUrl, String> {
    if cfg!(debug_assertions) {
        let url = Url::parse(&format!("http://127.0.0.1:3000/?mode={mode}"))
            .map_err(|err| err.to_string())?;
        Ok(WebviewUrl::External(url))
    } else {
        Ok(WebviewUrl::App(format!("index.html?mode={mode}").into()))
    }
}

fn hide_module_windows(app: &AppHandle) -> Result<(), String> {
    for label in ["capture"] {
        if let Some(window) = app.get_webview_window(label) {
            window.hide().map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn schedule_drawer_hide(app: AppHandle, animation_generation: u64) {
    if app.get_webview_window(DRAWER_WINDOW_LABEL).is_none() {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(DRAWER_HIDE_DELAY_MS));
        let app_lookup = app.clone();
        let _ = app.run_on_main_thread(move || {
            if app_lookup
                .state::<ShellState>()
                .animation_generation
                .load(Ordering::Relaxed)
                != animation_generation
            {
                return;
            }
            if let Some(window) = app_lookup.get_webview_window(DRAWER_WINDOW_LABEL) {
                let _ = window.hide();
            }
        });
    });
}

pub fn ensure_handle_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(HANDLE_WINDOW_LABEL).is_some() {
        return Ok(());
    }
    let bounds = handle_window_bounds(app, false)?;
    let window =
        WebviewWindowBuilder::new(app, HANDLE_WINDOW_LABEL, webview_url_for_mode("handle")?)
            .title("TidyDesk Handle")
            .inner_size(bounds.width as f64, bounds.height as f64)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .build()
            .map_err(|err| err.to_string())?;
    window
        .set_size(PhysicalSize::new(bounds.width, bounds.height))
        .map_err(|err| err.to_string())?;
    window
        .set_position(PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|err| err.to_string())?;
    Ok(())
}
