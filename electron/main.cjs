const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const os = require('os');
const chokidar = require('chokidar');

app.setName('TidyDesk');

let handleWindow;
let drawerWindow;
let isDrawerExpanded = false;
const defaultDrawerName = '收纳抽屉';

// 文件监控器
let fileWatcher = null;
const watchedTargets = new Map(); // targetPath -> Set<shortcutPath>

// 定期验证定时器
let validationInterval = null;

// 自动更新配置
autoUpdater.autoDownload = false; // 不自动下载，让用户确认
autoUpdater.autoInstallOnAppQuit = true; // 退出时自动安装

// 配置更新日志
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';

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

function getDesktopPath() {
  return app.getPath('desktop');
}

function getDrawerRoot() {
  return path.join(app.getPath('userData'), 'drawers');
}

function getLegacyDrawerRoot() {
  return path.join(getDesktopPath(), '桌面收纳盒');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isPathInside(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeDrawerName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return defaultDrawerName;
  return trimmed.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
}

function resolveDrawerPath(folderName) {
  const root = getDrawerRoot();
  const targetPath = path.resolve(root, safeDrawerName(folderName));

  if (!isPathInside(targetPath, root) || targetPath === root) {
    throw new Error('Unsafe drawer path');
  }

  return targetPath;
}

function nextAvailablePath(destDir, fileName) {
  const parsed = path.parse(fileName);
  let targetPath = path.join(destDir, fileName);
  let index = 1;

  while (fs.existsSync(targetPath)) {
    targetPath = path.join(destDir, `${parsed.name} (${index})${parsed.ext}`);
    index += 1;
  }

  return targetPath;
}

function getCategoryByExtension(ext, fileName) {
  const nameLower = fileName.toLowerCase();
  const extLower = ext.toLowerCase().replace('.', '');

  if (
    nameLower.startsWith('新建') ||
    nameLower.startsWith('untitled') ||
    nameLower.includes('screenshot') ||
    nameLower.startsWith('temp') ||
    nameLower.startsWith('tmp')
  ) {
    return 'temporary';
  }

  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico'].includes(extLower)) return 'image';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'txt', 'csv', 'md', 'key', 'numbers', 'pages'].includes(extLower)) return 'document';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(extLower)) return 'archive';
  if (['exe', 'msi', 'bat', 'cmd', 'dmg', 'pkg', 'lnk', 'url'].includes(extLower)) return 'app';
  if (['ts', 'tsx', 'js', 'jsx', 'json', 'html', 'css', 'py', 'go', 'rs', 'cpp', 'h', 'java', 'sh', 'yaml', 'yml'].includes(extLower)) return 'developer';

  return 'other';
}

function isProtectedDesktopItem(name) {
  const nameLower = name.toLowerCase();
  const protectedNames = ['desktop.ini', 'tidydesk', 'node_modules', '.git', '.github', '桌面收纳盒'];
  return protectedNames.some(item => nameLower.includes(item.toLowerCase()));
}

function migrateLegacyDrawers() {
  const legacyRoot = getLegacyDrawerRoot();
  const drawerRoot = getDrawerRoot();
  if (!fs.existsSync(legacyRoot)) return;

  ensureDir(drawerRoot);
  const legacyItems = fs.readdirSync(legacyRoot, { withFileTypes: true });
  for (const item of legacyItems) {
    const source = path.join(legacyRoot, item.name);
    const destination = nextAvailablePath(drawerRoot, item.name);
    try {
      fs.renameSync(source, destination);
    } catch (err) {
      console.warn(`[TIDYDESK] Failed to migrate "${source}"`, err.message);
    }
  }

  try {
    if (fs.readdirSync(legacyRoot).length === 0) {
      fs.rmdirSync(legacyRoot);
    }
  } catch (err) {
    console.warn(`[TIDYDESK] Legacy drawer cleanup skipped`, err.message);
  }
}

function prepareStorage() {
  ensureDir(getDrawerRoot());
  migrateLegacyDrawers();
  ensureDir(resolveDrawerPath(defaultDrawerName));
}

async function createDrawerShortcut(sourcePath, targetDir) {
  // 验证源文件存在
  if (!fs.existsSync(sourcePath)) {
    throw new Error('Source file does not exist');
  }
  
  // 验证不是系统关键目录
  const systemPaths = [
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    process.env.SYSTEMROOT,
    process.env.WINDIR
  ].filter(Boolean);
  
  const resolvedSource = path.resolve(sourcePath).toLowerCase();
  for (const sysPath of systemPaths) {
    if (sysPath && resolvedSource.startsWith(sysPath.toLowerCase())) {
      throw new Error('Cannot create shortcut to system directory');
    }
  }
  
  const itemName = path.basename(sourcePath);
  const ext = path.extname(itemName).toLowerCase();

  if (ext === '.lnk' || ext === '.url') {
    const copiedShortcutPath = nextAvailablePath(targetDir, itemName);
    await fs.promises.copyFile(sourcePath, copiedShortcutPath);
    return copiedShortcutPath;
  }

  const sourceStats = await fs.promises.stat(sourcePath);
  const shortcutPath = nextAvailablePath(targetDir, `${itemName}.lnk`);
  const ok = shell.writeShortcutLink(shortcutPath, 'create', {
    target: sourcePath,
    cwd: sourceStats.isDirectory() ? sourcePath : path.dirname(sourcePath),
    description: `TidyDesk shortcut for ${itemName}`
  });

  if (!ok) throw new Error(`Failed to create shortcut for "${sourcePath}"`);
  return shortcutPath;
}

/**
 * 解析快捷方式的目标路径
 * @param {string} shortcutPath - .lnk 文件路径
 * @returns {string|null} 目标路径，如果无法解析则返回 null
 */
function resolveShortcutTarget(shortcutPath) {
  try {
    if (!fs.existsSync(shortcutPath)) return null;
    
    const ext = path.extname(shortcutPath).toLowerCase();
    if (ext !== '.lnk') return null;
    
    const shortcutDetails = shell.readShortcutLink(shortcutPath);
    return shortcutDetails?.target || null;
  } catch (err) {
    console.warn(`[TIDYDESK] Failed to resolve shortcut: ${shortcutPath}`, err.message);
    return null;
  }
}

/**
 * 验证快捷方式是否有效（目标文件是否存在）
 * @param {string} shortcutPath - .lnk 文件路径
 * @returns {Object} { isValid: boolean, targetPath: string|null }
 */
function validateShortcut(shortcutPath) {
  const targetPath = resolveShortcutTarget(shortcutPath);
  
  if (!targetPath) {
    return { isValid: false, targetPath: null };
  }
  
  const isValid = fs.existsSync(targetPath);
  return { isValid, targetPath };
}

/**
 * 智能修复快捷方式 - 尝试在常见位置搜索文件
 * @param {string} shortcutPath - .lnk 文件路径
 * @param {string} targetPath - 原目标路径
 * @returns {Promise<Object>} { repaired: boolean, newPath: string|null }
 */
async function attemptShortcutRepair(shortcutPath, targetPath) {
  if (!targetPath) {
    return { repaired: false, newPath: null };
  }

  const fileName = path.basename(targetPath);
  const searchPaths = [
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Documents'),
    path.join(os.homedir(), 'Downloads'),
    path.join(os.homedir(), 'Pictures'),
    path.join(os.homedir(), 'Videos')
  ];

  for (const searchPath of searchPaths) {
    try {
      const possiblePath = path.join(searchPath, fileName);
      if (fs.existsSync(possiblePath)) {
        // 找到了文件，更新快捷方式
        const stats = await fs.promises.stat(possiblePath);
        const ok = shell.writeShortcutLink(shortcutPath, 'update', {
          target: possiblePath,
          cwd: stats.isDirectory() ? possiblePath : path.dirname(possiblePath),
          description: `TidyDesk shortcut for ${fileName} (auto-repaired)`
        });

        if (ok) {
          console.log(`[TIDYDESK] Auto-repaired shortcut: ${fileName} -> ${possiblePath}`);
          return { repaired: true, newPath: possiblePath };
        }
      }
    } catch (err) {
      console.warn(`[TIDYDESK] Failed to search in ${searchPath}`, err.message);
    }
  }

  return { repaired: false, newPath: null };
}

/**
 * 初始化文件监控器
 */
function initializeFileWatcher() {
  if (fileWatcher) {
    fileWatcher.close();
  }

  fileWatcher = chokidar.watch([], {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100
    }
  });

  fileWatcher
    .on('unlink', (filePath) => {
      // 原文件被删除
      console.warn(`[TIDYDESK] Target file deleted: ${filePath}`);
      handleTargetFileDeleted(filePath);
    })
    .on('add', (filePath) => {
      // 文件被创建（可能是恢复）
      console.log(`[TIDYDESK] Target file appeared: ${filePath}`);
      handleTargetFileRestored(filePath);
    })
    .on('error', (error) => {
      console.error(`[TIDYDESK] File watcher error:`, error);
    });

  console.log('[TIDYDESK] File watcher initialized');
}

