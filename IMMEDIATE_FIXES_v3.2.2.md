# TidyDesk v3.2.2 立即修复清单

**目标版本**: 3.2.2  
**预计工作量**: 10 小时  
**优先级**: 🔴 高

---

## 📋 修复清单

### 1. 文件监控资源泄漏 🔴 必须修复

**问题描述**:
- `watchedTargets` Map 可能无限增长
- 已删除的文件路径不会被清理
- 长时间运行可能导致内存泄漏

**修复方案**:
```javascript
// electron/main.cjs

// 添加清理函数
function cleanupFileWatcher() {
  console.log('[TIDYDESK] Cleaning up file watcher...');
  
  let cleaned = 0;
  for (const [targetPath, shortcuts] of watchedTargets.entries()) {
    // 清理空的或无效的监控项
    if (shortcuts.size === 0 || !fs.existsSync(targetPath)) {
      watchedTargets.delete(targetPath);
      fileWatcher.unwatch(targetPath);
      cleaned++;
    }
  }
  
  console.log(`[TIDYDESK] Cleaned ${cleaned} invalid watch targets`);
  console.log(`[TIDYDESK] Currently watching ${watchedTargets.size} files`);
}

// 在 initializeFileWatcher() 中添加定期清理
function initializeFileWatcher() {
  // ... 现有代码 ...
  
  // 每小时清理一次
  setInterval(() => {
    cleanupFileWatcher();
  }, 60 * 60 * 1000);
  
  console.log('[TIDYDESK] File watcher cleanup scheduled');
}
```

**工作量**: 1 小时  
**测试**: 长时间运行测试（24小时）

---

### 2. 错误处理完善 🔴 必须修复

**问题描述**:
- 很多错误只是 console.error，用户看不到
- 没有错误恢复机制
- 关键操作失败时没有反馈

**修复方案**:

#### 2.1 创建错误处理工具

```javascript
// electron/utils/error-handler.cjs

const { dialog } = require('electron');

class TidyDeskError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'TidyDeskError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

function handleError(error, context = '', showDialog = false) {
  // 记录错误
  console.error(`[TIDYDESK ERROR] ${context}:`, error);
  
  // 如果需要，显示对话框
  if (showDialog) {
    dialog.showErrorBox(
      'TidyDesk 错误',
      `操作失败: ${error.message}\n\n如果问题持续，请联系支持。`
    );
  }
  
  // 发送到主窗口（如果存在）
  if (global.drawerWindow && !global.drawerWindow.isDestroyed()) {
    global.drawerWindow.webContents.send('error-notification', {
      message: error.message,
      code: error.code,
      context
    });
  }
}

module.exports = {
  TidyDeskError,
  handleError
};
```

#### 2.2 在关键操作中使用

```javascript
// electron/main.cjs

const { TidyDeskError, handleError } = require('./utils/error-handler.cjs');

// 示例：文件导入
ipcMain.handle('import-external-files', async (event, payload) => {
  try {
    // ... 现有逻辑 ...
  } catch (err) {
    handleError(
      new TidyDeskError(
        '导入文件失败',
        'IMPORT_FAILED',
        { filePaths: payload.filePaths }
      ),
      'import-external-files',
      true // 显示对话框
    );
    throw err;
  }
});
```

**工作量**: 3 小时  
**测试**: 模拟各种错误场景

---

### 3. 日志系统 🔴 必须修复

**问题描述**:
- 所有日志都是 console.log
- 没有日志文件
- 难以调试用户问题

**修复方案**:

#### 3.1 配置 electron-log

```javascript
// electron/utils/logger.cjs

const log = require('electron-log');
const path = require('path');
const { app } = require('electron');

// 配置日志
log.transports.file.level = 'info';
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.transports.file.resolvePathFn = () => {
  return path.join(app.getPath('userData'), 'logs', 'tidydesk.log');
};

// 控制台日志
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'info';

// 导出便捷方法
module.exports = {
  debug: (...args) => log.debug(...args),
  info: (...args) => log.info(...args),
  warn: (...args) => log.warn(...args),
  error: (...args) => log.error(...args),
  
  // 获取日志文件路径
  getLogPath: () => log.transports.file.getFile().path
};
```

#### 3.2 替换所有 console.log

```javascript
// electron/main.cjs

const logger = require('./utils/logger.cjs');

// 替换
// console.log('[TIDYDESK] App ready');
logger.info('App ready');

// console.error('[TIDYDESK] Error:', err);
logger.error('Error:', err);
```

#### 3.3 添加导出日志功能

```javascript
// electron/main.cjs

ipcMain.handle('export-logs', async () => {
  const { dialog } = require('electron');
  const logPath = logger.getLogPath();
  
  const result = await dialog.showSaveDialog({
    title: '导出日志',
    defaultPath: `tidydesk-logs-${Date.now()}.log`,
    filters: [{ name: 'Log Files', extensions: ['log'] }]
  });
  
  if (!result.canceled) {
    await fs.promises.copyFile(logPath, result.filePath);
    return { success: true, path: result.filePath };
  }
  
  return { success: false };
});
```

