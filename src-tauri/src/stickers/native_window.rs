use super::model::StickerRecord;
#[cfg(target_os = "windows")]
use super::model::StickerWindowBounds;
#[cfg(target_os = "windows")]
use super::store::mutate_sticker_state;
use tauri::AppHandle;

/// Convert tight RGBA bytes `[R, G, B, A]` into Win32 `UpdateLayeredWindow`
/// premultiplied BGRA bytes `[B, G, R, A]` with a subtle 1px border rim.
pub(crate) fn rgba_to_premultiplied_bgra(
    rgba: &[u8],
    width: u32,
    height: u32,
    always_on_top: bool,
) -> Vec<u8> {
    let pixel_count = (width as usize).saturating_mul(height as usize);
    let mut bgra = Vec::with_capacity(pixel_count.saturating_mul(4));
    let rim: [u8; 4] = if always_on_top {
        [248, 189, 56, 220] // sky-400 (#38bdf8) in BGRA
    } else {
        [255, 255, 255, 90]
    };

    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;
            let r = rgba.get(idx).copied().unwrap_or(0) as u16;
            let g = rgba.get(idx + 1).copied().unwrap_or(0) as u16;
            let b = rgba.get(idx + 2).copied().unwrap_or(0) as u16;
            let a = rgba.get(idx + 3).copied().unwrap_or(255) as u16;

            let is_border = x == 0 || y == 0 || x + 1 == width || y + 1 == height;
            if is_border && width >= 4 && height >= 4 {
                let ra = rim[3] as u16;
                let inv_ra = 255 - ra;
                let out_b = ((rim[0] as u16 * ra) + (b * a * inv_ra / 255) + 127) / 255;
                let out_g = ((rim[1] as u16 * ra) + (g * a * inv_ra / 255) + 127) / 255;
                let out_r = ((rim[2] as u16 * ra) + (r * a * inv_ra / 255) + 127) / 255;
                let out_a = (ra + (a * inv_ra + 127) / 255).min(255);
                bgra.push(out_b.min(255) as u8);
                bgra.push(out_g.min(255) as u8);
                bgra.push(out_r.min(255) as u8);
                bgra.push(out_a as u8);
            } else {
                let out_b = (b * a + 127) / 255;
                let out_g = (g * a + 127) / 255;
                let out_r = (r * a + 127) / 255;
                bgra.push(out_b as u8);
                bgra.push(out_g as u8);
                bgra.push(out_r as u8);
                bgra.push(a as u8);
            }
        }
    }
    bgra
}