/**
 * 添加文件到监控列表
 * @param {string} targetPath - 目标文件路径
 * @param {string} shortcutPath - 快捷方式路径
 */
function addFileToWatch(targetPath, shortcutPath) {
  if (!targetPath || !fs.existsSync(targetPath)) return;

  if (!watchedTargets.has(targetPath)) {
    watchedTargets.set(targetPath, new Set());
    fileWatcher.add(targetPath);
    console.log(`[TIDYDESK] Now watching: ${targetPath}`);
  }

  watchedTargets.get(targetPath).add(shortcutPath);
}

/**
 * 从监控列表移除文件
 * @param {string} targetPath - 目标文件路径
 * @param {string} shortcutPath - 快捷方式路径
 */
function removeFileFromWatch(targetPath, shortcutPath) {
  if (!watchedTargets.has(targetPath)) return;

  const shortcuts = watchedTargets.get(targetPath);
  shortcuts.delete(shortcutPath);

  if (shortcuts.size === 0) {
    watchedTargets.delete(targetPath);
    fileWatcher.unwatch(targetPath);
    console.log(`[TIDYDESK] Stopped watching: ${targetPath}`);
  }
}

/**
 * 处理目标文件被删除
 * @param {string} targetPath - 被删除的文件路径
 */
function handleTargetFileDeleted(targetPath) {
  const shortcuts = watchedTargets.get(targetPath);
  if (!shortcuts) return;

  // 通知前端刷新
  if (drawerWindow && !drawerWindow.isDestroyed()) {
    drawerWindow.webContents.send('target-file-deleted', {
      targetPath,
      shortcutCount: shortcuts.size
    });
  }
}

