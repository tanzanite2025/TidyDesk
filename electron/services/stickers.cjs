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
    if (snipWindow && !snipWindow.isDestroyed()) {
      snipWindow.focus();
      return;
    }

    const display = screen.getPrimaryDisplay();
    snipWindow = new BrowserWindow({
      ...display.bounds,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
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
        contextIsolation: true
      }
    });

    snipWindow.setAlwaysOnTop(true, 'screen-saver');
    loadRenderer(snipWindow, 'snip');
    snipWindow.on('closed', () => {
      snipWindow = null;
    });
  }

  function startScreenshot() {
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
    const rect = normalizeRect(rectPayload);
    const display = screen.getPrimaryDisplay();
    const scaleFactor = display.scaleFactor || 1;

    if (snipWindow && !snipWindow.isDestroyed()) {
      snipWindow.hide();
    }

    await new Promise(resolve => setTimeout(resolve, 140));

    const captureSize = {
      width: Math.round(display.bounds.width * scaleFactor),
      height: Math.round(display.bounds.height * scaleFactor)
    };
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: captureSize
    });

    const source = sources.find(item => item.display_id === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      closeSnipWindow();
      throw new Error('Unable to capture screen');
    }

    const cropped = source.thumbnail.crop({
      x: Math.max(0, Math.round(rect.x * scaleFactor)),
      y: Math.max(0, Math.round(rect.y * scaleFactor)),
      width: Math.max(1, Math.round(rect.width * scaleFactor)),
      height: Math.max(1, Math.round(rect.height * scaleFactor))
    });

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const imagePath = path.join(getImageRoot(), `${id}.png`);
    fs.writeFileSync(imagePath, cropped.toPNG());

    const stickerBounds = getInitialStickerBounds(rect, display);
    const sticker = {
      id,
      imagePath,
      bounds: stickerBounds,
      alwaysOnTop: true,
      createdAt: new Date().toISOString()
    };

    updateStickerRecord(sticker);
    createStickerWindow(sticker);
    closeSnipWindow();

    return { success: true, stickerId: id };
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
      win.setAlwaysOnTop(true, 'floating');
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
      win.setAlwaysOnTop(sticker.alwaysOnTop, sticker.alwaysOnTop ? 'floating' : 'normal');
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
