use tauri::{
    window::Color, AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

pub const APP_PICKER_WINDOW_LABEL: &str = "app-picker";

fn register_app_picker_window_lifecycle(window: &WebviewWindow, app: AppHandle) {
    let win_for_close = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = win_for_close.hide();
            let app_handle = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let _ = crate::shell::recover_shell_windows(&app_handle);
            });
        }
        WindowEvent::Destroyed => {
            let app_handle = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let _ = crate::shell::recover_shell_windows(&app_handle);
            });
        }
        _ => {}
    });
}

pub fn open_app_picker_window(
    app: &AppHandle,
    payload: Option<crate::apps::OpenAppPickerPayload>,
) -> Result<(), String> {
    let state = app.state::<crate::apps::AppPickerTargetState>();
    let target_folder = if let Some(target_folder) = payload
        .and_then(|value| value.target_folder)
        .map(|value| crate::files::safe_drawer_name(&value))
        .filter(|value| !value.is_empty())
    {
        let mut current = state
            .0
            .lock()
            .map_err(|_| "failed to lock app picker target".to_string())?;
        *current = target_folder;
        current.clone()
    } else {
        state
            .0
            .lock()
            .map_err(|_| "failed to lock app picker target".to_string())?
            .clone()
    };

    if let Some(window) = app.get_webview_window(APP_PICKER_WINDOW_LABEL) {
        if window.is_minimized().unwrap_or(false) {
            let _ = window.unminimize();
        }
        window.show().map_err(|err| err.to_string())?;
        window.set_focus().map_err(|err| err.to_string())?;
        window
            .emit("set-target-folder", target_folder)
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        app,
        APP_PICKER_WINDOW_LABEL,
        crate::shell::webview_url_for_mode("app-picker")?,
    )
    .title("TidyDesk App Picker")
    .inner_size(920.0, 720.0)
    .min_inner_size(640.0, 480.0)
    .background_color(Color(0x1a, 0x1d, 0x2e, 0xff))
    .resizable(true)
    .visible(false)
    .center()
    .build()
    .map_err(|err| err.to_string())?;
    register_app_picker_window_lifecycle(&window, app.clone());
    window.show().map_err(|err| err.to_string())?;
    window.set_focus().map_err(|err| err.to_string())?;
    window
        .emit("set-target-folder", target_folder)
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub fn close_app_picker_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(APP_PICKER_WINDOW_LABEL) {
        window.hide().map_err(|err| err.to_string())?;
    }
    crate::shell::recover_shell_windows(app)?;
    Ok(())
}