/**
 * 处理目标文件被恢复
 * @param {string} targetPath - 恢复的文件路径
 */
function handleTargetFileRestored(targetPath) {
  const shortcuts = watchedTargets.get(targetPath);
  if (!shortcuts) return;

  // 通知前端刷新
  if (drawerWindow && !drawerWindow.isDestroyed()) {
    drawerWindow.webContents.send('target-file-restored', {
      targetPath,
      shortcutCount: shortcuts.size
    });
  }
}

/**
 * 验证所有快捷方式
 * @returns {Promise<Object>} { total: number, valid: number, invalid: number, repaired: number }
 */
async function validateAllShortcuts() {
  const drawerRoot = getDrawerRoot();
  const stats = { total: 0, valid: 0, invalid: 0, repaired: 0 };

  try {
    const drawerItems = await fs.promises.readdir(drawerRoot, { withFileTypes: true });
    
    for (const item of drawerItems) {
      if (!item.isDirectory()) continue;

      const drawerPath = path.join(drawerRoot, item.name);
      const entries = await fs.promises.readdir(drawerPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile()) continue;

        const ext = path.extname(entry.name).toLowerCase();
        if (ext !== '.lnk') continue;

        const shortcutPath = path.join(drawerPath, entry.name);
        stats.total++;

        const validation = validateShortcut(shortcutPath);
        
        if (validation.isValid) {
          stats.valid++;
        } else if (validation.targetPath) {
          // 尝试智能修复
          const repair = await attemptShortcutRepair(shortcutPath, validation.targetPath);
          if (repair.repaired) {
            stats.repaired++;
            stats.valid++;
          } else {
            stats.invalid++;
          }
        } else {
          stats.invalid++;
        }
      }
    }
  } catch (err) {
    console.error('[TIDYDESK] Failed to validate shortcuts:', err);
  }

  return stats;
}

/**
 * 启动定期验证
 */
