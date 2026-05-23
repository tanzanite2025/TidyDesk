const { app, ipcMain, shell, screen, clipboard, globalShortcut } = require('electron');
const os = require('os');
const CONFIG = require('./config.cjs');
const resident = require('./resident.cjs');
const createDrawerService = require('./services/drawers.cjs');
const createAppCacheService = require('./services/app-cache.cjs');
const createAppService = require('./services/apps.cjs');
const createStickerService = require('./services/stickers.cjs');
const createTodoService = require('./services/todos.cjs');
const createUpdateService = require('./services/updates.cjs');
const createWindowService = require('./services/windows.cjs');

app.setName('TidyDesk');

let windowService;
const todoService = createTodoService({ app });
const drawerService = createDrawerService({
  app,
  shell,
  config: CONFIG,
  notifyDrawer: (channel, payload) => {
    windowService?.sendTo('drawer', channel, payload);
  }
});
const appCache = createAppCacheService({ app });
const appService = createAppService({
  app,
  shell,
  config: CONFIG,
  getDesktopPath: drawerService.getDesktopPath,
  appCache
});
const stickerService = createStickerService({
  app,
  electronDir: __dirname
});
stickerService.registerIpcHandlers(ipcMain);
const updateService = createUpdateService({
  app,
  notifyUpdate: (payload) => {
    windowService?.sendTo('drawer', 'update-status', payload);
  }
});
updateService.registerIpcHandlers(ipcMain);

// Windows 版本检测
const isWindows11 = () => {
  if (process.platform !== 'win32') return false;
  const release = os.release();
  // Windows 11 的版本号是 10.0.22000 或更高
  const match = release.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (match) {
    const [, major, minor, build] = match;
    return parseInt(major) === 10 && parseInt(minor) === 0 && parseInt(build) >= 22000;
  }
  return false;
};

windowService = createWindowService({
  app,
  config: CONFIG,
  electronDir: __dirname,
  isWindows11,
  onTodoPanelOpened: () => {
    broadcastTodoCounts().catch(err => console.warn('[TIDYDESK] Failed to broadcast todo counts', err.message));
  }
});

function prepareStorage() {
  drawerService.prepareStorage();
  todoService.ensureStorage();
  stickerService.ensureStorage();
}

function registerGlobalShortcuts() {
  const shortcuts = [
    ['CommandOrControl+Alt+D', () => windowService.toggleFiles()],
    ['CommandOrControl+Alt+K', () => windowService.openTodoPanel()],
    ['CommandOrControl+Alt+N', () => windowService.openCapturePanel()],
    ['CommandOrControl+Alt+S', () => stickerService.startScreenshot()],
    ['CommandOrControl+Alt+Q', () => {
      // 强制退出快捷键
      console.log('[TIDYDESK] Force quit requested via shortcut');
      const resident = require('./resident.cjs');
      resident.setQuitting(true);
      app.quit();
    }]
  ];

  for (const [accelerator, handler] of shortcuts) {
    const registered = globalShortcut.register(accelerator, handler);
    if (!registered) {
      console.warn(`[TIDYDESK] Failed to register shortcut: ${accelerator}`);
    } else {
      console.log(`[TIDYDESK] Registered shortcut: ${accelerator}`);
    }
  }
}

app.whenReady().then(() => {
  prepareStorage();
  console.log(`[TIDYDESK] Platform: ${process.platform}`);
  console.log(`[TIDYDESK] OS: ${os.type()} ${os.release()}`);
  console.log(`[TIDYDESK] Windows 11: ${isWindows11()}`);
  console.log(`[TIDYDESK] Desktop: "${drawerService.getDesktopPath()}"`);
  console.log(`[TIDYDESK] Drawers: "${drawerService.getDrawerRoot()}"`);
  
  const display = screen.getPrimaryDisplay();
  console.log(`[TIDYDESK] Display: ${display.size.width}x${display.size.height}, Scale: ${display.scaleFactor}`);
  
  // 初始化文件监控
  drawerService.initializeFileWatcher();
  
  // 启动定期验证
  drawerService.startPeriodicValidation();
  
  windowService.createWindows();
  stickerService.restoreStickers();
  registerGlobalShortcuts();
  
  // 初始化常驻机制（必须在创建窗口之后）
  const residentInitialized = resident.initializeResident(
    windowService.getHandleWindow(),
    windowService.getDrawerWindow(),
    windowService.getAuxiliaryWindows()
  );
  if (!residentInitialized) {
    // 如果初始化失败（例如已有实例在运行），应用会自动退出
    return;
  }
  
  // 检查更新（延迟 3 秒，避免启动时卡顿）
  setTimeout(() => {
    updateService.checkForUpdates();
  }, 3000);

  app.on('activate', () => {
    if (!windowService.hasWindows()) windowService.createWindows();
  });
});

app.on('window-all-closed', () => {
  // 不再自动退出，由常驻机制管理
  console.log('[TIDYDESK] All windows closed, app continues running in tray');
});

app.on('before-quit', () => {
  // 只有真正退出时才清理资源
  if (!resident.isAppQuitting()) {
    console.log('[TIDYDESK] Quit prevented by resident mechanism');
    return;
  }
  
  console.log('[TIDYDESK] App is quitting, cleaning up resources...');
  
  drawerService.cleanup();
  stickerService.cleanup();
  globalShortcut.unregisterAll();
  
  // 清理常驻机制
  resident.cleanupResident();
});

