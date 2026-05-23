# TidyDesk 常驻机制完整指南

**文档版本**: 1.0  
**适用版本**: v3.1.1+  
**更新日期**: 2026-05-24

---

## 📋 目录

1. [当前状态分析](#当前状态分析)
2. [常驻机制核心策略](#常驻机制核心策略)
3. [Windows 系统层面保护](#windows-系统层面保护)
4. [Electron 应用层面保护](#electron-应用层面保护)
5. [实现方案](#实现方案)
6. [测试验证](#测试验证)

---

## 🔍 当前状态分析

### 现有机制

```javascript
// 当前的退出处理
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

### 存在的问题

| 问题 | 影响 | 风险等级 |
|------|------|----------|
| ❌ 关闭所有窗口会退出应用 | 用户误关闭手柄窗口导致应用退出 | 高 |
| ❌ 没有系统托盘图标 | 无法在后台运行 | 高 |
| ❌ 没有开机自启动 | 每次重启需要手动启动 | 中 |
| ❌ 没有进程保护机制 | 容易被任务管理器结束 | 中 |
| ❌ 没有崩溃恢复机制 | 崩溃后无法自动重启 | 中 |
| ❌ 没有内存优化 | 长时间运行可能内存泄漏 | 低 |

---

## 🛡️ 常驻机制核心策略

### 1. 系统托盘（Tray）- 最重要

**作用**: 即使关闭所有窗口，应用仍在后台运行

**优先级**: ⭐⭐⭐⭐⭐

```javascript
const { app, Tray, Menu } = require('electron');

let tray = null;

function createTray() {
  // 创建托盘图标
  tray = new Tray(path.join(__dirname, '../build/tray-icon.ico'));
  
  // 托盘菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示 TidyDesk',
      click: () => {
        if (handleWindow) handleWindow.show();
        if (drawerWindow && isDrawerExpanded) drawerWindow.show();
      }
    },
    {
      label: '隐藏 TidyDesk',
      click: () => {
        if (handleWindow) handleWindow.hide();
        if (drawerWindow) drawerWindow.hide();
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
      }
    },
    { type: 'separator' },
    {
      label: '设置',
      click: () => {
        // 打开设置窗口
      }
    },
    {
      label: '检查更新',
      click: () => {
        checkForUpdates();
      }
    },
    { type: 'separator' },
    {
      label: '退出 TidyDesk',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
  tray.setToolTip('TidyDesk - 桌面收纳助手');
  
  // 双击托盘图标显示/隐藏
  tray.on('double-click', () => {
    if (handleWindow) {
      if (handleWindow.isVisible()) {
        handleWindow.hide();
      } else {
        handleWindow.show();
      }
    }
  });
}
```

### 2. 防止误退出

**作用**: 关闭窗口不退出应用，只是隐藏

**优先级**: ⭐⭐⭐⭐⭐

```javascript
let isQuitting = false;

// 修改退出逻辑
app.on('window-all-closed', () => {
  // Windows 和 Linux 上也不退出，保持常驻
  // 只有用户从托盘菜单选择"退出"时才真正退出
  console.log('[TIDYDESK] All windows closed, but app remains running in tray');
});

app.on('before-quit', (event) => {
  if (!isQuitting) {
    event.preventDefault();
    
    // 隐藏所有窗口而不是退出
    if (handleWindow) handleWindow.hide();
    if (drawerWindow) drawerWindow.hide();
    
    console.log('[TIDYDESK] App hidden, still running in background');
  }
});

// 窗口关闭时隐藏而不是销毁
function createHandleWindow() {
  handleWindow = new BrowserWindow({...});
  
  handleWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      handleWindow.hide();
    }
  });
}
```

### 3. 开机自启动

**作用**: 系统启动时自动运行

**优先级**: ⭐⭐⭐⭐

```javascript
// 在 app.whenReady() 中设置
app.whenReady().then(() => {
  // 首次启动时询问用户是否开机自启
  const settings = app.getLoginItemSettings();
  
  if (!settings.wasOpenedAtLogin && !settings.openAtLogin) {
    // 首次启动，询问用户
    const { dialog } = require('electron');
    dialog.showMessageBox({
      type: 'question',
      title: 'TidyDesk',
      message: '是否设置开机自动启动？',
      detail: '开机自启可以让 TidyDesk 始终为您服务',
      buttons: ['是', '否'],
      defaultId: 0
    }).then(result => {
      if (result.response === 0) {
        app.setLoginItemSettings({
          openAtLogin: true,
          openAsHidden: false,
          path: process.execPath,
          args: []
        });
      }
    });
  }
});
```

### 4. 进程保护

**作用**: 防止被任务管理器轻易结束

**优先级**: ⭐⭐⭐

```javascript
// 设置进程优先级
app.commandLine.appendSwitch('high-priority');

// 监听系统关机/注销事件
const { powerMonitor } = require('electron');

powerMonitor.on('shutdown', (event) => {
  // 阻止立即关机，保存状态
  event.preventDefault();
  
  // 保存应用状态
  saveAppState().then(() => {
    // 允许关机
    app.quit();
  });
});

powerMonitor.on('suspend', () => {
  console.log('[TIDYDESK] System is going to sleep');
  // 暂停文件监控等资源密集型操作
  if (fileWatcher) {
    fileWatcher.close();
  }
});

powerMonitor.on('resume', () => {
  console.log('[TIDYDESK] System woke up');
  // 恢复文件监控
  initializeFileWatcher();
});
```

### 5. 崩溃恢复

**作用**: 应用崩溃后自动重启

**优先级**: ⭐⭐⭐⭐

```javascript
// 使用 Windows 任务计划程序实现守护进程
const { exec } = require('child_process');

function setupWatchdog() {
  if (process.platform !== 'win32') return;
  
  // 创建监控脚本
  const watchdogScript = `
@echo off
:loop
tasklist /FI "IMAGENAME eq TidyDesk.exe" 2>NUL | find /I /N "TidyDesk.exe">NUL
if "%ERRORLEVEL%"=="1" (
    echo TidyDesk not running, restarting...
    start "" "${process.execPath}"
)
timeout /t 30 /nobreak >NUL
goto loop
  `;
  
  const watchdogPath = path.join(app.getPath('userData'), 'watchdog.bat');
  fs.writeFileSync(watchdogPath, watchdogScript);
  
  // 注册到任务计划程序（需要管理员权限）
  const taskName = 'TidyDeskWatchdog';
  const command = `schtasks /create /tn "${taskName}" /tr "${watchdogPath}" /sc onlogon /rl highest /f`;
  
  exec(command, (error) => {
    if (error) {
      console.warn('[TIDYDESK] Failed to setup watchdog:', error);
    } else {
      console.log('[TIDYDESK] Watchdog setup successfully');
    }
  });
}
```

### 6. 内存优化

**作用**: 防止长时间运行导致内存泄漏

**优先级**: ⭐⭐⭐

```javascript
// 定期清理内存
setInterval(() => {
  if (global.gc) {
    global.gc();
    console.log('[TIDYDESK] Manual garbage collection triggered');
  }
  
  // 记录内存使用情况
  const memUsage = process.memoryUsage();
  console.log('[TIDYDESK] Memory usage:', {
    rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
    heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`
  });
  
  // 如果内存使用超过阈值，警告用户
  if (memUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
    console.warn('[TIDYDESK] High memory usage detected');
  }
}, 10 * 60 * 1000); // 每 10 分钟检查一次

// 清理过期缓存
setInterval(() => {
  // 清理图标缓存
  // 清理应用扫描缓存
  console.log('[TIDYDESK] Cache cleanup completed');
}, 60 * 60 * 1000); // 每小时清理一次
```

### 7. 单实例锁

**作用**: 防止多个实例同时运行

**优先级**: ⭐⭐⭐⭐

```javascript
// 确保只有一个实例运行
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[TIDYDESK] Another instance is already running');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 当运行第二个实例时，聚焦到第一个实例
    console.log('[TIDYDESK] Second instance detected, focusing main window');
    
    if (handleWindow) {
      if (handleWindow.isMinimized()) handleWindow.restore();
      handleWindow.show();
      handleWindow.focus();
    }
  });
}
```

---

## 🔧 完整实现方案

### 配置文件更新

在 `electron/config.js` 中添加：

```javascript
module.exports = {
  // ... 现有配置 ...
  
  // 常驻机制配置
  RESIDENT: {
    ENABLE_TRAY: true,                    // 启用系统托盘
    ENABLE_AUTO_START: true,              // 启用开机自启
    ENABLE_WATCHDOG: false,               // 启用守护进程（可选）
    MEMORY_CHECK_INTERVAL: 10 * 60 * 1000, // 内存检查间隔（10分钟）
    MEMORY_WARNING_THRESHOLD: 500 * 1024 * 1024, // 内存警告阈值（500MB）
    CACHE_CLEANUP_INTERVAL: 60 * 60 * 1000, // 缓存清理间隔（1小时）
    HIDE_ON_CLOSE: true,                  // 关闭窗口时隐藏而不是退出
    MINIMIZE_TO_TRAY: true                // 最小化到托盘
  }
};
```

### 主进程实现

创建 `electron/resident.js`:

```javascript
/**
 * TidyDesk 常驻机制模块
 */

const { app, Tray, Menu, dialog, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const CONFIG = require('./config');

let tray = null;
let isQuitting = false;
let memoryCheckInterval = null;
let cacheCleanupInterval = null;

/**
 * 初始化常驻机制
 */
function initializeResident(handleWindow, drawerWindow) {
  console.log('[TIDYDESK] Initializing resident mechanism...');
  
  // 1. 创建系统托盘
  if (CONFIG.RESIDENT.ENABLE_TRAY) {
    createTray(handleWindow, drawerWindow);
  }
  
  // 2. 设置单实例锁
  setupSingleInstance(handleWindow);
  
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
  
  // 7. 设置守护进程（可选）
  if (CONFIG.RESIDENT.ENABLE_WATCHDOG) {
    setupWatchdog();
  }
  
  console.log('[TIDYDESK] Resident mechanism initialized');
}

/**
 * 创建系统托盘
 */
function createTray(handleWindow, drawerWindow) {
  const iconPath = path.join(__dirname, '../build/tray-icon.ico');
  
  // 如果图标不存在，使用默认图标
  if (!fs.existsSync(iconPath)) {
    console.warn('[TIDYDESK] Tray icon not found, using default');
  }
  
  tray = new Tray(iconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'TidyDesk v' + app.getVersion(),
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
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
  tray.setToolTip('TidyDesk - 桌面收纳助手');
  
  // 双击托盘图标切换显示/隐藏
  tray.on('double-click', () => {
    if (handleWindow) {
      if (handleWindow.isVisible()) {
        handleWindow.hide();
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
}

/**
 * 更新托盘菜单中的内存使用显示
 */
function updateTrayMemoryUsage() {
  if (!tray) return;
  
  const memUsage = process.memoryUsage();
  const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  
  const menu = tray.getContextMenu();
  const memoryItem = menu.getMenuItemById('memory-usage');
  if (memoryItem) {
    memoryItem.label = `内存使用: ${memMB}MB`;
  }
}

/**
 * 设置单实例锁
 */
function setupSingleInstance(handleWindow) {
  const gotTheLock = app.requestSingleInstanceLock();
  
  if (!gotTheLock) {
    console.log('[TIDYDESK] Another instance is already running');
    app.quit();
    return false;
  }
  
  app.on('second-instance', () => {
    console.log('[TIDYDESK] Second instance detected');
    
    if (handleWindow) {
      if (handleWindow.isMinimized()) handleWindow.restore();
      handleWindow.show();
      handleWindow.focus();
    }
  });
  
  return true;
}

/**
 * 设置开机自启动
 */
function setupAutoStart() {
  const settings = app.getLoginItemSettings();
  
  // 首次启动时询问用户
  if (!settings.wasOpenedAtLogin && !settings.openAtLogin) {
    setTimeout(() => {
      dialog.showMessageBox({
        type: 'question',
        title: 'TidyDesk',
        message: '是否设置开机自动启动？',
        detail: '开机自启可以让 TidyDesk 始终为您服务',
        buttons: ['是', '否'],
        defaultId: 0,
        cancelId: 1
      }).then(result => {
        if (result.response === 0) {
          app.setLoginItemSettings({
            openAtLogin: true,
            openAsHidden: false
          });
          console.log('[TIDYDESK] Auto-start enabled');
        }
      });
    }, 5000); // 延迟 5 秒，避免启动时弹窗
  }
}

/**
 * 设置进程保护
 */
function setupProcessProtection() {
  // 设置进程优先级（仅 Windows）
  if (process.platform === 'win32') {
    try {
      app.commandLine.appendSwitch('high-priority');
    } catch (err) {
      console.warn('[TIDYDESK] Failed to set high priority:', err);
    }
  }
  
  // 防止意外退出
  app.on('window-all-closed', () => {
    console.log('[TIDYDESK] All windows closed, app remains in tray');
    // 不调用 app.quit()，保持应用运行
  });
  
  app.on('before-quit', (event) => {
    if (!isQuitting && CONFIG.RESIDENT.HIDE_ON_CLOSE) {
      event.preventDefault();
      console.log('[TIDYDESK] Quit prevented, hiding windows');
    }
  });
}

/**
 * 设置内存监控
 */
function setupMemoryMonitoring() {
  memoryCheckInterval = setInterval(() => {
    const memUsage = process.memoryUsage();
    const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    
    console.log(`[TIDYDESK] Memory: ${memMB}MB`);
    
    // 内存警告
    if (memUsage.heapUsed > CONFIG.RESIDENT.MEMORY_WARNING_THRESHOLD) {
      console.warn('[TIDYDESK] High memory usage detected:', memMB, 'MB');
      
      // 触发垃圾回收
      if (global.gc) {
        global.gc();
        console.log('[TIDYDESK] Manual GC triggered');
      }
    }
  }, CONFIG.RESIDENT.MEMORY_CHECK_INTERVAL);
  
  // 缓存清理
  cacheCleanupInterval = setInterval(() => {
    console.log('[TIDYDESK] Running cache cleanup...');
    // 这里可以添加具体的缓存清理逻辑
  }, CONFIG.RESIDENT.CACHE_CLEANUP_INTERVAL);
}

/**
 * 设置电源管理
 */
function setupPowerManagement() {
  powerMonitor.on('suspend', () => {
    console.log('[TIDYDESK] System suspending, pausing operations');
    // 暂停资源密集型操作
  });
  
  powerMonitor.on('resume', () => {
    console.log('[TIDYDESK] System resumed, resuming operations');
    // 恢复操作
  });
  
  powerMonitor.on('shutdown', (event) => {
    console.log('[TIDYDESK] System shutting down');
    event.preventDefault();
    
    // 保存状态后允许关机
    setTimeout(() => {
      isQuitting = true;
      app.quit();
    }, 1000);
  });
}

/**
 * 设置守护进程（Windows）
 */
function setupWatchdog() {
  if (process.platform !== 'win32') return;
  
  // 这里可以实现守护进程逻辑
  console.log('[TIDYDESK] Watchdog setup (not implemented yet)');
}

/**
 * 清理常驻机制
 */
function cleanupResident() {
  console.log('[TIDYDESK] Cleaning up resident mechanism...');
  
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
  }
  
  if (cacheCleanupInterval) {
    clearInterval(cacheCleanupInterval);
  }
  
  if (tray) {
    tray.destroy();
  }
}

/**
 * 获取退出状态
 */
function isAppQuitting() {
  return isQuitting;
}

/**
 * 设置退出状态
 */
function setQuitting(value) {
  isQuitting = value;
}

module.exports = {
  initializeResident,
  cleanupResident,
  isAppQuitting,
  setQuitting
};
```

### 在 main.cjs 中集成

```javascript
// 在文件顶部导入
const resident = require('./resident');

// 在 app.whenReady() 中初始化
app.whenReady().then(() => {
  prepareStorage();
  initializeFileWatcher();
  startPeriodicValidation();
  createWindows();
  
  // 初始化常驻机制
  resident.initializeResident(handleWindow, drawerWindow);
  
  // 检查更新
  setTimeout(() => {
    checkForUpdates();
  }, 3000);
});

// 修改退出处理
app.on('before-quit', () => {
  if (!resident.isAppQuitting()) {
    // 由 resident 模块处理
    return;
  }
  
  // 真正退出时清理资源
  if (fileWatcher) {
    fileWatcher.close();
  }
  stopPeriodicValidation();
  resident.cleanupResident();
});
```

---

## ✅ 测试验证

### 测试清单

- [ ] **托盘图标测试**
  - [ ] 托盘图标正常显示
  - [ ] 右键菜单功能正常
  - [ ] 双击切换显示/隐藏
  - [ ] 内存使用显示更新

- [ ] **常驻测试**
  - [ ] 关闭所有窗口后应用仍在运行
  - [ ] 从托盘可以重新打开窗口
  - [ ] 任务管理器中进程持续存在

- [ ] **开机自启测试**
  - [ ] 首次启动弹出询问对话框
  - [ ] 设置后重启电脑自动启动
  - [ ] 可以从托盘菜单切换开关

- [ ] **单实例测试**
  - [ ] 运行第二个实例时聚焦到第一个
  - [ ] 不会出现多个进程

- [ ] **内存测试**
  - [ ] 长时间运行内存稳定
  - [ ] 内存超阈值时触发 GC
  - [ ] 托盘显示内存使用

- [ ] **电源管理测试**
  - [ ] 系统休眠后恢复正常
  - [ ] 系统关机时正常退出

---

## 📊 预期效果

实施完整的常驻机制后：

| 指标 | 改进前 | 改进后 |
|------|--------|--------|
| 意外退出率 | 高（关窗口就退出） | 极低（只能从托盘退出） |
| 开机可用性 | 需手动启动 | 自动启动 |
| 多实例问题 | 可能出现 | 完全避免 |
| 内存泄漏风险 | 中等 | 低（定期监控和清理） |
| 用户体验 | 一般 | 优秀（真正的常驻应用） |

---

## 🚀 实施建议

### 分阶段实施

**v3.2.0 - 基础常驻**:
- ✅ 系统托盘
- ✅ 防止误退出
- ✅ 单实例锁

**v3.3.0 - 增强保护**:
- ✅ 开机自启动
- ✅ 内存监控
- ✅ 电源管理

**v3.4.0 - 高级功能**:
- ✅ 守护进程（可选）
- ✅ 崩溃恢复
- ✅ 性能优化

---

## 📝 注意事项

1. **托盘图标**: 需要准备 16x16 的 .ico 文件
2. **管理员权限**: 某些功能（如守护进程）可能需要管理员权限
3. **用户体验**: 首次启动时询问开机自启，不要强制
4. **资源占用**: 常驻应用要特别注意内存和 CPU 使用
5. **退出方式**: 必须提供明确的退出入口（托盘菜单）

---

**文档作者**: TidyDesk 团队  
**最后更新**: 2026-05-24
