/**
 * TidyDesk 常驻机制模块
 * 负责系统托盘、开机自启、单实例锁、内存监控等功能
 */

const { app, Tray, Menu, dialog, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const CONFIG = require('./config.cjs');

let tray = null;
let isQuitting = false;
let memoryCheckInterval = null;
let cacheCleanupInterval = null;

/**
 * 初始化常驻机制
 * @param {BrowserWindow} handleWindow - 手柄窗口
 * @param {BrowserWindow} drawerWindow - 抽屉窗口
 * @param {BrowserWindow[]} auxiliaryWindows - 其他模块窗口
 */
function initializeResident(handleWindow, drawerWindow, auxiliaryWindows = []) {
  console.log('[TIDYDESK] Initializing resident mechanism...');
  
  // 1. 设置单实例锁（必须最先执行）
  const hasLock = setupSingleInstance(handleWindow);
  if (!hasLock) {
    return false; // 已有实例在运行，退出
  }
  
  // 2. 创建系统托盘
  if (CONFIG.RESIDENT.ENABLE_TRAY) {
    createTray(handleWindow, drawerWindow, auxiliaryWindows);
  }
  
  // 3. 设置开机自启
  if (CONFIG.RESIDENT.ENABLE_AUTO_START) {
    setupAutoStart();
  }
  
  // 4. 设置进程保护
  setupProcessProtection();
  
  // 5. 设置内存监控
  setupMemoryMonitoring();
  
  // 6. 设置电源管理
  setupPowerManagement();
  
  console.log('[TIDYDESK] Resident mechanism initialized successfully');
  return true;
}

/**
 * 创建系统托盘
 */
function createTray(handleWindow, drawerWindow, auxiliaryWindows = []) {
  const { nativeImage } = require('electron');
  
  // 尝试加载图标的优先级列表
  const iconPaths = [
    path.join(__dirname, '../build/tray-icon.ico'),
    path.join(__dirname, '../build/icon.ico'),
    path.join(__dirname, '../build/icon.png')
  ];
  
  let trayIcon = null;
  
  // 尝试加载图标
  for (const iconPath of iconPaths) {
    if (fs.existsSync(iconPath)) {
      try {
        trayIcon = nativeImage.createFromPath(iconPath);
        if (!trayIcon.isEmpty()) {
          console.log(`[TIDYDESK] Using tray icon: ${iconPath}`);
          break;
        }
      } catch (err) {
        console.warn(`[TIDYDESK] Failed to load icon: ${iconPath}`, err.message);
      }
    }
  }
  
  // 如果所有图标都失败，使用 Electron 默认图标
  if (!trayIcon || trayIcon.isEmpty()) {
    console.warn('[TIDYDESK] No custom icon found, using default icon');
    // 创建一个空图标，Electron 会使用默认图标
    trayIcon = nativeImage.createEmpty();
  }
  
  try {
    tray = new Tray(trayIcon);
    
    // 构建托盘菜单
    const contextMenu = Menu.buildFromTemplate([
      {
        label: `TidyDesk v${app.getVersion()}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: '显示',
        click: () => {
          if (handleWindow) {
            handleWindow.show();
            handleWindow.focus();
          }
        }
      },
      {
        label: '隐藏',
        click: () => {
          if (handleWindow) handleWindow.hide();
          if (drawerWindow) drawerWindow.hide();
          for (const win of auxiliaryWindows) {
            if (win && !win.isDestroyed()) win.hide();
          }
        }
      },
      { type: 'separator' },
      {
        label: '开机自启动',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (menuItem) => {
          app.setLoginItemSettings({
            openAtLogin: menuItem.checked,
            openAsHidden: false
          });
          console.log(`[TIDYDESK] Auto-start ${menuItem.checked ? 'enabled' : 'disabled'}`);
        }
      },
      { type: 'separator' },
      {
        label: '内存使用: 计算中...',
        enabled: false,
        id: 'memory-usage'
      },
      { type: 'separator' },
      {
        label: '⚠️ 退出 TidyDesk (Ctrl+Alt+Q)',
        click: () => {
          console.log('[TIDYDESK] User requested quit from tray');
          isQuitting = true;
          app.quit();
        }
      }
    ]);
    
    tray.setContextMenu(contextMenu);
    tray.setToolTip('TidyDesk - 桌面收纳助手\n右键打开菜单 | Ctrl+Alt+Q 退出');
    
    // 添加气球提示，告诉用户如何退出
    setTimeout(() => {
      if (tray && !tray.isDestroyed()) {
        tray.displayBalloon({
          title: 'TidyDesk 正在运行',
          content: '右键托盘图标可以退出应用\n或使用快捷键 Ctrl+Alt+Q',
          icon: trayIcon
        });
      }
    }, 3000);
    
    // 双击托盘图标切换显示/隐藏
    tray.on('double-click', () => {
      if (handleWindow) {
        if (handleWindow.isVisible()) {
          handleWindow.hide();
          if (drawerWindow) drawerWindow.hide();
          for (const win of auxiliaryWindows) {
            if (win && !win.isDestroyed()) win.hide();
          }
        } else {
          handleWindow.show();
          handleWindow.focus();
        }
      }
    });
    
    // 定期更新内存使用显示
    setInterval(() => {
      updateTrayMemoryUsage();
    }, 30000); // 每 30 秒更新一次
    
    // 立即更新一次
    setTimeout(() => updateTrayMemoryUsage(), 1000);
    
    console.log('[TIDYDESK] System tray created successfully');
  } catch (err) {
    console.error('[TIDYDESK] Failed to create tray:', err);
  }
}

/**
 * 更新托盘菜单中的内存使用显示
 */
function updateTrayMemoryUsage() {
  if (!tray || tray.isDestroyed()) return;
  
  try {
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    
    // 重新构建菜单以更新内存显示
    // 注意：某些 Electron 版本不支持 getContextMenu()
    // 所以我们直接重建菜单
    if (typeof tray.getContextMenu === 'function') {
      const menu = tray.getContextMenu();
      if (menu) {
        const memoryItem = menu.getMenuItemById('memory-usage');
        if (memoryItem) {
          memoryItem.label = `内存使用: ${memMB}MB`;
        }
      }
    }
  } catch (err) {
    // 静默失败，不影响主要功能
    console.debug('[TIDYDESK] Failed to update memory usage:', err.message);
  }
}

/**
 * 设置单实例锁
 * @returns {boolean} 是否获得锁（true = 第一个实例，false = 已有实例）
 */
function setupSingleInstance(handleWindow) {
  const gotTheLock = app.requestSingleInstanceLock();
  
  if (!gotTheLock) {
    console.log('[TIDYDESK] Another instance is already running, quitting...');
    return false;
  }
  
  // 当尝试运行第二个实例时
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('[TIDYDESK] Second instance detected, focusing main window');
    
    if (handleWindow) {
      // 如果窗口最小化，恢复它
      if (handleWindow.isMinimized()) {
        handleWindow.restore();
      }
      
      // 显示并聚焦窗口
      handleWindow.show();
      handleWindow.focus();
    }
  });
  
  console.log('[TIDYDESK] Single instance lock acquired');
  return true;
}

/**
 * 设置开机自启动
 * 优化的询问时机：
 * 1. 检查是否已设置
 * 2. 检查是否是首次启动
 * 3. 等待用户完成首次交互后再询问
 */
function setupAutoStart() {
  const settings = app.getLoginItemSettings();
  const path = require('path');
  const fs = require('fs');
  
  // 如果已经设置过，不再询问
  if (settings.openAtLogin) {
    console.log('[TIDYDESK] Auto-start already enabled');
    return;
  }
  
  // 检查是否已经询问过（使用标记文件）
  const userDataPath = app.getPath('userData');
  const askedFlagFile = path.join(userDataPath, '.auto-start-asked');
  
  if (fs.existsSync(askedFlagFile)) {
    console.log('[TIDYDESK] Auto-start already asked, skipping');
    return;
  }
  
  // 智能延迟：等待用户完成首次交互
  // 策略：延迟 30 秒，或者等待用户第一次使用功能后
  let hasUserInteracted = false;
  let dialogShown = false;
  
  // 监听用户交互事件
  const showAutoStartDialog = () => {
    if (dialogShown) return;
    dialogShown = true;
    
    console.log('[TIDYDESK] Showing auto-start dialog after user interaction');
    
    dialog.showMessageBox({
      type: 'question',
      title: 'TidyDesk',
      message: '是否设置开机自动启动？',
      detail: '开机自启可以让 TidyDesk 始终为您服务，随时整理桌面。\n\n您可以随时从系统托盘菜单中更改此设置。',
      buttons: ['是', '否', '稍后提醒'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    }).then(result => {
      if (result.response === 0) {
        // 用户选择"是"
        app.setLoginItemSettings({
          openAtLogin: true,
          openAsHidden: false
        });
        console.log('[TIDYDESK] Auto-start enabled by user');
        
        // 创建标记文件
        fs.writeFileSync(askedFlagFile, new Date().toISOString());
      } else if (result.response === 1) {
        // 用户选择"否"
        console.log('[TIDYDESK] Auto-start declined by user');
        
        // 创建标记文件
        fs.writeFileSync(askedFlagFile, new Date().toISOString());
      } else {
        // 用户选择"稍后提醒"
        console.log('[TIDYDESK] Auto-start postponed by user');
        // 不创建标记文件，下次启动继续询问
      }
    }).catch(err => {
      console.warn('[TIDYDESK] Failed to show auto-start dialog:', err);
    });
  };
  
  // 策略 1：30 秒后如果用户还没交互，主动询问
  const timeoutId = setTimeout(() => {
    if (!hasUserInteracted) {
      console.log('[TIDYDESK] 30 seconds passed, showing auto-start dialog');
      showAutoStartDialog();
    }
  }, 30000);
  
  // 策略 2：监听用户首次交互（通过 IPC 事件）
  // 当用户第一次使用功能时（如拖拽文件、打开抽屉等），立即询问
  const { ipcMain } = require('electron');
  
  const onUserInteraction = () => {
    if (!hasUserInteracted && !dialogShown) {
      hasUserInteracted = true;
      clearTimeout(timeoutId);
      
      // 延迟 2 秒，让用户完成当前操作
      setTimeout(() => {
        showAutoStartDialog();
      }, 2000);
    }
  };
  
  // 监听各种用户交互事件
  ipcMain.once('user-first-interaction', onUserInteraction);
  ipcMain.once('drawer-opened', onUserInteraction);
  ipcMain.once('file-dropped', onUserInteraction);
}

/**
 * 设置进程保护
 */
function setupProcessProtection() {
  // 防止关闭所有窗口时退出
  app.on('window-all-closed', () => {
    console.log('[TIDYDESK] All windows closed, but app remains running in tray');
    // 不调用 app.quit()，让应用继续运行
  });
  
  // 防止意外退出
  app.on('before-quit', (event) => {
    if (!isQuitting && CONFIG.RESIDENT.HIDE_ON_CLOSE) {
      event.preventDefault();
      console.log('[TIDYDESK] Quit prevented, app will continue running');
    }
  });
  
  console.log('[TIDYDESK] Process protection enabled');
}

/**
 * 设置内存监控
 */
function setupMemoryMonitoring() {
  // 定期检查内存使用
  memoryCheckInterval = setInterval(() => {
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    
    console.log(`[TIDYDESK] Memory usage: ${memMB}MB (RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB)`);
    
    // 如果内存使用超过阈值，触发垃圾回收
    if (memUsage.heapUsed > CONFIG.RESIDENT.MEMORY_WARNING_THRESHOLD) {
      console.warn(`[TIDYDESK] High memory usage detected: ${memMB}MB`);
      
      // 触发手动垃圾回收（需要启动时加 --expose-gc 参数）
      if (global.gc) {
        global.gc();
        console.log('[TIDYDESK] Manual garbage collection triggered');
        
        // 再次检查内存
        const newMemMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        console.log(`[TIDYDESK] Memory after GC: ${newMemMB}MB (freed: ${memMB - newMemMB}MB)`);
      }
    }
  }, CONFIG.RESIDENT.MEMORY_CHECK_INTERVAL);
  
  // 定期清理缓存
  cacheCleanupInterval = setInterval(() => {
    console.log('[TIDYDESK] Running periodic cache cleanup...');
    // 这里可以添加具体的缓存清理逻辑
    // 例如：清理过期的图标缓存、应用扫描缓存等
  }, CONFIG.RESIDENT.CACHE_CLEANUP_INTERVAL);
  
  console.log('[TIDYDESK] Memory monitoring enabled');
}

/**
 * 设置电源管理
 */
function setupPowerManagement() {
  // 系统即将休眠
  powerMonitor.on('suspend', () => {
    console.log('[TIDYDESK] System is suspending, pausing resource-intensive operations');
    // 可以在这里暂停文件监控等操作
  });
  
  // 系统从休眠恢复
  powerMonitor.on('resume', () => {
    console.log('[TIDYDESK] System resumed from sleep, resuming operations');
    // 可以在这里恢复文件监控等操作
  });
  
  // 系统即将关机
  powerMonitor.on('shutdown', (event) => {
    console.log('[TIDYDESK] System is shutting down, saving state...');
    
    // 阻止立即关机，给应用时间保存状态
    event.preventDefault();
    
    // 保存状态后允许关机
    setTimeout(() => {
      isQuitting = true;
      app.quit();
    }, 1000);
  });
  
  console.log('[TIDYDESK] Power management enabled');
}

/**
 * 清理常驻机制资源
 */
function cleanupResident() {
  console.log('[TIDYDESK] Cleaning up resident mechanism...');
  
  // 清理定时器
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
    memoryCheckInterval = null;
  }
  
  if (cacheCleanupInterval) {
    clearInterval(cacheCleanupInterval);
    cacheCleanupInterval = null;
  }
  
  // 销毁托盘图标
  if (tray) {
    tray.destroy();
    tray = null;
  }
  
  console.log('[TIDYDESK] Resident mechanism cleaned up');
}

/**
 * 获取退出状态
 * @returns {boolean}
 */
function isAppQuitting() {
  return isQuitting;
}

/**
 * 设置退出状态
 * @param {boolean} value
 */
function setQuitting(value) {
  isQuitting = value;
  console.log(`[TIDYDESK] Quitting status set to: ${value}`);
}

/**
 * 获取托盘对象
 * @returns {Tray|null}
 */
function getTray() {
  return tray;
}

module.exports = {
  initializeResident,
  cleanupResident,
  isAppQuitting,
  setQuitting,
  getTray
};
