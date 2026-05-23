const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.setName('TidyDesk');

let handleWindow;
let drawerWindow;
let isDrawerExpanded = false;
const defaultDrawerName = '收纳抽屉';

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
  
  createWindows();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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
      filesList.push({
        id: `drawer-file-${++fileCounter}-${entryStats.ino}`,
        name: entry.name,
        path: entryPath,
        size: entryStats.size,
        category: getCategoryByExtension(ext, entry.name),
        extension: ext,
        modifiedAt: entryStats.mtime.toISOString(),
        isSimulated: false,
        parentId: folderId
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
  if (!name || !parentFolder) {
    throw new Error('Delete is only allowed for drawer shortcuts.');
  }

  const drawerPath = resolveDrawerPath(parentFolder);
  const targetPath = path.resolve(drawerPath, name);
  if (!isPathInside(targetPath, drawerPath)) throw new Error('Unsafe delete path');

  const stats = await fs.promises.stat(targetPath);
  if (stats.isDirectory()) {
    throw new Error('Deleting folders from the drawer is not enabled yet.');
  }

  await fs.promises.unlink(targetPath);
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
