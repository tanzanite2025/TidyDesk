use super::bounds::{apply_window_bounds, drawer_window_bounds, handle_window_bounds, ShellBounds};
use super::state::{
    next_animation_generation, shell_snapshot, update_shell_state, ShellState, ShellWindowSnapshot,
};
use super::{DRAWER_WINDOW_LABEL, HANDLE_WINDOW_LABEL};
use std::sync::atomic::{AtomicIsize, Ordering};
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use url::Url;

const DRAWER_SLIDE_DURATION_MS: u64 = 200;
const DRAWER_SLIDE_FRAME_MS: u64 = 12;
const DRAWER_READY_WAIT_TIMEOUT_MS: u64 = 450;
const DRAWER_READY_POLL_MS: u64 = 10;

pub fn notify_drawer_ready(app: &AppHandle) {
    app.state::<ShellState>()
        .drawer_ready
        .store(true, Ordering::Release);
}

pub fn is_drawer_ready(app: &AppHandle) -> bool {
    app.state::<ShellState>()
        .drawer_ready
        .load(Ordering::Acquire)
}

pub fn ease_out_cubic(progress: f64) -> f64 {
    let clamped = progress.clamp(0.0, 1.0);
    1.0 - (1.0 - clamped).powi(3)
}

pub fn interpolate_x(start_x: i32, target_x: i32, progress: f64) -> i32 {
    let eased = ease_out_cubic(progress);
    (start_x as f64 + (target_x - start_x) as f64 * eased).round() as i32
}

pub fn should_sync_expanded_pair(snapshot: &ShellWindowSnapshot, focused: bool) -> bool {
    focused && snapshot.expanded
}

fn window_hwnd_key(window: &WebviewWindow) -> isize {
    #[cfg(target_os = "windows")]
    {
        window.hwnd().map(|raw| raw.0 as isize).unwrap_or(0)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        1
    }
}

fn ensure_window_focus_listener(
    app: &AppHandle,
    window: &WebviewWindow,
    slot: &AtomicIsize,
    restore_topmost_when_collapsed: bool,
) {
    let hwnd_key = window_hwnd_key(window);
    if hwnd_key == 0 {
        return;
    }
    if slot.swap(hwnd_key, Ordering::AcqRel) == hwnd_key {
        return;
    }

    let app_handle = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(true) => {
            let shell = app_handle.state::<ShellState>();
            if let Ok(snapshot) = shell_snapshot(&shell) {
                if should_sync_expanded_pair(&snapshot, true) {
                    let _ = sync_expanded_shell_z_order(&app_handle);
                } else if restore_topmost_when_collapsed {
                    let _ = set_handle_always_on_top(&app_handle, true);
                }
            }
        }
        WindowEvent::CloseRequested { api, .. } if !restore_topmost_when_collapsed => {
            api.prevent_close();
            let app_clone = app_handle.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let shell = app_clone.state::<ShellState>();
                let _ = apply_drawer_state(&app_clone, &shell, false);
            });
        }
        _ => {}
    });
}

/// Disable or re-enable DWM window show/hide transitions on Windows so instant snip captures don't ghost fading frames.
pub fn set_window_dwm_transitions_disabled(
    window: &WebviewWindow,
    disabled: bool,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::core::BOOL;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED,
        };

        let raw = window.hwnd().map_err(|err| err.to_string())?;
        let hwnd = HWND(raw.0);
        let value = BOOL::from(disabled);
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_TRANSITIONS_FORCEDISABLED,
                (&value as *const BOOL).cast::<std::ffi::c_void>(),
                std::mem::size_of::<BOOL>() as u32,
            );
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, disabled);
    }
    Ok(())
}

/// Flush pending DWM composition frames so hidden windows disappear cleanly before GDI capture.
pub fn flush_dwm_compositor() {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Graphics::Dwm::DwmFlush;
        unsafe {
            let _ = DwmFlush();
            let _ = DwmFlush();
        }
    }
}

/// Temporarily hide visible shell & tool windows before capturing a desktop snip without mutating `ShellState`,
/// allowing `recover_shell_windows` to restore the exact prior layout when snip completes or cancels.
pub fn hide_shell_windows_for_snip(app: &AppHandle) -> Result<(), String> {
    let mut hid_any = false;
    for label in [DRAWER_WINDOW_LABEL, HANDLE_WINDOW_LABEL, "todos", "capture"] {
        if let Some(window) = app.get_webview_window(label) {
            if window.is_visible().unwrap_or(true) {
                set_window_dwm_transitions_disabled(&window, true)?;
                window.hide().map_err(|err| err.to_string())?;
                hid_any = true;
            }
        }
    }
    if hid_any {
        flush_dwm_compositor();
    }
    Ok(())
}