// 全局错误处理
process.on('uncaughtException', (error) => {
  console.error('[TIDYDESK] Uncaught Exception:', error);
  // 不退出应用，让用户可以保存工作
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[TIDYDESK] Unhandled Rejection at:', promise, 'reason:', reason);
});

ipcMain.handle('read-desktop-files', async () => drawerService.readDesktopFiles());

ipcMain.handle('create-desktop-folder', async (_event, name) => {
  return drawerService.createDesktopFolder(name);
});

ipcMain.handle('rename-desktop-item', async (_event, payload) => {
  return drawerService.renameDesktopItem(payload);
});

ipcMain.handle('delete-desktop-item', async (_event, payload) => {
  return drawerService.deleteDesktopItem(payload);
});

ipcMain.handle('move-desktop-file', async () => {
  throw new Error('Physical file moving is disabled in stable shortcut mode.');
});

ipcMain.handle('tidy-desktop-batch', async () => {
  throw new Error('Batch physical tidy is disabled in stable shortcut mode.');
});

ipcMain.handle('import-external-files', async (_event, payload) => {
  return drawerService.importExternalFiles(payload);
});

ipcMain.handle('open-desktop-file', async (_event, filePath) => {
  return drawerService.openDesktopFile(filePath);
});

ipcMain.handle('restore-to-desktop', async (_event, payload) => {
  return drawerService.restoreToDesktop(payload);
});
// 扫描已安装的应用程序
ipcMain.handle('scan-installed-apps', async () => {
  try {
    const apps = await appService.scanInstalledApps();
    return { success: true, apps };
  } catch (err) {
    console.error('[TIDYDESK] Failed to scan installed apps:', err);
    return { success: false, error: err.message, apps: [] };
  }
});

// 刷新应用列表（强制重新扫描）
ipcMain.handle('refresh-apps', async () => {
  try {
    const apps = await appService.refreshApps();
    return { success: true, apps };
  } catch (err) {
    console.error('[TIDYDESK] Failed to refresh apps:', err);
    return { success: false, error: err.message, apps: [] };
  }
});

// 获取缓存信息
ipcMain.handle('get-cache-info', async () => {
  try {
    const info = await appCache.getCacheInfo();
    return { success: true, info };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 打开应用选择器
ipcMain.handle('open-app-picker', async (_event, { targetFolder }) => {
  try {
    windowService.openAppPicker(targetFolder);
    return { success: true };
  } catch (err) {
    console.error('[TIDYDESK] Failed to open app picker:', err);
    throw err;
  }
});

// 关闭应用选择器
ipcMain.handle('close-app-picker', async () => {
  try {
    windowService.closeAppPicker();
    return { success: true };
  } catch (err) {
    console.error('[TIDYDESK] Failed to close app picker:', err);
    throw err;
  }
});

// 获取应用选择器的目标文件夹
ipcMain.handle('get-app-picker-target', async () => {
  return { targetFolder: windowService.getAppPickerTarget() };
});

// 添加应用到抽屉
ipcMain.handle('add-app-to-drawer', async (_event, { shortcutPath, targetFolder }) => {
  return drawerService.addAppToDrawer({ shortcutPath, targetFolder });
});

ipcMain.handle('todo-read-state', async () => {
  return todoService.getState();
});

ipcMain.handle('todo-get-counts', async () => {
  return todoService.getCounts();
});

ipcMain.handle('todo-create-card', async (_event, payload) => {
  const state = await todoService.createCard(payload);
  await broadcastTodoCounts();
  return state;
});

ipcMain.handle('todo-update-card', async (_event, payload) => {
  const state = await todoService.updateCard(payload);
  await broadcastTodoCounts();
  return state;
});

ipcMain.handle('todo-delete-card', async (_event, cardId) => {
  if (!cardId || typeof cardId !== 'string') throw new Error('Missing todo card id');
  const state = await todoService.deleteCard(cardId);
  await broadcastTodoCounts();
  return state;
});

ipcMain.handle('todo-move-card', async (_event, payload) => {
  const state = await todoService.moveCard(payload);
  await broadcastTodoCounts();
  return state;
});

ipcMain.handle('clipboard-read-text', async () => {
  return clipboard.readText();
});

ipcMain.on('window-control', (_event, action) => {
  if (action === 'close') {
    windowService.closeAll();
  }
  if (action === 'minimize') {
    windowService.minimizeAll();
  }
  if (action === 'expand-drawer') windowService.expandDrawer();
  if (action === 'collapse-drawer') windowService.collapseDrawer();
  if (action === 'toggle-drawer') windowService.toggleDrawer();
  if (action === 'open-files') windowService.toggleFiles();
  if (action === 'open-todos') windowService.openTodoPanel();
  if (action === 'open-capture') windowService.openCapturePanel();
  if (action === 'start-screenshot') stickerService.startScreenshot();
  if (action === 'close-panel') windowService.closeActiveModule();
});

// 手动触发验证所有快捷方式
ipcMain.handle('validate-all-shortcuts', async () => {
  console.log('[TIDYDESK] Manual validation triggered');
  return drawerService.validateAllShortcuts();
});

// 尝试修复单个快捷方式
ipcMain.handle('repair-shortcut', async (_event, { shortcutPath, targetPath }) => {
  return drawerService.repairShortcut({ shortcutPath, targetPath });
});
