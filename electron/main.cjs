const { app, ipcMain, shell, screen, clipboard, globalShortcut } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CONFIG = require('./config.cjs');
const resident = require('./resident.cjs');
const createDrawerService = require('./services/drawers.cjs');
const createAppCacheService = require('./services/app-cache.cjs');
const createAppService = require('./services/apps.cjs');
const createStickerService = require('./services/stickers.cjs');
const createTodoService = require('./services/todos.cjs');
const createUpdateService = require('./services/updates.cjs');
const createWindowService = require('./services/windows.cjs');
const { createAppsCacheSidecarClient } = require('./services/go-sidecar-client.cjs');
const RegistryWatcher = require('./services/registry-watcher.cjs');
const { PerformanceCore, ResourceManager } = require('./services/performance/index.cjs');

app.setName('TidyDesk');

// 性能管理系统
let performanceCore = null;
let resourceManager = null;

let windowService;
let registryWatcher = null;
let backgroundScanTimer = null;
let dailyScanTimer = null;
let goAppsClient = null;
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
const goAppsSidecarPath = app.isPackaged
  ? path.join(process.resourcesPath, 'sidecars', 'apps-cache', 'tidydesk-apps-cache.exe')
  : path.join(__dirname, '..', 'sidecars', 'apps-cache', 'tidydesk-apps-cache.exe');