function startPeriodicValidation() {
  // 每30分钟验证一次
  const VALIDATION_INTERVAL = 30 * 60 * 1000;

  if (validationInterval) {
    clearInterval(validationInterval);
  }

  validationInterval = setInterval(async () => {
    console.log('[TIDYDESK] Running periodic validation...');
    const stats = await validateAllShortcuts();
    
    console.log(`[TIDYDESK] Validation complete: ${stats.valid}/${stats.total} valid, ${stats.repaired} repaired, ${stats.invalid} invalid`);
    
    // 如果有修复或失效，通知前端刷新
    if (stats.repaired > 0 || stats.invalid > 0) {
      if (drawerWindow && !drawerWindow.isDestroyed()) {
        drawerWindow.webContents.send('shortcuts-validated', stats);
      }
    }
  }, VALIDATION_INTERVAL);

  console.log('[TIDYDESK] Periodic validation started (every 30 minutes)');
}

/**
 * 停止定期验证
 */
function stopPeriodicValidation() {
  if (validationInterval) {
    clearInterval(validationInterval);
    validationInterval = null;
    console.log('[TIDYDESK] Periodic validation stopped');
  }
}

function getContentWidth() {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const scaleFactor = display.scaleFactor || 1;
  
  // 考虑 DPI 缩放因子，计算逻辑宽度
  const logicalWidth = workArea.width / scaleFactor;
  const targetWidth = Math.max(360, Math.min(Math.round(logicalWidth * 0.3), 560));
  
  // 转换回物理像素
  return Math.round(targetWidth * scaleFactor);
}

function getHandleBounds(expanded) {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 56;
  const height = 172;
  const drawerX = workArea.x + workArea.width - getContentWidth();

  return {
    x: expanded ? drawerX - width : workArea.x + workArea.width - width,
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height
  };
}

function getDrawerWindowBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = getContentWidth();
  return {
    x: workArea.x + workArea.width - width,
    y: workArea.y,
    width,
    height: workArea.height
  };
}

function loadRenderer(win, mode) {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    win.loadURL(`http://localhost:3000?mode=${mode}`);
    if (process.env.TIDYDESK_DEVTOOLS === '1') {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'), { query: { mode } });
  }
}

function applyDrawerBounds(expanded, animate = true) {
  isDrawerExpanded = expanded;

  if (handleWindow) {
    const handleBounds = getHandleBounds(expanded);
    if (animate) {
      animateWindowBounds(handleWindow, handleBounds, 200);
    } else {
      handleWindow.setBounds(handleBounds);
    }
    // 只有在收起状态时才保持手柄置顶，展开时取消置顶
    handleWindow.setAlwaysOnTop(!expanded);
    handleWindow.webContents.send('drawer-state', { expanded });
  }

  if (!drawerWindow) return;

  if (expanded) {
    const targetBounds = getDrawerWindowBounds();
    const { workArea } = screen.getPrimaryDisplay();
    
    // 从屏幕右侧外部开始
    const startBounds = {
      x: workArea.x + workArea.width,
      y: targetBounds.y,
      width: targetBounds.width,
      height: targetBounds.height
    };
    
    drawerWindow.setBounds(startBounds);
    drawerWindow.show();
    
    // 滑入动画
    if (animate) {
      animateWindowBounds(drawerWindow, targetBounds, 250, 'easeOutCubic');
    } else {
      drawerWindow.setBounds(targetBounds);
    }
    
    // 不使用 moveTop()，让窗口按正常 Z-order 显示
    // 只在首次展开时聚焦，之后让用户自由切换窗口
    setTimeout(() => drawerWindow.focus(), 100);
  } else {
    // 滑出动画
    if (animate) {
      const { workArea } = screen.getPrimaryDisplay();
      const currentBounds = drawerWindow.getBounds();
      const targetBounds = {
        x: workArea.x + workArea.width,
        y: currentBounds.y,
        width: currentBounds.width,
        height: currentBounds.height
      };
      
      animateWindowBounds(drawerWindow, targetBounds, 200, 'easeInCubic', () => {
        drawerWindow.hide();
      });
    } else {
      drawerWindow.hide();
    }
  }

  drawerWindow.webContents.send('drawer-state', { expanded });
}

/**
 * 平滑动画窗口位置和大小
 * @param {BrowserWindow} window - 要动画的窗口
 * @param {Object} targetBounds - 目标位置 {x, y, width, height}
 * @param {number} duration - 动画时长（毫秒）
 * @param {string} easing - 缓动函数类型
 * @param {Function} onComplete - 动画完成回调
 */
