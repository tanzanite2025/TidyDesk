use tauri::WebviewWindow;

fn require_command_window(
    window: &WebviewWindow,
    allowed_labels: &[&str],
    command: &str,
) -> Result<(), String> {
    let label = window.label();
    if allowed_labels.iter().any(|allowed| *allowed == label) {
        Ok(())
    } else {
        Err(format!("{command} is not available from window `{label}`"))
    }
}

#[tauri::command]
pub fn clipboard_read_text(window: WebviewWindow) -> Result<String, String> {
    require_command_window(&window, &["main", "capture"], "clipboard_read_text")?;
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|err| format!("failed to access system clipboard: {err}"))?;
    match clipboard.get_text() {
        Ok(text) => Ok(text),
        Err(_) => Ok(String::new()),
    }
}