/// Lock the expanded drawer and edge handle into a single contiguous non-topmost Z-order pair:
/// `[top of non-topmost] -> handle -> drawer`, so neither window can get buried behind other apps separately.
pub fn sync_expanded_shell_z_order(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_NOTOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        };

        let Some(handle_window) = app.get_webview_window(HANDLE_WINDOW_LABEL) else {
            return Ok(());
        };
        let Some(drawer_window) = app.get_webview_window(DRAWER_WINDOW_LABEL) else {
            return set_handle_always_on_top(app, false);
        };

        let handle_raw = handle_window.hwnd().map_err(|err| err.to_string())?;
        let drawer_raw = drawer_window.hwnd().map_err(|err| err.to_string())?;
        let handle_hwnd = HWND(handle_raw.0);
        let drawer_hwnd = HWND(drawer_raw.0);
        let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;

        unsafe {
            SetWindowPos(handle_hwnd, Some(HWND_NOTOPMOST), 0, 0, 0, 0, flags)
                .map_err(|err| format!("同步手柄非置顶层级失败: {err}"))?;
            SetWindowPos(drawer_hwnd, Some(handle_hwnd), 0, 0, 0, 0, flags)
                .map_err(|err| format!("同步抽屉与手柄相对层级失败: {err}"))?;
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        set_handle_always_on_top(app, false)
    }
}

pub fn set_handle_always_on_top(app: &AppHandle, always_on_top: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
        window
            .set_always_on_top(always_on_top)
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn current_handle_x_or(app: &AppHandle, fallback_x: i32) -> i32 {
    app.get_webview_window(HANDLE_WINDOW_LABEL)
        .and_then(|window| window.outer_position().ok().map(|pos| pos.x))
        .filter(|x| *x > -30_000)
        .unwrap_or(fallback_x)
}

pub fn apply_drawer_state(
    app: &AppHandle,
    shell: &tauri::State<'_, ShellState>,
    expanded: bool,
) -> Result<(), String> {
    let previous = shell_snapshot(shell)?;
    let handle_target = handle_window_bounds(app, expanded)?;
    let fallback_from_x = handle_window_bounds(app, !expanded)
        .map(|bounds| bounds.x)
        .unwrap_or(handle_target.x);
    let handle_start_x = current_handle_x_or(app, fallback_from_x);
    let animation_generation = next_animation_generation(shell);

    if expanded {
        hide_module_windows(app)?;
        ensure_drawer_window(app)?;
        let drawer_target = drawer_window_bounds(app)?;
        let next_active_module = Some("files".to_string());
        apply_window_bounds(app, DRAWER_WINDOW_LABEL, drawer_target)?;
        apply_window_bounds(
            app,
            HANDLE_WINDOW_LABEL,
            ShellBounds {
                x: handle_start_x,
                ..handle_target
            },
        )?;
        update_shell_state(app, shell, true, next_active_module)?;
        if let Some(window) = app.get_webview_window(DRAWER_WINDOW_LABEL) {
            if window.is_minimized().unwrap_or(false) {
                let _ = window.unminimize();
            }
            window.show().map_err(|err| err.to_string())?;
            window.set_focus().map_err(|err| err.to_string())?;
        }
        if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
            window.show().map_err(|err| err.to_string())?;
        }
        sync_expanded_shell_z_order(app)?;
        if shell.drawer_ready.load(Ordering::Acquire) {
            animate_handle_slide(
                app.clone(),
                animation_generation,
                handle_start_x,
                handle_target,
                false,
            );
        } else {
            wait_ready_then_slide_handle(
                app.clone(),
                animation_generation,
                handle_start_x,
                handle_target,
            );
        }
    } else {
        let active_module = previous.active_module;
        let next_module = if active_module.as_deref() == Some("files") {
            None
        } else {
            active_module
        };
        update_shell_state(app, shell, false, next_module)?;
        apply_window_bounds(
            app,
            HANDLE_WINDOW_LABEL,
            ShellBounds {
                x: handle_start_x,
                ..handle_target
            },
        )?;
        if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
            window.show().map_err(|err| err.to_string())?;
        }
        set_handle_always_on_top(app, true)?;
        animate_handle_slide(
            app.clone(),
            animation_generation,
            handle_start_x,
            handle_target,
            true,
        );
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
    let current = shell_snapshot(shell)?;
    let active_module = current.active_module.clone();
    if active_module.as_deref() == Some("files") {
        return apply_drawer_state(app, shell, false);
    }
    next_animation_generation(shell);
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
            ensure_window_focus_listener(
                app,
                &window,
                &app.state::<ShellState>().registered_drawer_hwnd,
                false,
            );
            return Ok(());
        }

        let _ = window.hide();
        window
            .destroy()
            .or_else(|_| window.close())
            .map_err(|err| err.to_string())?;
    }

    app.state::<ShellState>()
        .drawer_ready
        .store(false, Ordering::Release);
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
    ensure_window_focus_listener(
        app,
        &window,
        &app.state::<ShellState>().registered_drawer_hwnd,
        false,
    );
    Ok(())
}