function animateWindowBounds(window, targetBounds, duration = 250, easing = 'easeOutCubic', onComplete = null) {
  if (!window || window.isDestroyed()) {
    if (onComplete) onComplete();
    return;
  }
  
  const startBounds = window.getBounds();
  const startTime = Date.now();
  
  // 缓动函数
  const easingFunctions = {
    linear: t => t,
    easeInCubic: t => t * t * t,
    easeOutCubic: t => 1 - Math.pow(1 - t, 3),
    easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  };
  
  const easingFunc = easingFunctions[easing] || easingFunctions.easeOutCubic;
  
  function animate() {
    if (!window || window.isDestroyed()) {
      if (onComplete) onComplete();
      return;
    }
    
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easedProgress = easingFunc(progress);
    
    const currentBounds = {
      x: Math.round(startBounds.x + (targetBounds.x - startBounds.x) * easedProgress),
      y: Math.round(startBounds.y + (targetBounds.y - startBounds.y) * easedProgress),
      width: Math.round(startBounds.width + (targetBounds.width - startBounds.width) * easedProgress),
      height: Math.round(startBounds.height + (targetBounds.height - startBounds.height) * easedProgress)
    };
    
    try {
      window.setBounds(currentBounds);
    } catch (err) {
      console.error('[TIDYDESK] Animation error:', err);
      if (onComplete) onComplete();
      return;
    }
    
    if (progress < 1) {
      setTimeout(animate, 16); // ~60fps
    } else {
      if (onComplete) onComplete();
    }
  }
  
  animate();
}

function baseWindowOptions() {
  return {
    minWidth: 48,
    minHeight: 120,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  };
}

function createHandleWindow() {
  handleWindow = new BrowserWindow({
    ...baseWindowOptions(),
    ...getHandleBounds(false),
    alwaysOnTop: true, // 初始收起状态时置顶
    skipTaskbar: false
  });

  loadRenderer(handleWindow, 'handle');
  
  // 等待窗口加载完成后设置圆角遮罩
  handleWindow.webContents.on('did-finish-load', () => {
    // 只在 Windows 11 上应用复杂圆角形状
    if (!isWindows11()) {
      console.log('[TIDYDESK] Windows 10 detected, skipping complex window shape');
      return;
    }
    
    try {
      const { width, height } = handleWindow.getBounds();
      const radius = 32; // 对应 rounded-l-2xl (2rem = 32px)
      
      // 创建圆角矩形路径
      const rects = [];
      
      // 左上圆角区域
      for (let y = 0; y < radius; y++) {
        const x = Math.round(radius - Math.sqrt(radius * radius - (radius - y) * (radius - y)));
        rects.push({ x, y, width: width - x, height: 1 });
      }
      
      // 中间矩形区域
      rects.push({ x: 0, y: radius, width, height: height - 2 * radius });
      
      // 左下圆角区域
      for (let y = 0; y < radius; y++) {
        const x = Math.round(radius - Math.sqrt(radius * radius - y * y));
        rects.push({ x, y: height - radius + y, width: width - x, height: 1 });
      }
      
      handleWindow.setShape(rects);
      console.log('[TIDYDESK] Applied rounded corners for Windows 11');
    } catch (err) {
      console.warn('[TIDYDESK] Failed to apply window shape', err);
    }
  });
  
  handleWindow.on('closed', () => {
    handleWindow = null;
  });
}

function createDrawerWindow() {
  drawerWindow = new BrowserWindow({
    ...baseWindowOptions(),
    ...getDrawerWindowBounds(),
    alwaysOnTop: false,
    skipTaskbar: true
  });

  loadRenderer(drawerWindow, 'drawer');
  drawerWindow.hide();
  
  // 监听窗口失去焦点事件
  drawerWindow.on('blur', () => {
    // 当抽屉失去焦点时，确保它不会遮挡其他窗口
    if (drawerWindow && !drawerWindow.isDestroyed()) {
      drawerWindow.setAlwaysOnTop(false);
    }
  });
  
  // 监听窗口获得焦点事件
  drawerWindow.on('focus', () => {
    // 当抽屉获得焦点时，临时提升层级
    if (drawerWindow && !drawerWindow.isDestroyed()) {
      drawerWindow.moveTop();
    }
  });
  
  drawerWindow.on('closed', () => {
    drawerWindow = null;
  });
}

function createWindows() {
  createDrawerWindow();
  createHandleWindow();
}