#[cfg(target_os = "windows")]
mod win32_impl {
    use super::*;
    use image::imageops::FilterType;
    use image::RgbaImage;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::path::Path;
    use std::ptr::{copy_nonoverlapping, null_mut};
    use std::sync::mpsc::{self, Receiver, Sender};
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread;
    use std::time::Duration;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
        SelectObject, AC_SRC_ALPHA, AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        BLENDFUNCTION, DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DestroyWindow,
        DispatchMessageW, GetCursorPos, GetMessageW, GetWindowRect, LoadCursorW, PostMessageW,
        RegisterClassExW, SetForegroundWindow, SetWindowPos, TrackPopupMenu, TranslateMessage,
        UpdateLayeredWindow, CS_HREDRAW, CS_VREDRAW, HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT,
        HTCAPTION, HTLEFT, HTRIGHT, HTTOP, HTTOPLEFT, HTTOPRIGHT, HWND_MESSAGE, HWND_NOTOPMOST,
        HWND_TOPMOST, IDC_ARROW, MF_CHECKED, MF_SEPARATOR, MF_STRING, MF_UNCHECKED, MINMAXINFO,
        MSG, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, TPM_LEFTALIGN, TPM_NONOTIFY,
        TPM_RETURNCMD, TPM_RIGHTBUTTON, TPM_TOPALIGN, ULW_ALPHA, WM_APP, WM_CONTEXTMENU,
        WM_DESTROY, WM_EXITSIZEMOVE, WM_GETMINMAXINFO, WM_NCHITTEST, WM_NCLBUTTONDBLCLK,
        WM_NCRBUTTONDOWN, WM_NCRBUTTONUP, WM_NULL, WM_RBUTTONUP, WM_SIZE, WNDCLASSEXW,
        WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
    };

    const WM_APP_PROCESS_COMMANDS: u32 = WM_APP + 1;
    const RESIZE_BORDER_PX: i32 = 8;
    const MIN_STICKER_SIZE_PX: i32 = 32;

    const IDM_TOGGLE_PIN: usize = 1001;
    const IDM_COPY_IMAGE: usize = 1002;
    const IDM_SAVE_AS: usize = 1003;
    const IDM_CLOSE_STICKER: usize = 1004;

    enum StickerUiCommand {
        Ensure {
            app: Box<AppHandle>,
            sticker: Box<StickerRecord>,
        },
        SetPin {
            sticker_id: String,
            always_on_top: bool,
        },
        Close {
            sticker_id: String,
        },
    }

    struct BoundsPersistDebounce {
        sequence: u64,
        running: bool,
        latest_bounds: StickerWindowBounds,
    }

    struct StickerEntry {
        app: AppHandle,
        hwnd: HWND,
        source_image: RgbaImage,
        always_on_top: bool,
        bounds: StickerWindowBounds,
        debounce: Arc<Mutex<BoundsPersistDebounce>>,
    }

    #[derive(Default)]
    struct ThreadState {
        by_id: HashMap<String, StickerEntry>,
        id_by_hwnd: HashMap<isize, String>,
    }

    struct CommandPump {
        rx: Receiver<StickerUiCommand>,
        hinstance: windows::Win32::Foundation::HINSTANCE,
    }

    thread_local! {
        static THREAD_STATE: RefCell<ThreadState> = RefCell::new(ThreadState::default());
        static COMMAND_PUMP: RefCell<Option<CommandPump>> = const { RefCell::new(None) };
    }

    struct NativeStickerRuntime {
        tx: Sender<StickerUiCommand>,
        anchor_hwnd_raw: isize,
    }

    static RUNTIME: OnceLock<Result<NativeStickerRuntime, String>> = OnceLock::new();

    fn runtime() -> Result<&'static NativeStickerRuntime, String> {
        let entry = RUNTIME.get_or_init(start_ui_thread);
        entry.as_ref().map_err(|err| err.clone())
    }

    fn start_ui_thread() -> Result<NativeStickerRuntime, String> {
        let (tx, rx) = mpsc::channel::<StickerUiCommand>();
        let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<isize, String>>(1);

        thread::Builder::new()
            .name("tidydesk-native-stickers".to_string())
            .spawn(move || run_ui_thread(rx, ready_tx))
            .map_err(|err| format!("failed to spawn native sticker thread: {err}"))?;

        let anchor_hwnd_raw = ready_rx
            .recv()
            .map_err(|_| "native sticker thread failed before signaling readiness".to_string())??;

        Ok(NativeStickerRuntime {
            tx,
            anchor_hwnd_raw,
        })
    }

    fn post_wake(anchor_hwnd_raw: isize) {
        unsafe {
            let hwnd = HWND(anchor_hwnd_raw as *mut std::ffi::c_void);
            let _ = PostMessageW(Some(hwnd), WM_APP_PROCESS_COMMANDS, WPARAM(0), LPARAM(0));
        }
    }

    pub fn ensure_native_sticker(app: &AppHandle, sticker: &StickerRecord) -> Result<(), String> {
        if !Path::new(&sticker.image_path).exists() {
            return Ok(());
        }
        let rt = runtime()?;
        rt.tx
            .send(StickerUiCommand::Ensure {
                app: Box::new(app.clone()),
                sticker: Box::new(sticker.clone()),
            })
            .map_err(|_| "native sticker UI loop disconnected".to_string())?;
        post_wake(rt.anchor_hwnd_raw);
        Ok(())
    }

    pub fn update_native_sticker_pin(sticker_id: &str, always_on_top: bool) -> Result<(), String> {
        let rt = runtime()?;
        rt.tx
            .send(StickerUiCommand::SetPin {
                sticker_id: sticker_id.to_string(),
                always_on_top,
            })
            .map_err(|_| "native sticker UI loop disconnected".to_string())?;
        post_wake(rt.anchor_hwnd_raw);
        Ok(())
    }

    pub fn close_native_sticker(sticker_id: &str) -> Result<(), String> {
        let Some(Ok(rt)) = RUNTIME.get() else {
            return Ok(());
        };
        let _ = rt.tx.send(StickerUiCommand::Close {
            sticker_id: sticker_id.to_string(),
        });
        post_wake(rt.anchor_hwnd_raw);
        Ok(())
    }

    fn run_ui_thread(
        rx: Receiver<StickerUiCommand>,
        ready_tx: mpsc::SyncSender<Result<isize, String>>,
    ) {
        unsafe {
            let hinstance = match GetModuleHandleW(None) {
                Ok(module) => module.into(),
                Err(err) => {
                    let _ = ready_tx.send(Err(format!("GetModuleHandleW failed: {err}")));
                    return;
                }
            };

            let class_name = w!("TidyDeskNativeStickerWindow");
            let cursor = LoadCursorW(None, IDC_ARROW).unwrap_or_default();
            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(sticker_wnd_proc),
                hInstance: hinstance,
                hCursor: cursor,
                lpszClassName: class_name,
                ..Default::default()
            };

            if RegisterClassExW(&wc) == 0 {
                let _ = ready_tx.send(Err(
                    "RegisterClassExW failed for native stickers".to_string()
                ));
                return;
            }

            // Use a dedicated message-only HWND target for PostMessageW so modal
            // move/size/menu loops still deliver pending commands through DispatchMessageW.
            let anchor_hwnd = match CreateWindowExW(
                Default::default(),
                class_name,
                w!("TidyDeskStickerAnchor"),
                Default::default(),
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                Some(hinstance),
                None,
            ) {
                Ok(hwnd) => hwnd,
                Err(err) => {
                    let _ = ready_tx.send(Err(format!(
                        "CreateWindowExW failed for native sticker anchor: {err}"
                    )));
                    return;
                }
            };

            COMMAND_PUMP.with(|slot| {
                *slot.borrow_mut() = Some(CommandPump { rx, hinstance });
            });

            if ready_tx.send(Ok(anchor_hwnd.0 as isize)).is_err() {
                return;
            }

            drain_pending_commands();

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }

    fn drain_pending_commands() {
        let class_name = w!("TidyDeskNativeStickerWindow");
        let mut commands = Vec::new();
        let mut hinstance_opt = None;
        COMMAND_PUMP.with(|slot| {
            let slot_ref = slot.borrow();
            if let Some(pump) = slot_ref.as_ref() {
                hinstance_opt = Some(pump.hinstance);
                while let Ok(cmd) = pump.rx.try_recv() {
                    commands.push(cmd);
                }
            }
        });

        let Some(hinstance) = hinstance_opt else {
            return;
        };

        for cmd in commands {
            match cmd {
                StickerUiCommand::Ensure { app, sticker } => {
                    if let Err(err) = apply_ensure_command(*app, *sticker, class_name, hinstance) {
                        eprintln!("[TIDYDESK] Failed to show native sticker: {err}");
                    }
                }
                StickerUiCommand::SetPin {
                    sticker_id,
                    always_on_top,
                } => {
                    apply_set_pin_command(&sticker_id, always_on_top);
                }
                StickerUiCommand::Close { sticker_id } => {
                    apply_close_command(&sticker_id);
                }
            }
        }
    }

    fn apply_ensure_command(
        app: AppHandle,
        sticker: StickerRecord,
        class_name: PCWSTR,
        hinstance: windows::Win32::Foundation::HINSTANCE,
    ) -> Result<(), String> {
        let existing_hwnd = THREAD_STATE.with(|state| {
            state
                .borrow()
                .by_id
                .get(&sticker.id)
                .map(|entry| entry.hwnd)
        });

        if let Some(hwnd) = existing_hwnd {
            THREAD_STATE.with(|state| {
                let mut state = state.borrow_mut();
                if let Some(entry) = state.by_id.get_mut(&sticker.id) {
                    entry.always_on_top = sticker.always_on_top;
                    entry.bounds = sticker.bounds.clone();
                }
            });
            unsafe {
                let insert_after = if sticker.always_on_top {
                    HWND_TOPMOST
                } else {
                    HWND_NOTOPMOST
                };
                let _ = SetWindowPos(
                    hwnd,
                    Some(insert_after),
                    sticker.bounds.x,
                    sticker.bounds.y,
                    sticker.bounds.width.max(1) as i32,
                    sticker.bounds.height.max(1) as i32,
                    SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
            }
            render_sticker_hwnd(hwnd, FilterType::Lanczos3)?;
            return Ok(());
        }

        let source_image = image::open(&sticker.image_path)
            .map_err(|err| format!("failed to open sticker image {}: {err}", sticker.image_path))?
            .to_rgba8();

        let width = sticker.bounds.width.max(1) as i32;
        let height = sticker.bounds.height.max(1) as i32;
        let mut ex_style = WS_EX_LAYERED | WS_EX_TOOLWINDOW;
        if sticker.always_on_top {
            ex_style |= WS_EX_TOPMOST;
        }

        let hwnd = unsafe {
            CreateWindowExW(
                ex_style,
                class_name,
                w!("TidyDesk Sticker"),
                WS_POPUP | WS_VISIBLE,
                sticker.bounds.x,
                sticker.bounds.y,
                width,
                height,
                None,
                None,
                Some(hinstance),
                None,
            )
            .map_err(|err| format!("CreateWindowExW failed for sticker {}: {err}", sticker.id))?
        };

        let initial_bounds = sticker.bounds.clone();
        let entry = StickerEntry {
            app,
            hwnd,
            source_image,
            always_on_top: sticker.always_on_top,
            bounds: initial_bounds.clone(),
            debounce: Arc::new(Mutex::new(BoundsPersistDebounce {
                sequence: 0,
                running: false,
                latest_bounds: initial_bounds,
            })),
        };

        THREAD_STATE.with(|state| {
            let mut state = state.borrow_mut();
            state.id_by_hwnd.insert(hwnd.0 as isize, sticker.id.clone());
            state.by_id.insert(sticker.id, entry);
        });

        render_sticker_hwnd(hwnd, FilterType::Lanczos3)?;
        Ok(())
    }

    fn apply_set_pin_command(sticker_id: &str, always_on_top: bool) {
        let hwnd = THREAD_STATE.with(|state| {
            let mut state = state.borrow_mut();
            let entry = state.by_id.get_mut(sticker_id)?;
            entry.always_on_top = always_on_top;
            Some(entry.hwnd)
        });

        if let Some(hwnd) = hwnd {
            unsafe {
                let insert_after = if always_on_top {
                    HWND_TOPMOST
                } else {
                    HWND_NOTOPMOST
                };
                let _ = SetWindowPos(
                    hwnd,
                    Some(insert_after),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
            if let Err(err) = render_sticker_hwnd(hwnd, FilterType::Triangle) {
                eprintln!("[TIDYDESK] Failed to redraw pinned sticker {sticker_id}: {err}");
            }
        }
    }

    fn apply_close_command(sticker_id: &str) {
        let hwnd = THREAD_STATE.with(|state| {
            let mut state = state.borrow_mut();
            let entry = state.by_id.remove(sticker_id)?;
            state.id_by_hwnd.remove(&(entry.hwnd.0 as isize));
            Some(entry.hwnd)
        });
        if let Some(hwnd) = hwnd {
            unsafe {
                let _ = DestroyWindow(hwnd);
            }
        }
    }

    fn render_sticker_hwnd(hwnd: HWND, filter: FilterType) -> Result<(), String> {
        let snapshot = THREAD_STATE.with(|state| {
            let state = state.borrow();
            let id = state.id_by_hwnd.get(&(hwnd.0 as isize))?;
            let entry = state.by_id.get(id)?;
            Some((
                entry.source_image.clone(),
                entry.bounds.clone(),
                entry.always_on_top,
            ))
        });

        let Some((source, bounds, always_on_top)) = snapshot else {
            return Ok(());
        };

        let mut rect = RECT::default();
        let (x, y, width, height) = unsafe {
            if GetWindowRect(hwnd, &mut rect).is_ok() {
                (
                    rect.left,
                    rect.top,
                    (rect.right - rect.left).max(1) as u32,
                    (rect.bottom - rect.top).max(1) as u32,
                )
            } else {
                (
                    bounds.x,
                    bounds.y,
                    bounds.width.max(1),
                    bounds.height.max(1),
                )
            }
        };

        let resized_cow;
        let rgba_slice: &[u8] = if source.width() == width && source.height() == height {
            source.as_raw()
        } else {
            resized_cow = image::imageops::resize(&source, width, height, filter);
            resized_cow.as_raw()
        };

        let bgra = rgba_to_premultiplied_bgra(rgba_slice, width, height, always_on_top);
        update_layered_bitmap(hwnd, x, y, width as i32, height as i32, &bgra)
    }

    fn update_layered_bitmap(
        hwnd: HWND,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        bgra: &[u8],
    ) -> Result<(), String> {
        unsafe {
            let screen_dc = GetDC(None);
            if screen_dc.0.is_null() {
                return Err("GetDC(None) failed".to_string());
            }
            let mem_dc = CreateCompatibleDC(Some(screen_dc));
            if mem_dc.0.is_null() {
                let _ = ReleaseDC(None, screen_dc);
                return Err("CreateCompatibleDC failed".to_string());
            }

            let bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };

            let mut bits_ptr = null_mut();
            let hbitmap = match CreateDIBSection(
                Some(screen_dc),
                &bmi,
                DIB_RGB_COLORS,
                &mut bits_ptr,
                None,
                0,
            ) {
                Ok(bmp) => bmp,
                Err(err) => {
                    let _ = DeleteDC(mem_dc);
                    let _ = ReleaseDC(None, screen_dc);
                    return Err(format!("CreateDIBSection failed: {err}"));
                }
            };

            if bits_ptr.is_null() {
                let _ = DeleteObject(HGDIOBJ(hbitmap.0));
                let _ = DeleteDC(mem_dc);
                let _ = ReleaseDC(None, screen_dc);
                return Err("CreateDIBSection returned null pixel buffer".to_string());
            }

            let expected_len = (width as usize) * (height as usize) * 4;
            if bgra.len() >= expected_len {
                copy_nonoverlapping(bgra.as_ptr(), bits_ptr.cast::<u8>(), expected_len);
            }

            let prev = SelectObject(mem_dc, HGDIOBJ(hbitmap.0));
            let pt_dst = POINT { x, y };
            let size = SIZE {
                cx: width,
                cy: height,
            };
            let pt_src = POINT { x: 0, y: 0 };
            let blend = BLENDFUNCTION {
                BlendOp: AC_SRC_OVER as u8,
                BlendFlags: 0,
                SourceConstantAlpha: 255,
                AlphaFormat: AC_SRC_ALPHA as u8,
            };

            let result = UpdateLayeredWindow(
                hwnd,
                Some(screen_dc),
                Some(&pt_dst),
                Some(&size),
                Some(mem_dc),
                Some(&pt_src),
                COLORREF(0),
                Some(&blend),
                ULW_ALPHA,
            );

            let _ = SelectObject(mem_dc, prev);
            let _ = DeleteObject(HGDIOBJ(hbitmap.0));
            let _ = DeleteDC(mem_dc);
            let _ = ReleaseDC(None, screen_dc);

            result.map_err(|err| format!("UpdateLayeredWindow failed: {err}"))
        }
    }

    fn show_context_menu(hwnd: HWND) {
        let info = THREAD_STATE.with(|state| {
            let state = state.borrow();
            let id = state.id_by_hwnd.get(&(hwnd.0 as isize))?.clone();
            let entry = state.by_id.get(&id)?;
            Some((entry.app.clone(), id, entry.always_on_top))
        });

        let Some((app, sticker_id, always_on_top)) = info else {
            return;
        };

        unsafe {
            let mut cursor = POINT::default();
            if GetCursorPos(&mut cursor).is_err() {
                return;
            }
            let Ok(menu) = CreatePopupMenu() else {
                return;
            };
            let pin_flag = if always_on_top {
                MF_STRING | MF_CHECKED
            } else {
                MF_STRING | MF_UNCHECKED
            };
            let _ = AppendMenuW(menu, pin_flag, IDM_TOGGLE_PIN, w!("置顶贴纸"));
            let _ = AppendMenuW(menu, MF_STRING, IDM_COPY_IMAGE, w!("复制图片"));
            let _ = AppendMenuW(menu, MF_STRING, IDM_SAVE_AS, w!("另存为..."));
            let _ = AppendMenuW(menu, MF_SEPARATOR, 0, None);
            let _ = AppendMenuW(menu, MF_STRING, IDM_CLOSE_STICKER, w!("关闭贴纸"));

            let _ = SetForegroundWindow(hwnd);
            let cmd = TrackPopupMenu(
                menu,
                TPM_LEFTALIGN | TPM_TOPALIGN | TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON,
                cursor.x,
                cursor.y,
                Some(0),
                hwnd,
                None,
            );
            let _ = PostMessageW(Some(hwnd), WM_NULL, WPARAM(0), LPARAM(0));
            let _ = DestroyMenu(menu);

            match cmd.0 as usize {
                IDM_TOGGLE_PIN => {
                    thread::spawn(move || {
                        if let Err(err) =
                            crate::stickers::commands::toggle_sticker_pin_by_id(&app, &sticker_id)
                        {
                            eprintln!("[TIDYDESK] Failed to toggle pin for {sticker_id}: {err}");
                            crate::stickers::notify_sticker_message(&app, "贴纸操作失败", &err);
                        }
                    });
                }
                IDM_COPY_IMAGE => {
                    thread::spawn(move || {
                        if let Err(err) =
                            crate::stickers::commands::copy_sticker_by_id(&app, &sticker_id)
                        {
                            eprintln!("[TIDYDESK] Failed to copy sticker {sticker_id}: {err}");
                            crate::stickers::notify_sticker_message(&app, "复制贴纸失败", &err);
                        }
                    });
                }
                IDM_SAVE_AS => {
                    thread::spawn(move || {
                        if let Err(err) =
                            crate::stickers::commands::save_sticker_as_by_id(&app, &sticker_id)
                        {
                            eprintln!("[TIDYDESK] Failed to save sticker {sticker_id}: {err}");
                            crate::stickers::notify_sticker_message(&app, "保存贴纸失败", &err);
                        }
                    });
                }
                IDM_CLOSE_STICKER => {
                    thread::spawn(move || {
                        if let Err(err) =
                            crate::stickers::commands::close_sticker_by_id(&app, &sticker_id)
                        {
                            eprintln!("[TIDYDESK] Failed to close sticker {sticker_id}: {err}");
                            crate::stickers::notify_sticker_message(&app, "关闭贴纸失败", &err);
                        }
                    });
                }
                _ => {}
            }
        }
    }

    fn schedule_bounds_persist(hwnd: HWND) {
        let info = THREAD_STATE.with(|state| {
            let mut state = state.borrow_mut();
            let id = state.id_by_hwnd.get(&(hwnd.0 as isize))?.clone();
            let entry = state.by_id.get_mut(&id)?;
            let mut rect = RECT::default();
            unsafe {
                if GetWindowRect(hwnd, &mut rect).is_ok() {
                    entry.bounds = StickerWindowBounds {
                        x: rect.left,
                        y: rect.top,
                        width: (rect.right - rect.left).max(1) as u32,
                        height: (rect.bottom - rect.top).max(1) as u32,
                    };
                }
            }
            Some((
                entry.app.clone(),
                id,
                entry.bounds.clone(),
                entry.debounce.clone(),
            ))
        });

        let Some((app, sticker_id, latest_bounds, debounce)) = info else {
            return;
        };

        let should_spawn = {
            let Ok(mut guard) = debounce.lock() else {
                return;
            };
            guard.sequence = guard.sequence.saturating_add(1);
            guard.latest_bounds = latest_bounds;
            if guard.running {
                false
            } else {
                guard.running = true;
                true
            }
        };

        if !should_spawn {
            return;
        }

        thread::spawn(move || loop {
            let target_seq = match debounce.lock() {
                Ok(guard) => guard.sequence,
                Err(_) => return,
            };
            thread::sleep(Duration::from_millis(250));
            let settled_bounds = {
                let Ok(mut guard) = debounce.lock() else {
                    return;
                };
                if guard.sequence == target_seq {
                    guard.running = false;
                    Some(guard.latest_bounds.clone())
                } else {
                    None
                }
            };
            let Some(final_bounds) = settled_bounds else {
                continue;
            };
            let _ = mutate_sticker_state(&app, |state| {
                if let Some(record) = state.stickers.iter_mut().find(|item| item.id == sticker_id) {
                    record.bounds = final_bounds.clone();
                }
                Ok(())
            });
            break;
        });
    }

    fn hit_test_rect(rect: &RECT, x: i32, y: i32) -> isize {
        let left = (x - rect.left) < RESIZE_BORDER_PX;
        let right = (rect.right - x) < RESIZE_BORDER_PX;
        let top = (y - rect.top) < RESIZE_BORDER_PX;
        let bottom = (rect.bottom - y) < RESIZE_BORDER_PX;

        match (left, right, top, bottom) {
            (true, _, true, _) => HTTOPLEFT as isize,
            (_, true, true, _) => HTTOPRIGHT as isize,
            (true, _, _, true) => HTBOTTOMLEFT as isize,
            (_, true, _, true) => HTBOTTOMRIGHT as isize,
            (true, _, _, _) => HTLEFT as isize,
            (_, true, _, _) => HTRIGHT as isize,
            (_, _, true, _) => HTTOP as isize,
            (_, _, _, true) => HTBOTTOM as isize,
            _ => HTCAPTION as isize,
        }
    }

    unsafe extern "system" fn sticker_wnd_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match msg {
            WM_APP_PROCESS_COMMANDS => {
                drain_pending_commands();
                LRESULT(0)
            }
            WM_NCHITTEST => {
                let mut rect = RECT::default();
                if GetWindowRect(hwnd, &mut rect).is_ok() {
                    let x = (lparam.0 & 0xFFFF) as i16 as i32;
                    let y = ((lparam.0 >> 16) & 0xFFFF) as i16 as i32;
                    return LRESULT(hit_test_rect(&rect, x, y));
                }
                LRESULT(HTCAPTION as isize)
            }
            WM_GETMINMAXINFO => {
                let info = &mut *(lparam.0 as *mut MINMAXINFO);
                info.ptMinTrackSize.x = MIN_STICKER_SIZE_PX;
                info.ptMinTrackSize.y = MIN_STICKER_SIZE_PX;
                LRESULT(0)
            }
            WM_NCLBUTTONDBLCLK | WM_NCRBUTTONDOWN | WM_CONTEXTMENU => LRESULT(0),
            WM_NCRBUTTONUP | WM_RBUTTONUP => {
                show_context_menu(hwnd);
                LRESULT(0)
            }
            WM_SIZE => {
                let width = (lparam.0 & 0xFFFF) as u32;
                let height = ((lparam.0 >> 16) & 0xFFFF) as u32;
                if width > 0 && height > 0 {
                    THREAD_STATE.with(|state| {
                        let mut state = state.borrow_mut();
                        if let Some(id) = state.id_by_hwnd.get(&(hwnd.0 as isize)).cloned() {
                            if let Some(entry) = state.by_id.get_mut(&id) {
                                entry.bounds.width = width;
                                entry.bounds.height = height;
                            }
                        }
                    });
                    let _ = render_sticker_hwnd(hwnd, FilterType::Triangle);
                }
                LRESULT(0)
            }
            WM_EXITSIZEMOVE => {
                let _ = render_sticker_hwnd(hwnd, FilterType::Lanczos3);
                schedule_bounds_persist(hwnd);
                LRESULT(0)
            }
            WM_DESTROY => {
                THREAD_STATE.with(|state| {
                    let mut state = state.borrow_mut();
                    if let Some(id) = state.id_by_hwnd.remove(&(hwnd.0 as isize)) {
                        state.by_id.remove(&id);
                    }
                });
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }
}

#[cfg(target_os = "windows")]
pub use win32_impl::{close_native_sticker, ensure_native_sticker, update_native_sticker_pin};

#[cfg(not(target_os = "windows"))]
pub fn ensure_native_sticker(_app: &AppHandle, _sticker: &StickerRecord) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn update_native_sticker_pin(_sticker_id: &str, _always_on_top: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn close_native_sticker(_sticker_id: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn premultiply_interior_pixel_uses_bgra_order_and_alpha_scaling() {
        // 5x5 image so center (2, 2) is strictly an interior pixel without 1px rim overlay
        let mut rgba = vec![0u8; 5 * 5 * 4];
        let center = (2 * 5 + 2) * 4;
        rgba[center] = 200; // R
        rgba[center + 1] = 100; // G
        rgba[center + 2] = 50; // B
        rgba[center + 3] = 128; // A (~50%)

        let bgra = rgba_to_premultiplied_bgra(&rgba, 5, 5, false);
        assert_eq!(bgra[center], ((50u16 * 128 + 127) / 255) as u8); // B premultiplied
        assert_eq!(bgra[center + 1], ((100u16 * 128 + 127) / 255) as u8); // G premultiplied
        assert_eq!(bgra[center + 2], ((200u16 * 128 + 127) / 255) as u8); // R premultiplied
        assert_eq!(bgra[center + 3], 128); // A
    }
}