pub fn recover_shell_windows(app: &AppHandle) -> Result<(), String> {
    let shell = app.state::<ShellState>();
    next_animation_generation(&shell);

    let mut snapshot = shell_snapshot(&shell)?;
    for floating_label in ["todos", "capture"] {
        if snapshot.active_module.as_deref() == Some(floating_label)
            && app.get_webview_window(floating_label).is_none()
        {
            update_shell_state(app, &shell, false, None)?;
            snapshot = shell_snapshot(&shell)?;
        }
        if snapshot.active_module.as_deref() != Some(floating_label) {
            if let Some(window) = app.get_webview_window(floating_label) {
                let _ = window.hide();
            }
        }
    }

    if snapshot.expanded {
        ensure_drawer_window(app)?;
        let drawer_bounds = drawer_window_bounds(app)?;
        apply_window_bounds(app, DRAWER_WINDOW_LABEL, drawer_bounds)?;
        if let Some(window) = app.get_webview_window(DRAWER_WINDOW_LABEL) {
            if window.is_minimized().unwrap_or(false) {
                let _ = window.unminimize();
            }
            window.show().map_err(|err| err.to_string())?;
            if !matches!(
                snapshot.active_module.as_deref(),
                Some("todos") | Some("capture")
            ) {
                window.set_focus().map_err(|err| err.to_string())?;
            }
        }
        apply_window_bounds(app, HANDLE_WINDOW_LABEL, handle_window_bounds(app, true)?)?;
        if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
            window.show().map_err(|err| err.to_string())?;
            let _ = set_window_dwm_transitions_disabled(&window, false);
        }
        sync_expanded_shell_z_order(app)?;
    } else {
        if let Some(window) = app.get_webview_window(DRAWER_WINDOW_LABEL) {
            let _ = window.hide();
        }
        apply_window_bounds(app, HANDLE_WINDOW_LABEL, handle_window_bounds(app, false)?)?;
        if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
            window.show().map_err(|err| err.to_string())?;
            let _ = set_window_dwm_transitions_disabled(&window, false);
            if !matches!(
                snapshot.active_module.as_deref(),
                Some("todos") | Some("capture")
            ) {
                window.set_focus().map_err(|err| err.to_string())?;
            }
        }
        set_handle_always_on_top(app, true)?;
    }
    if let Some(window) = app.get_webview_window(DRAWER_WINDOW_LABEL) {
        let _ = set_window_dwm_transitions_disabled(&window, false);
    }

    for floating_label in ["todos", "capture"] {
        if snapshot.active_module.as_deref() == Some(floating_label) {
            if let Some(window) = app.get_webview_window(floating_label) {
                window.show().map_err(|err| err.to_string())?;
                window.set_focus().map_err(|err| err.to_string())?;
                let _ = set_window_dwm_transitions_disabled(&window, false);
            }
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
    for label in ["capture", "todos"] {
        if let Some(window) = app.get_webview_window(label) {
            window.hide().map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn is_current_generation(app: &AppHandle, generation: u64) -> bool {
    app.state::<ShellState>()
        .animation_generation
        .load(Ordering::Relaxed)
        == generation
}

fn wait_ready_then_slide_handle(
    app: AppHandle,
    animation_generation: u64,
    start_x: i32,
    target: ShellBounds,
) {
    let max_wait = Duration::from_millis(DRAWER_READY_WAIT_TIMEOUT_MS);
    let poll_step = Duration::from_millis(DRAWER_READY_POLL_MS);

    std::thread::spawn(move || {
        let started_at = Instant::now();
        while !app
            .state::<ShellState>()
            .drawer_ready
            .load(Ordering::Acquire)
        {
            if !is_current_generation(&app, animation_generation) {
                return;
            }
            if started_at.elapsed() >= max_wait {
                break;
            }
            std::thread::sleep(poll_step);
        }
        if !is_current_generation(&app, animation_generation) {
            return;
        }
        animate_handle_slide(app, animation_generation, start_x, target, false);
    });
}

fn animate_handle_slide(
    app: AppHandle,
    animation_generation: u64,
    start_x: i32,
    target: ShellBounds,
    hide_drawer_on_finish: bool,
) {
    let total_duration = Duration::from_millis(DRAWER_SLIDE_DURATION_MS);
    let frame_step = Duration::from_millis(DRAWER_SLIDE_FRAME_MS);

    std::thread::spawn(move || {
        let started_at = Instant::now();
        let mut last_sent_x = start_x;

        loop {
            if !is_current_generation(&app, animation_generation) {
                return;
            }

            let elapsed = started_at.elapsed();
            let progress = (elapsed.as_secs_f64() / total_duration.as_secs_f64()).min(1.0);
            let next_x = interpolate_x(start_x, target.x, progress);

            if next_x != last_sent_x || progress >= 1.0 {
                last_sent_x = next_x;
                let app_frame = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if !is_current_generation(&app_frame, animation_generation) {
                        return;
                    }
                    if let Some(window) = app_frame.get_webview_window(HANDLE_WINDOW_LABEL) {
                        let _ = window.set_position(PhysicalPosition::new(next_x, target.y));
                    }
                });
            }

            if progress >= 1.0 {
                break;
            }
            std::thread::sleep(frame_step);
        }

        let app_final = app.clone();
        let _ = app.run_on_main_thread(move || {
            if !is_current_generation(&app_final, animation_generation) {
                return;
            }
            let _ = apply_window_bounds(&app_final, HANDLE_WINDOW_LABEL, target);
            if hide_drawer_on_finish {
                if let Some(window) = app_final.get_webview_window(DRAWER_WINDOW_LABEL) {
                    let _ = window.hide();
                }
            } else {
                let _ = sync_expanded_shell_z_order(&app_final);
            }
        });
    });
}

pub fn ensure_handle_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(HANDLE_WINDOW_LABEL) {
        ensure_window_focus_listener(
            app,
            &window,
            &app.state::<ShellState>().registered_handle_hwnd,
            true,
        );
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
    ensure_window_focus_listener(
        app,
        &window,
        &app.state::<ShellState>().registered_handle_hwnd,
        true,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_sync_expanded_pair_requires_expanded_and_focused() {
        assert!(should_sync_expanded_pair(
            &ShellWindowSnapshot {
                expanded: true,
                active_module: Some("files".to_string()),
            },
            true
        ));
        assert!(!should_sync_expanded_pair(
            &ShellWindowSnapshot {
                expanded: true,
                active_module: Some("files".to_string()),
            },
            false
        ));
        assert!(!should_sync_expanded_pair(
            &ShellWindowSnapshot {
                expanded: false,
                active_module: None,
            },
            true
        ));
    }

    #[test]
    fn ease_out_cubic_is_monotonic_and_clamped() {
        assert!((ease_out_cubic(-0.5) - 0.0).abs() < f64::EPSILON);
        assert!((ease_out_cubic(0.0) - 0.0).abs() < f64::EPSILON);
        assert!((ease_out_cubic(0.5) - 0.875).abs() < 1e-6);
        assert!((ease_out_cubic(1.0) - 1.0).abs() < f64::EPSILON);
        assert!((ease_out_cubic(1.5) - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn interpolate_x_hits_exact_endpoints() {
        assert_eq!(interpolate_x(1864, 1304, 0.0), 1864);
        assert_eq!(interpolate_x(1864, 1304, 1.0), 1304);
        assert_eq!(interpolate_x(1304, 1864, 1.0), 1864);
        let mid = interpolate_x(1864, 1304, 0.5);
        assert!(mid < 1864 && mid > 1304);
    }
}