app.whenReady().then(() => {
  prepareStorage();
  console.log(`[TIDYDESK] Platform: ${process.platform}`);
  console.log(`[TIDYDESK] OS: ${os.type()} ${os.release()}`);
  console.log(`[TIDYDESK] Windows 11: ${isWindows11()}`);
  console.log(`[TIDYDESK] Desktop: "${getDesktopPath()}"`);
  console.log(`[TIDYDESK] Drawers: "${getDrawerRoot()}"`);
  
  const display = screen.getPrimaryDisplay();
  console.log(`[TIDYDESK] Display: ${display.size.width}x${display.size.height}, Scale: ${display.scaleFactor}`);
  
  // 初始化文件监控
  initializeFileWatcher();
  
  // 启动定期验证
  startPeriodicValidation();
  
  createWindows();
  
  // 检查更新（延迟 3 秒，避免启动时卡顿）
  setTimeout(() => {
    checkForUpdates();
  }, 3000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
  });
});

app.on('window-all-closed', () => {
  // 清理资源
  if (fileWatcher) {
    fileWatcher.close();
  }
  stopPeriodicValidation();
  
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // 应用退出前清理
  if (fileWatcher) {
    fileWatcher.close();
  }
  stopPeriodicValidation();
});

// 全局错误处理
process.on('uncaughtException', (error) => {
  console.error('[TIDYDESK] Uncaught Exception:', error);
  // 不退出应用，让用户可以保存工作
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[TIDYDESK] Unhandled Rejection at:', promise, 'reason:', reason);
});

ipcMain.handle('read-desktop-files', async () => {
  prepareStorage();

  const desktopPath = getDesktopPath();
  const drawerRoot = getDrawerRoot();
  const filesList = [];
  const foldersList = [];
  let fileCounter = 0;
  let folderCounter = 0;

  try {
    const desktopItems = await fs.promises.readdir(desktopPath, { withFileTypes: true });
    for (const item of desktopItems) {
      if (!item.isFile() || isProtectedDesktopItem(item.name)) continue;

      const fullPath = path.join(desktopPath, item.name);
      try {
        const stats = await fs.promises.stat(fullPath);
        const ext = path.extname(item.name);
        filesList.push({
          id: `desktop-file-${++fileCounter}-${stats.ino}`,
          name: item.name,
          path: fullPath,
          size: stats.size,
          category: getCategoryByExtension(ext, item.name),
          extension: ext,
          modifiedAt: stats.mtime.toISOString(),
          isSimulated: false,
          parentId: null
        });
      } catch (err) {
        console.warn(`[TIDYDESK] Failed to inspect desktop item "${item.name}"`, err.message);
      }
    }
  } catch (err) {
    console.warn(`[TIDYDESK] Failed to read desktop for health info`, err.message);
  }

  const drawerItems = await fs.promises.readdir(drawerRoot, { withFileTypes: true });
  for (const item of drawerItems) {
    if (!item.isDirectory()) continue;

    const drawerPath = path.join(drawerRoot, item.name);
    const drawerStats = await fs.promises.stat(drawerPath);
    const folderId = `drawer-${++folderCounter}-${drawerStats.ino}`;
    foldersList.push({
      id: folderId,
      name: item.name,
      path: drawerPath,
      category: 'folder',
      modifiedAt: drawerStats.mtime.toISOString(),
      isSimulated: false,
      parentId: null
    });

    const entries = await fs.promises.readdir(drawerPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const entryPath = path.join(drawerPath, entry.name);
      const entryStats = await fs.promises.stat(entryPath);
      const ext = path.extname(entry.name);
      
      // 验证快捷方式
      let isValid = true;
      let targetPath = null;
      if (ext.toLowerCase() === '.lnk') {
        const validation = validateShortcut(entryPath);
        isValid = validation.isValid;
        targetPath = validation.targetPath;
        
        // 添加到文件监控
        if (targetPath) {
          addFileToWatch(targetPath, entryPath);
        }
      }
      
      filesList.push({
        id: `drawer-file-${++fileCounter}-${entryStats.ino}`,
        name: entry.name,
        path: entryPath,
        size: entryStats.size,
        category: getCategoryByExtension(ext, entry.name),
        extension: ext,
        modifiedAt: entryStats.mtime.toISOString(),
        isSimulated: false,
        parentId: folderId,
        isValid,
        targetPath
      });
    }
  }

  return { files: filesList, folders: foldersList, desktopPath, tidyBoxPath: drawerRoot };
});

