use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

pub fn ensure_sticker_window(
    app: &AppHandle,
    sticker: &crate::stickers_rules::StickerRecord,
) -> Result<(), String> {
    if !Path::new(&sticker.image_path).exists() {
        return Ok(());
    }

    let label = crate::stickers_rules::sticker_window_label(&sticker.id);
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|err| err.to_string())?;
        window
            .set_always_on_top(sticker.always_on_top)
            .map_err(|err| err.to_string())?;
        window
            .set_size(PhysicalSize::new(
                sticker.bounds.width,
                sticker.bounds.height,
            ))
            .map_err(|err| err.to_string())?;
        window
            .set_position(PhysicalPosition::new(sticker.bounds.x, sticker.bounds.y))
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        app,
        &label,
        crate::stickers_rules::sticker_webview_url(&sticker.id)?,
    )
    .title("TidyDesk Sticker")
    .inner_size(sticker.bounds.width as f64, sticker.bounds.height as f64)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .always_on_top(sticker.always_on_top)
    .skip_taskbar(true)
    .build()
    .map_err(|err| err.to_string())?;
    window
        .set_size(PhysicalSize::new(
            sticker.bounds.width,
            sticker.bounds.height,
        ))
        .map_err(|err| err.to_string())?;
    window
        .set_position(PhysicalPosition::new(sticker.bounds.x, sticker.bounds.y))
        .map_err(|err| err.to_string())?;
    register_sticker_window_lifecycle(&window, app.clone(), sticker.id.clone());
    Ok(())
}

struct BoundsPersistDebounce {
    sequence: u64,
    running: bool,
}

fn register_sticker_window_lifecycle(window: &WebviewWindow, app: AppHandle, sticker_id: String) {
    let debounce = Arc::new(Mutex::new(BoundsPersistDebounce {
        sequence: 0,
        running: false,
    }));
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            schedule_sticker_bounds_persist(&app, &sticker_id, &debounce);
        }
        _ => {}
    });
}

fn schedule_sticker_bounds_persist(
    app: &AppHandle,
    sticker_id: &str,
    debounce: &Arc<Mutex<BoundsPersistDebounce>>,
) {
    let Ok(mut state) = debounce.lock() else {
        return;
    };
    state.sequence += 1;
    if state.running {
        return;
    }
    state.running = true;
    let mut observed_sequence = state.sequence;
    drop(state);

    let app = app.clone();
    let sticker_id = sticker_id.to_string();
    let debounce = debounce.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(180));
        let Ok(mut state) = debounce.lock() else {
            return;
        };
        if state.sequence == observed_sequence {
            state.running = false;
            drop(state);
            let _ = persist_sticker_window_bounds(&app, &sticker_id);
            return;
        }
        observed_sequence = state.sequence;
    });
}

fn persist_sticker_window_bounds(app: &AppHandle, sticker_id: &str) -> Result<(), String> {
    let label = crate::stickers_rules::sticker_window_label(sticker_id);
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(());
    };
    let position = window.outer_position().map_err(|err| err.to_string())?;
    let size = window.outer_size().map_err(|err| err.to_string())?;

    crate::stickers_rules::mutate_sticker_state(app, |state| {
        if let Some(sticker) = state.stickers.iter_mut().find(|item| item.id == sticker_id) {
            sticker.bounds = crate::stickers_rules::StickerWindowBounds {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            };
        }
        Ok(())
    })?;
    Ok(())
}