if (fs.existsSync(goAppsSidecarPath)) {
  goAppsClient = createAppsCacheSidecarClient({ app, executablePath: goAppsSidecarPath });
  console.log('[TIDYDESK] Go apps sidecar enabled');
} else {
  console.error(`[TIDYDESK] Go apps sidecar was not found: ${goAppsSidecarPath}`);
}
const appService = createAppService({
  app,
  shell,
  config: CONFIG,
  getDesktopPath: drawerService.getDesktopPath,
  appCache,
  performanceCore: null, // 稍后设置
  goAppsClient
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

async function broadcastTodoCounts() {
  try {
    const counts = await todoService.getCounts();
    windowService.sendTo('drawer', 'todo-counts', counts);
    windowService.sendTo('handle', 'todo-counts', counts);
  } catch (err) {
    console.error('[TIDYDESK] Failed to get todo counts:', err);
  }
}

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

async function validateGoAppsSidecar() {
  if (!goAppsClient) {
    console.error('[TIDYDESK] Go apps sidecar is unavailable; app scanning will fail until the sidecar is built.');
    return;
  }

  try {
    const ping = await goAppsClient.ping();
    const version = await goAppsClient.getVersion();
    const health = await goAppsClient.getHealth();
    console.log('[TIDYDESK] Go apps sidecar validated:', {
      ping,
      name: version?.name,
      version: version?.version,
      protocolVersion: version?.protocolVersion,
      status: health?.status,
      methods: Array.isArray(version?.methods) ? version.methods.length : 0
    });
  } catch (err) {
    console.error('[TIDYDESK] Go apps sidecar validation failed:', err.message);
  }
}

app.whenReady().then(() => {
  // 添加子进程崩溃处理
  app.on('child-process-gone', (event, details) => {
    console.warn('[TIDYDESK] Child process gone:', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      name: details.name
    });
    
    // Network service 崩溃是常见的，Electron 会自动重启，不需要特殊处理
    if (details.type === 'Utility' && details.name === 'network.mojom.NetworkService') {
      console.log('[TIDYDESK] Network service crashed, Electron will restart it automatically');
    }
  });
  
  // 初始化性能管理系统
  console.log('[TIDYDESK] Initializing performance management system...');
  performanceCore = new PerformanceCore({
    monitor: {
      sampleInterval: 30000, // 从 5 秒改为 30 秒，减少采样频率
      historySize: 60,
      processName: app.isPackaged ? 'TidyDesk.exe' : 'electron.exe'
    },
    health: {
      checkInterval: 60000 // 从 30 秒改为 60 秒
    },
    lightCpuThreshold: 30,
    lightMemoryThreshold: 200 * 1024 * 1024,
    lightHandleThreshold: 800,
    heavyCpuThreshold: 50,
    heavyMemoryThreshold: 300 * 1024 * 1024,
    heavyHandleThreshold: 1000
  });
  
  resourceManager = new ResourceManager();
  
  // 监听性能事件
  performanceCore.on('health-issues', (issues) => {
    console.warn('[TIDYDESK] Performance health issues detected:', issues);
    
    // 如果有严重问题，通知用户
    const criticalIssues = issues.filter(i => i.severity === 'critical');
    if (criticalIssues.length > 0 && windowService) {
      windowService.sendTo('drawer', 'performance-warning', {
        message: '检测到性能问题，建议重启应用',
        issues: criticalIssues
      });
    }
  });
  
  performanceCore.on('degradation', (info) => {
    console.log(`[TIDYDESK] Performance degradation: ${info.levelName} (level ${info.level})`);
    console.log('[TIDYDESK] Actions:', info.actions);
    
    // 通知前端降级状态
    if (windowService) {
      windowService.sendTo('drawer', 'performance-degradation', info);
    }
  });
  
  performanceCore.on('recommend-restart', (issue) => {
    console.warn('[TIDYDESK] Restart recommended:', issue);
  });
  
  // 启动性能监控
  performanceCore.start();
  console.log('[TIDYDESK] Performance management system started');
  
  // 调试：输出句柄信息
  setTimeout(() => {
    if (process._getActiveHandles) {
      const handles = process._getActiveHandles();
      console.log(`[TIDYDESK] Active handles: ${handles.length}`);
      
      const types = {};
      handles.forEach(h => {
        const type = h.constructor.name;
        types[type] = (types[type] || 0) + 1;
      });
      
      console.log('[TIDYDESK] Handle types:', types);
    }
    
    if (process._getActiveRequests) {
      console.log(`[TIDYDESK] Active requests: ${process._getActiveRequests().length}`);
    }
  }, 10000); // 10 秒后输出
  
  // 将 performanceCore 注入到 appService
  if (appService.setPerformanceCore) {
    appService.setPerformanceCore(performanceCore);
  }

  validateGoAppsSidecar();
  
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
  
  // 后台扫描应用（延迟 10 秒，避免影响启动性能）
  backgroundScanTimer = setTimeout(async () => {
    console.log('[TIDYDESK] Background app scan started');
    try {
      const startTime = Date.now();
      await appService.refreshApps();
      const duration = Date.now() - startTime;
      console.log(`[TIDYDESK] Background app scan completed in ${duration}ms`);
    } catch (err) {
      console.error('[TIDYDESK] Background app scan failed:', err);
    }
  }, 10000);
  
  // 注册到资源管理器
  resourceManager.registerTimer(backgroundScanTimer, 'background-app-scan');
  
  // 启动注册表监听（延迟 15 秒，在后台扫描完成后）
  if (process.platform === 'win32') {
    setTimeout(async () => {
      try {
        registryWatcher = new RegistryWatcher(performanceCore);
        
        // 监听应用安装事件
        registryWatcher.on('app-installed', async (appInfo) => {
          console.log(`[TIDYDESK] Detected app installation: ${appInfo.appName}`);
          await appService.updateSingleApp(appInfo);
        });
        
        // 监听应用卸载事件
        registryWatcher.on('app-uninstalled', async (appInfo) => {
          console.log(`[TIDYDESK] Detected app uninstallation: ${appInfo.appName}`);
          await appService.removeSingleApp(appInfo);
        });
        
        await registryWatcher.start();
      } catch (err) {
        console.error('[TIDYDESK] Failed to start registry watcher:', err);
      }
    }, 15000);
  } else {
    console.log('[TIDYDESK] Registry watcher is only available on Windows');
  }
  
  // 定期更新应用缓存（每 24 小时，作为兜底）
  dailyScanTimer = setInterval(async () => {
    console.log('[TIDYDESK] Daily full scan started');
    try {
      const startTime = Date.now();
      await appService.refreshApps();
      const duration = Date.now() - startTime;
      console.log(`[TIDYDESK] Daily full scan completed in ${duration}ms`);
    } catch (err) {
      console.error('[TIDYDESK] Daily full scan failed:', err);
    }
  }, 24 * 60 * 60 * 1000); // 每 24 小时
  
  // 注册到资源管理器
  resourceManager.registerInterval(dailyScanTimer, 'daily-app-scan');

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
  
  // 停止性能监控
  if (performanceCore) {
    performanceCore.stop();
    performanceCore = null;
  }
  
  // 清理所有资源
  if (resourceManager) {
    resourceManager.cleanup();
    resourceManager = null;
  }
  
  // 清理定时器（如果 resourceManager 没有清理）
  if (backgroundScanTimer) {
    clearTimeout(backgroundScanTimer);
    backgroundScanTimer = null;
  }
  if (dailyScanTimer) {
    clearInterval(dailyScanTimer);
    dailyScanTimer = null;
  }
  
  // 停止注册表监听
  if (registryWatcher) {
    registryWatcher.stop();
    registryWatcher = null;
  }
  if (goAppsClient) {
    goAppsClient.stop();
    goAppsClient = null;
  }
  
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

// 获取性能状态
ipcMain.handle('get-performance-status', async () => {
  if (!performanceCore) {
    return { success: false, error: 'Performance core not initialized' };
  }
  
  try {
    const status = performanceCore.getStatus();
    return { success: true, status };
  } catch (err) {
    console.error('[TIDYDESK] Failed to get performance status:', err);
    return { success: false, error: err.message };
  }
});

// 获取资源管理器统计
ipcMain.handle('get-resource-stats', async () => {
  if (!resourceManager) {
    return { success: false, error: 'Resource manager not initialized' };
  }
  
  try {
    const stats = resourceManager.getStats();
    const details = resourceManager.getDetails();
    return { success: true, stats, details };
  } catch (err) {
    console.error('[TIDYDESK] Failed to get resource stats:', err);
    return { success: false, error: err.message };
  }
});

// 检测资源泄漏
ipcMain.handle('detect-resource-leaks', async () => {
  if (!resourceManager) {
    return { success: false, error: 'Resource manager not initialized' };
  }
  
  try {
    const leaks = resourceManager.detectLeaks();
    return { success: true, leaks };
  } catch (err) {
    console.error('[TIDYDESK] Failed to detect leaks:', err);
    return { success: false, error: err.message };
  }
});

// 获取进程句柄详情（调试用）
ipcMain.handle('get-handle-details', async () => {
  try {
    const details = {
      timers: resourceManager ? resourceManager.getStats().timers : 0,
      intervals: resourceManager ? resourceManager.getStats().intervals : 0,
      listeners: resourceManager ? resourceManager.getStats().listeners : 0,
      process: {
        handles: process._getActiveHandles ? process._getActiveHandles().length : 'N/A',
        requests: process._getActiveRequests ? process._getActiveRequests().length : 'N/A'
      }
    };
    return { success: true, details };
  } catch (err) {
    console.error('[TIDYDESK] Failed to get handle details:', err);
    return { success: false, error: err.message };
  }
});