ipcMain.handle('create-desktop-folder', async (_event, name) => {
  const targetPath = resolveDrawerPath(name);
  await fs.promises.mkdir(targetPath, { recursive: true });
  return { success: true, path: targetPath };
});

ipcMain.handle('rename-desktop-item', async (_event, { oldName, newName, parentFolder }) => {
  if (!oldName || !newName || !parentFolder) {
    throw new Error('Rename is only allowed for drawer entries.');
  }

  const drawerPath = resolveDrawerPath(parentFolder);
  const oldPath = path.resolve(drawerPath, oldName);
  const newPath = path.resolve(drawerPath, newName);
  if (!isPathInside(oldPath, drawerPath) || !isPathInside(newPath, drawerPath)) {
    throw new Error('Unsafe rename path');
  }

  await fs.promises.rename(oldPath, nextAvailablePath(drawerPath, path.basename(newPath)));
  return { success: true };
});

ipcMain.handle('delete-desktop-item', async (_event, { name, parentFolder }) => {
  // 删除抽屉本身（parentFolder 为 null）
  if (!parentFolder && name) {
    const drawerPath = resolveDrawerPath(name);
    const drawerRoot = getDrawerRoot();
    
    if (!isPathInside(drawerPath, drawerRoot)) {
      throw new Error('Unsafe delete path');
    }
    
    // 递归删除抽屉及其内容
    await fs.promises.rm(drawerPath, { recursive: true, force: true });
    return { success: true };
  }
  
  // 删除抽屉内的文件
  if (!name || !parentFolder) {
    throw new Error('Delete requires name and parentFolder.');
  }

  const drawerPath = resolveDrawerPath(parentFolder);
  const targetPath = path.resolve(drawerPath, name);
  if (!isPathInside(targetPath, drawerPath)) throw new Error('Unsafe delete path');

  const stats = await fs.promises.stat(targetPath);
  if (stats.isDirectory()) {
    // 递归删除子文件夹
    await fs.promises.rm(targetPath, { recursive: true, force: true });
  } else {
    await fs.promises.unlink(targetPath);
  }

  return { success: true };
});

ipcMain.handle('move-desktop-file', async () => {
  throw new Error('Physical file moving is disabled in stable shortcut mode.');
});

ipcMain.handle('tidy-desktop-batch', async () => {
  throw new Error('Batch physical tidy is disabled in stable shortcut mode.');
});

ipcMain.handle('import-external-files', async (_event, { filePaths, targetFolder }) => {
  // 参数验证
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error('Missing files to import');
  }
  
  // 防止批量攻击
  if (filePaths.length > 100) {
    throw new Error('Too many files (max 100 per batch)');
  }
  
  // 验证每个路径
  for (const filePath of filePaths) {
    if (typeof filePath !== 'string' || filePath.length > 260) {
      throw new Error('Invalid file path');
    }
  }

  const targetDir = resolveDrawerPath(targetFolder);
  await fs.promises.mkdir(targetDir, { recursive: true });

  const added = [];
  for (const sourcePath of filePaths) {
    if (!sourcePath || typeof sourcePath !== 'string') continue;

    const resolvedSource = path.resolve(sourcePath);
    if (!fs.existsSync(resolvedSource)) continue;
    if (isPathInside(resolvedSource, getDrawerRoot())) continue;
    if (isProtectedDesktopItem(path.basename(resolvedSource))) continue;

    const shortcutPath = await createDrawerShortcut(resolvedSource, targetDir);
    added.push({ source: resolvedSource, shortcut: shortcutPath, mode: 'shortcut' });
  }

  return { success: true, added };
});

ipcMain.handle('open-desktop-file', async (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string') throw new Error('Missing file path');
  const resolvedPath = path.resolve(filePath);

  if (!isPathInside(resolvedPath, getDrawerRoot())) {
    throw new Error('Only drawer entries can be opened from TidyDesk.');
  }
  if (!fs.existsSync(resolvedPath)) throw new Error('Drawer entry does not exist');

  await shell.openPath(resolvedPath);
  return { success: true };
});

ipcMain.on('window-control', (_event, action) => {
  if (action === 'close') {
    drawerWindow?.close();
    handleWindow?.close();
  }
  if (action === 'minimize') {
    drawerWindow?.minimize();
    handleWindow?.minimize();
  }
  if (action === 'expand-drawer') applyDrawerBounds(true);
  if (action === 'collapse-drawer') applyDrawerBounds(false);
  if (action === 'toggle-drawer') applyDrawerBounds(!isDrawerExpanded);
});

