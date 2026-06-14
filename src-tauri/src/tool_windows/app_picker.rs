use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub const APP_PICKER_WINDOW_LABEL: &str = "app-picker";

fn register_app_picker_window_lifecycle(window: &WebviewWindow, app: AppHandle) {
    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            let _ = crate::shell::recover_shell_windows(&app);
        }
    });
}

pub fn open_app_picker_window(
    app: AppHandle,
    state: tauri::State<'_, crate::apps::AppPickerTargetState>,
    payload: Option<crate::apps::OpenAppPickerPayload>,
) -> Result<(), String> {
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
        window.show().map_err(|err| err.to_string())?;
        window.set_focus().map_err(|err| err.to_string())?;
        window
            .emit("set-target-folder", target_folder)
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        &app,
        APP_PICKER_WINDOW_LABEL,
        crate::shell::webview_url_for_mode("app-picker")?,
    )
    .title("TidyDesk App Picker")
    .inner_size(920.0, 720.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|err| err.to_string())?;
    register_app_picker_window_lifecycle(&window, app.clone());
    window.show().map_err(|err| err.to_string())?;
    window
        .emit("set-target-folder", target_folder)
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub fn close_app_picker_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(APP_PICKER_WINDOW_LABEL) {
        window
            .destroy()
            .or_else(|_| window.close())
            .map_err(|err| err.to_string())?;
    }
    crate::shell::recover_shell_windows(&app)?;
    Ok(())
}
