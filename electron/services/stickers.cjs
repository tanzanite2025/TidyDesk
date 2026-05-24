const path = require('path');
const fs = require('fs');
const {
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  nativeImage,
  screen
} = require('electron');

function createStickerService({ app, electronDir }) {
  let snipWindow = null;
  const stickerWindows = new Map();

  function getStickerRoot() {
    return path.join(app.getPath('userData'), 'stickers');
  }

  function getImageRoot() {
    return path.join(getStickerRoot(), 'images');
  }

  function getStatePath() {
    return path.join(getStickerRoot(), 'stickers.json');
  }

  function ensureStorage() {
    fs.mkdirSync(getImageRoot(), { recursive: true });
    if (!fs.existsSync(getStatePath())) {
      fs.writeFileSync(getStatePath(), JSON.stringify({ stickers: [] }, null, 2));
    }
  }

  function readState() {
    ensureStorage();
    try {
      const parsed = JSON.parse(fs.readFileSync(getStatePath(), 'utf8'));
      return {
        stickers: Array.isArray(parsed.stickers) ? parsed.stickers : []
      };
    } catch (err) {
      console.warn('[TIDYDESK] Failed to read sticker state, resetting', err.message);
      return { stickers: [] };
    }
  }

  function writeState(state) {
    ensureStorage();
    fs.writeFileSync(getStatePath(), JSON.stringify(state, null, 2));
  }

  function updateStickerRecord(sticker) {
    const state = readState();
    const index = state.stickers.findIndex(item => item.id === sticker.id);
    if (index >= 0) {
      state.stickers[index] = sticker;
    } else {
      state.stickers.push(sticker);
    }
    writeState(state);
  }

  function removeStickerRecord(stickerId) {
    const state = readState();
    const sticker = state.stickers.find(item => item.id === stickerId);
    writeState({
      stickers: state.stickers.filter(item => item.id !== stickerId)
    });
    return sticker || null;
  }

  function loadRenderer(win, mode, query = {}) {
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    const searchParams = new URLSearchParams({ mode, ...query });
    if (isDev) {
      win.loadURL(`http://localhost:3000?${searchParams.toString()}`);
    } else {
      win.loadFile(path.join(electronDir, '../dist/index.html'), { query: Object.fromEntries(searchParams) });
    }
  }

  function createSnipWindow() {
    console.log('[STICKER] createSnipWindow called');
    if (snipWindow && !snipWindow.isDestroyed()) {
      console.log('[STICKER] Snip window already exists, focusing');
      snipWindow.focus();
      return;
    }

    const display = screen.getPrimaryDisplay();
    console.log('[STICKER] Display info:', {
      id: display.id,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor
    });

    snipWindow = new BrowserWindow({
      ...display.bounds,
      frame: false,
      transparent: true,
      backgroundColor: '#2E000000',  // ARGB: 2E = 18% opacity (46/255)
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(electronDir, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,  // 防止后台节流影响渲染
        offscreen: false  // 确保使用正常渲染模式
      }
    });

    console.log('[STICKER] Snip window created with ARGB background');
    
    // 使用 ARGB 背景色，不需要额外设置
    snipWindow.setAlwaysOnTop(true, 'screen-saver');
    
    // 添加调试信息
    console.log('[STICKER] Window properties:', {
      opacity: snipWindow.getOpacity(),
      backgroundColor: snipWindow.getBackgroundColor(),
      bounds: snipWindow.getBounds()
    });

    loadRenderer(snipWindow, 'snip');
    console.log('[STICKER] Snip window renderer loaded');
    
    // 添加加载完成事件监听
    snipWindow.webContents.on('did-finish-load', () => {
      console.log('[STICKER] Snip window content loaded');
    });
    
    snipWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('[STICKER] Snip window failed to load:', errorCode, errorDescription);
    });
    
    snipWindow.on('closed', () => {
      console.log('[STICKER] Snip window closed');
      snipWindow = null;
    });
  }

  function startScreenshot() {
    console.log('[STICKER] startScreenshot called');
    createSnipWindow();
  }

  function closeSnipWindow() {
    if (snipWindow && !snipWindow.isDestroyed()) {
      snipWindow.close();
    }
    snipWindow = null;
  }

  function normalizeRect(rect) {
    const x = Number(rect?.x);
    const y = Number(rect?.y);
    const width = Number(rect?.width);
    const height = Number(rect?.height);
    if (![x, y, width, height].every(Number.isFinite)) {
      throw new Error('Invalid snip rectangle');
    }
    if (width < 8 || height < 8) {
      throw new Error('Snip rectangle is too small');
    }
    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height)
    };
  }

  async function captureSelection(rectPayload) {
    console.log('[STICKER] captureSelection called:', rectPayload);
    try {
      const rect = normalizeRect(rectPayload);
      console.log('[STICKER] Normalized rect:', rect);
      const display = screen.getPrimaryDisplay();
      const scaleFactor = display.scaleFactor || 1;
      console.log('[STICKER] Scale factor:', scaleFactor);

      if (snipWindow && !snipWindow.isDestroyed()) {
        console.log('[STICKER] Hiding snip window');
        snipWindow.hide();
      }

      await new Promise(resolve => setTimeout(resolve, 140));

      const captureSize = {
        width: Math.round(display.bounds.width * scaleFactor),
        height: Math.round(display.bounds.height * scaleFactor)
      };
      console.log('[STICKER] Capture size:', captureSize);
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: captureSize
      });
      console.log('[STICKER] Got', sources.length, 'sources');

      const source = sources.find(item => item.display_id === String(display.id)) || sources[0];
      if (!source || source.thumbnail.isEmpty()) {
        console.error('[STICKER] No valid source found');
        closeSnipWindow();
        throw new Error('Unable to capture screen');
      }
      console.log('[STICKER] Using source:', source.name);

      const cropped = source.thumbnail.crop({
        x: Math.max(0, Math.round(rect.x * scaleFactor)),
        y: Math.max(0, Math.round(rect.y * scaleFactor)),
        width: Math.max(1, Math.round(rect.width * scaleFactor)),
        height: Math.max(1, Math.round(rect.height * scaleFactor))
      });
      console.log('[STICKER] Image cropped');

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const imagePath = path.join(getImageRoot(), `${id}.png`);
      console.log('[STICKER] Saving to:', imagePath);
      fs.writeFileSync(imagePath, cropped.toPNG());
      console.log('[STICKER] Image saved, size:', fs.statSync(imagePath).size);

      const stickerBounds = getInitialStickerBounds(rect, display);
      console.log('[STICKER] Sticker bounds:', stickerBounds);
      const sticker = {
        id,
        imagePath,
        bounds: stickerBounds,
        alwaysOnTop: false,  // 默认不置顶，避免挡住其他窗口
        createdAt: new Date().toISOString()
      };

      updateStickerRecord(sticker);
      console.log('[STICKER] Sticker record updated');
      createStickerWindow(sticker);
      console.log('[STICKER] Sticker window created');
      closeSnipWindow();
      console.log('[STICKER] Snip window closed');

      return { success: true, stickerId: id };
    } catch (error) {
      console.error('[STICKER] captureSelection error:', error);
      closeSnipWindow();
      throw error;
    }
  }

  function getInitialStickerBounds(rect, display) {
    const minWidth = 160;
    const minHeight = 100;
    const maxWidth = Math.min(720, display.workArea.width - 80);
    const maxHeight = Math.min(520, display.workArea.height - 80);
    const ratio = Math.min(maxWidth / rect.width, maxHeight / rect.height, 1);
    const width = Math.max(minWidth, Math.round(rect.width * ratio));
    const height = Math.max(minHeight, Math.round(rect.height * ratio));
    const preferredX = display.bounds.x + rect.x + 24;
    const preferredY = display.bounds.y + rect.y + 24;
    const x = Math.min(Math.max(display.workArea.x + 24, preferredX), display.workArea.x + display.workArea.width - width - 24);
    const y = Math.min(Math.max(display.workArea.y + 24, preferredY), display.workArea.y + display.workArea.height - height - 24);

    return { x, y, width, height };
  }

  function createStickerWindow(sticker) {
    if (!sticker || !fs.existsSync(sticker.imagePath)) return null;

    const existing = stickerWindows.get(sticker.id);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return existing;
    }

    const win = new BrowserWindow({
      ...sticker.bounds,
      minWidth: 120,
      minHeight: 80,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: true,
      alwaysOnTop: Boolean(sticker.alwaysOnTop),
      skipTaskbar: true,
      resizable: true,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(electronDir, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    if (sticker.alwaysOnTop) {
      win.setAlwaysOnTop(true, 'normal');  // 使用 normal 级别，不会挡住所有窗口
    }

    loadRenderer(win, 'sticker', { id: sticker.id });
    stickerWindows.set(sticker.id, win);

    let persistTimer = null;
    const persistBounds = () => {
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        const state = readState();
        const next = state.stickers.find(item => item.id === sticker.id);
        if (!next || win.isDestroyed()) return;
        next.bounds = win.getBounds();
        writeState(state);
      }, 250);
    };

    win.on('move', persistBounds);
    win.on('resize', persistBounds);
    win.on('closed', () => {
      if (persistTimer) clearTimeout(persistTimer);
      stickerWindows.delete(sticker.id);
    });

    return win;
  }

  function restoreStickers() {
    const state = readState();
    for (const sticker of state.stickers) {
      createStickerWindow(sticker);
    }
  }

  function getSticker(stickerId) {
    const state = readState();
    const sticker = state.stickers.find(item => item.id === stickerId);
    if (!sticker || !fs.existsSync(sticker.imagePath)) {
      return null;
    }

    const imageDataUrl = `data:image/png;base64,${fs.readFileSync(sticker.imagePath).toString('base64')}`;
    return {
      id: sticker.id,
      imageDataUrl,
      alwaysOnTop: Boolean(sticker.alwaysOnTop),
      createdAt: sticker.createdAt
    };
  }

  function toggleStickerAlwaysOnTop(stickerId) {
    const state = readState();
    const sticker = state.stickers.find(item => item.id === stickerId);
    if (!sticker) return { success: false };

    sticker.alwaysOnTop = !sticker.alwaysOnTop;
    writeState(state);

    const win = stickerWindows.get(stickerId);
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(sticker.alwaysOnTop, sticker.alwaysOnTop ? 'normal' : 'normal');  // 使用 normal 级别
      win.webContents.send('sticker-updated', {
        id: stickerId,
        alwaysOnTop: sticker.alwaysOnTop
      });
    }

    return { success: true, alwaysOnTop: sticker.alwaysOnTop };
  }

  function copySticker(stickerId) {
    const state = readState();
    const sticker = state.stickers.find(item => item.id === stickerId);
    if (!sticker || !fs.existsSync(sticker.imagePath)) return { success: false };

    clipboard.writeImage(nativeImage.createFromPath(sticker.imagePath));
    return { success: true };
  }

  async function saveStickerAs(stickerId) {
    const state = readState();
    const sticker = state.stickers.find(item => item.id === stickerId);
    if (!sticker || !fs.existsSync(sticker.imagePath)) return { success: false };

    const result = await dialog.showSaveDialog({
      title: '保存截图贴纸',
      defaultPath: path.join(app.getPath('pictures'), `TidyDesk-${stickerId}.png`),
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    });

    if (result.canceled || !result.filePath) return { success: false, canceled: true };

    await fs.promises.copyFile(sticker.imagePath, result.filePath);
    return { success: true, filePath: result.filePath };
  }

  function closeSticker(stickerId) {
    const sticker = removeStickerRecord(stickerId);
    const win = stickerWindows.get(stickerId);
    if (win && !win.isDestroyed()) {
      win.close();
    }
    if (sticker?.imagePath && fs.existsSync(sticker.imagePath)) {
      fs.promises.unlink(sticker.imagePath).catch(err => {
        console.warn('[TIDYDESK] Failed to delete sticker image', err.message);
      });
    }
    return { success: true };
  }

  function cleanup() {
    closeSnipWindow();
    for (const win of stickerWindows.values()) {
      if (win && !win.isDestroyed()) win.close();
    }
    stickerWindows.clear();
  }

  function registerIpcHandlers(ipcMain) {
    ipcMain.handle('snip-complete-selection', async (_event, rect) => captureSelection(rect));
    ipcMain.handle('snip-cancel', async () => {
      closeSnipWindow();
      return { success: true };
    });
    ipcMain.handle('sticker-get', async (_event, stickerId) => getSticker(stickerId));
    ipcMain.handle('sticker-toggle-pin', async (_event, stickerId) => toggleStickerAlwaysOnTop(stickerId));
    ipcMain.handle('sticker-copy', async (_event, stickerId) => copySticker(stickerId));
    ipcMain.handle('sticker-save-as', async (_event, stickerId) => saveStickerAs(stickerId));
    ipcMain.handle('sticker-close', async (_event, stickerId) => closeSticker(stickerId));
  }

  return {
    ensureStorage,
    startScreenshot,
    restoreStickers,
    cleanup,
    registerIpcHandlers
  };
}

module.exports = createStickerService;