// 手动触发验证所有快捷方式
ipcMain.handle('validate-all-shortcuts', async () => {
  console.log('[TIDYDESK] Manual validation triggered');
  const stats = await validateAllShortcuts();
  return stats;
});

// 尝试修复单个快捷方式
ipcMain.handle('repair-shortcut', async (_event, { shortcutPath, targetPath }) => {
  if (!shortcutPath || !targetPath) {
    throw new Error('Missing shortcutPath or targetPath');
  }

  console.log(`[TIDYDESK] Attempting to repair: ${shortcutPath}`);
  const result = await attemptShortcutRepair(shortcutPath, targetPath);
  
  if (result.repaired) {
    console.log(`[TIDYDESK] Successfully repaired: ${shortcutPath} -> ${result.newPath}`);
  } else {
    console.log(`[TIDYDESK] Failed to repair: ${shortcutPath}`);
  }
  
  return result;
});

// ==================== 自动更新功能 ====================

/**
 * 检查更新
 */
function checkForUpdates() {
  if (process.env.NODE_ENV === 'development') {
    console.log('[TIDYDESK] Skip update check in development mode');
    return;
  }

  console.log('[TIDYDESK] Checking for updates...');
  autoUpdater.checkForUpdates().catch(err => {
    console.error('[TIDYDESK] Failed to check for updates:', err);
  });
}

// 自动更新事件监听
autoUpdater.on('checking-for-update', () => {
  console.log('[TIDYDESK] Checking for update...');
  sendUpdateStatus('checking');
});

autoUpdater.on('update-available', (info) => {
  console.log('[TIDYDESK] Update available:', info.version);
  sendUpdateStatus('available', {
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: info.releaseNotes
  });
});

autoUpdater.on('update-not-available', (info) => {
  console.log('[TIDYDESK] Update not available. Current version:', info.version);
  sendUpdateStatus('not-available', { version: info.version });
});

autoUpdater.on('error', (err) => {
  console.error('[TIDYDESK] Update error:', err);
  sendUpdateStatus('error', { message: err.message });
});

autoUpdater.on('download-progress', (progressObj) => {
  console.log(`[TIDYDESK] Download progress: ${progressObj.percent.toFixed(2)}%`);
  sendUpdateStatus('downloading', {
    percent: progressObj.percent,
    transferred: progressObj.transferred,
    total: progressObj.total,
    bytesPerSecond: progressObj.bytesPerSecond
  });
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('[TIDYDESK] Update downloaded:', info.version);
  sendUpdateStatus('downloaded', {
    version: info.version,
    releaseNotes: info.releaseNotes
  });
});

/**
 * 发送更新状态到前端
 */
function sendUpdateStatus(status, data = {}) {
  if (drawerWindow && !drawerWindow.isDestroyed()) {
    drawerWindow.webContents.send('update-status', { status, ...data });
  }
}

// IPC 处理器：检查更新
ipcMain.handle('check-for-updates', async () => {
  if (process.env.NODE_ENV === 'development') {
    return { 
      status: 'dev-mode', 
      message: '开发模式下不检查更新',
      currentVersion: app.getVersion()
    };
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    return {
      status: 'success',
      currentVersion: app.getVersion(),
      updateInfo: result?.updateInfo || null
    };
  } catch (err) {
    return {
      status: 'error',
      message: err.message,
      currentVersion: app.getVersion()
    };
  }
});

// IPC 处理器：下载更新
ipcMain.handle('download-update', async () => {
  if (process.env.NODE_ENV === 'development') {
    return { status: 'dev-mode', message: '开发模式下不下载更新' };
  }

  try {
    await autoUpdater.downloadUpdate();
    return { status: 'success', message: '开始下载更新' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
});

// IPC 处理器：安装更新并重启
ipcMain.handle('install-update', async () => {
  if (process.env.NODE_ENV === 'development') {
    return { status: 'dev-mode', message: '开发模式下不安装更新' };
  }

  try {
    autoUpdater.quitAndInstall(false, true);
    return { status: 'success', message: '正在安装更新...' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
});

// IPC 处理器：获取当前版本
ipcMain.handle('get-app-version', async () => {
  return {
    version: app.getVersion(),
    name: app.getName(),
    isPackaged: app.isPackaged
  };
});