**工作量**: 3 小时  
**测试**: 检查日志文件生成和轮转

---

### 4. 配置验证 🟡 应该修复

**问题描述**:
- 配置值没有验证
- 用户修改配置可能导致崩溃

**修复方案**:

```javascript
// electron/config.cjs

// 添加验证函数
function validateConfig(config) {
  const errors = [];
  
  // 验证窗口配置
  if (config.WINDOW.MIN_WIDTH < 0 || config.WINDOW.MIN_WIDTH > 1000) {
    errors.push('WINDOW.MIN_WIDTH must be between 0 and 1000');
  }
  
  if (config.WINDOW.HANDLE_WIDTH < 0 || config.WINDOW.HANDLE_WIDTH > 200) {
    errors.push('WINDOW.HANDLE_WIDTH must be between 0 and 200');
  }
  
  // 验证内存配置
  if (config.RESIDENT.MEMORY_WARNING_THRESHOLD < 100 * 1024 * 1024) {
    errors.push('MEMORY_WARNING_THRESHOLD must be at least 100MB');
  }
  
  // 验证时间间隔
  if (config.VALIDATION.INTERVAL < 60 * 1000) {
    errors.push('VALIDATION.INTERVAL must be at least 1 minute');
  }
  
  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n${errors.join('\n')}`);
  }
  
  return true;
}

// 导出配置前验证
const config = {
  // ... 所有配置 ...
};

validateConfig(config);

module.exports = config;
```

**工作量**: 2 小时  
**测试**: 测试各种无效配置

---

### 5. 托盘图标备选方案 🟡 应该修复

**问题描述**:
- 如果图标文件不存在，托盘功能失效
- 用户无法退出应用

**修复方案**:

```javascript
// electron/resident.js

function createTray(handleWindow, drawerWindow) {
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
        console.warn(`[TIDYDESK] Failed to load icon: ${iconPath}`, err);
      }
    }
  }
  
  // 如果所有图标都失败，创建一个简单的默认图标
  if (!trayIcon || trayIcon.isEmpty()) {
    console.warn('[TIDYDESK] No icon found, creating default icon');
    
    // 创建一个简单的 16x16 图标（纯色）
    const canvas = require('canvas');
    const canvasInstance = canvas.createCanvas(16, 16);
    const ctx = canvasInstance.getContext('2d');
    
    // 绘制一个简单的图标
    ctx.fillStyle = '#4A90E2';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(4, 4, 8, 8);
    
    trayIcon = nativeImage.createFromDataURL(canvasInstance.toDataURL());
  }
  
  try {
    tray = new Tray(trayIcon);
    // ... 其余代码 ...
  } catch (err) {
    console.error('[TIDYDESK] Failed to create tray:', err);
    // 托盘创建失败，但应用仍可运行
  }
}
```

**工作量**: 1 小时  
**测试**: 删除所有图标文件测试

---

## 📦 发布计划

### v3.2.2 发布清单

- [ ] 修复文件监控泄漏
- [ ] 完善错误处理
- [ ] 添加日志系统
- [ ] 配置验证
- [ ] 托盘图标备选
- [ ] 更新 CHANGELOG.md
- [ ] 更新版本号
- [ ] 构建测试
- [ ] 发布到 GitHub

### 测试清单

- [ ] 长时间运行测试（24小时）
- [ ] 内存使用监控
- [ ] 错误场景测试
- [ ] 日志文件验证
- [ ] 无图标启动测试
- [ ] 配置验证测试

---

## 🎯 预期效果

### 修复前

- ❌ 长时间运行可能内存泄漏
- ❌ 错误时用户不知道发生了什么
- ❌ 无法调试用户问题
- ❌ 托盘图标缺失时应用无法使用

### 修复后

- ✅ 长时间稳定运行
- ✅ 错误有清晰的反馈
- ✅ 完整的日志记录
- ✅ 配置安全可靠
- ✅ 托盘始终可用

---

## 📊 工作量估算

| 任务 | 工作量 | 优先级 |
|------|--------|--------|
| 文件监控清理 | 1h | 🔴 |
| 错误处理 | 3h | 🔴 |
| 日志系统 | 3h | 🔴 |
| 配置验证 | 2h | 🟡 |
| 托盘备选 | 1h | 🟡 |
| **总计** | **10h** | |

---

## 🚀 下一步

1. **立即开始**: 修复文件监控泄漏（最高优先级）
2. **今天完成**: 错误处理和日志系统
3. **明天完成**: 配置验证和托盘备选
4. **后天发布**: v3.2.2

---

**创建日期**: 2026-05-24  
**目标完成**: 2026-05-26  
**负责人**: TidyDesk 团队
