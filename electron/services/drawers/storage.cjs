const path = require('path');
const fs = require('fs');

function createDrawerStorage({ app, shell, config }) {
  const defaultDrawerName = '收纳抽屉';
  let shortcutService = null;
  let watcherService = null;

  function setRuntimeServices({ shortcuts, watcher }) {
    shortcutService = shortcuts;
    watcherService = watcher;
  }

  function requireShortcutService() {
    if (!shortcutService) throw new Error('Shortcut service is not initialized');
    return shortcutService;
  }

  function getFileStorageRoot() {
    return path.join(app.getPath('userData'), 'storage');
  }

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
      console.warn('[TIDYDESK] Legacy drawer cleanup skipped', err.message);
    }
  }

  function prepareStorage() {
    ensureDir(getDrawerRoot());
    ensureDir(getFileStorageRoot());
    migrateLegacyDrawers();
    ensureDir(resolveDrawerPath(defaultDrawerName));
  }

  async function readDesktopFiles() {
    prepareStorage();

    const shortcuts = requireShortcutService();
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
      console.warn('[TIDYDESK] Failed to read desktop for health info', err.message);
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
        let isValid = true;
        let targetPath = null;
        let displayName = entry.name;
        let iconPath = null;

        if (ext.toLowerCase() === '.lnk') {
          const validation = shortcuts.validateShortcut(entryPath);
          isValid = validation.isValid;
          targetPath = validation.targetPath;
          displayName = entry.name.slice(0, -4);

          if (isValid && targetPath) {
            try {
              const icon = await app.getFileIcon(targetPath, { size: 'normal' });
              iconPath = icon.toDataURL();
            } catch (err) {
              console.warn(`[TIDYDESK] Failed to get icon for ${targetPath}`, err.message);
            }
          }

          if (targetPath && watcherService) {
            watcherService.addFileToWatch(targetPath, entryPath);
          }
        }

        filesList.push({
          id: `drawer-file-${++fileCounter}-${entryStats.ino}`,
          name: displayName,
          path: entryPath,
          size: entryStats.size,
          category: getCategoryByExtension(ext, entry.name),
          extension: ext,
          modifiedAt: entryStats.mtime.toISOString(),
          isSimulated: false,
          parentId: folderId,
          isValid,
          targetPath,
          icon: iconPath
        });
      }
    }

    return { files: filesList, folders: foldersList, desktopPath, tidyBoxPath: drawerRoot };
  }

  async function createDesktopFolder(name) {
    const targetPath = resolveDrawerPath(name);
    await fs.promises.mkdir(targetPath, { recursive: true });
    return { success: true, path: targetPath };
  }

  async function renameDesktopItem({ oldName, newName, parentFolder }) {
    if (!oldName || !newName) {
      throw new Error('oldName and newName are required');
    }

    if (!parentFolder) {
      const drawerRoot = getDrawerRoot();
      const oldPath = resolveDrawerPath(oldName);
      const newPath = resolveDrawerPath(newName);

      if (!isPathInside(oldPath, drawerRoot) || !isPathInside(newPath, drawerRoot)) {
        throw new Error('Unsafe rename path');
      }

      if (!fs.existsSync(oldPath)) {
        throw new Error('Drawer does not exist');
      }

      if (fs.existsSync(newPath)) {
        throw new Error('A drawer with this name already exists');
      }

      await fs.promises.rename(oldPath, newPath);
      return { success: true };
    }

    const drawerPath = resolveDrawerPath(parentFolder);
    const oldPath = path.resolve(drawerPath, oldName);
    const newPath = path.resolve(drawerPath, newName);

    if (!isPathInside(oldPath, drawerPath) || !isPathInside(newPath, drawerPath)) {
      throw new Error('Unsafe rename path');
    }

    await fs.promises.rename(oldPath, nextAvailablePath(drawerPath, path.basename(newPath)));
    return { success: true };
  }

  async function deleteDesktopItem({ name, parentFolder }) {
    if (!parentFolder && name) {
      const drawerPath = resolveDrawerPath(name);
      const drawerRoot = getDrawerRoot();

      if (!isPathInside(drawerPath, drawerRoot)) {
        throw new Error('Unsafe delete path');
      }

      await fs.promises.rm(drawerPath, { recursive: true, force: true });
      return { success: true };
    }

    if (!name || !parentFolder) {
      throw new Error('Delete requires name and parentFolder.');
    }

    const drawerPath = resolveDrawerPath(parentFolder);
    const targetPath = path.resolve(drawerPath, name);
    if (!isPathInside(targetPath, drawerPath)) throw new Error('Unsafe delete path');

    // 如果是快捷方式，从文件监控中移除
    const ext = path.extname(targetPath).toLowerCase();
    if (ext === '.lnk' && watcherService) {
      watcherService.removeFileFromWatch(targetPath);
    }

    const stats = await fs.promises.stat(targetPath);
    if (stats.isDirectory()) {
      await fs.promises.rm(targetPath, { recursive: true, force: true });
    } else {
      await fs.promises.unlink(targetPath);
    }

    console.log(`[TIDYDESK] Deleted item: ${targetPath}`);
    return { success: true };
  }

  async function importExternalFiles({ filePaths, targetFolder }) {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      throw new Error('Missing files to import');
    }

    if (filePaths.length > 100) {
      throw new Error('Too many files (max 100 per batch)');
    }

    for (const filePath of filePaths) {
      if (typeof filePath !== 'string' || filePath.length > 260) {
        throw new Error('Invalid file path');
      }
    }

    const shortcuts = requireShortcutService();
    const targetDir = resolveDrawerPath(targetFolder);
    await fs.promises.mkdir(targetDir, { recursive: true });

    const added = [];
    for (const sourcePath of filePaths) {
      if (!sourcePath || typeof sourcePath !== 'string') continue;

      const resolvedSource = path.resolve(sourcePath);
      if (!fs.existsSync(resolvedSource)) continue;
      if (isPathInside(resolvedSource, getDrawerRoot())) continue;
      if (isProtectedDesktopItem(path.basename(resolvedSource))) continue;

      const shortcutPath = await shortcuts.createDrawerShortcut(resolvedSource, targetDir);
      added.push({ source: resolvedSource, shortcut: shortcutPath, mode: 'shortcut' });
    }

    return { success: true, added };
  }

  async function openDesktopFile(filePath) {
    if (!filePath || typeof filePath !== 'string') throw new Error('Missing file path');
    const resolvedPath = path.resolve(filePath);

    if (!isPathInside(resolvedPath, getDrawerRoot())) {
      throw new Error('Only drawer entries can be opened from TidyDesk.');
    }
    if (!fs.existsSync(resolvedPath)) throw new Error('Drawer entry does not exist');

    await shell.openPath(resolvedPath);
    return { success: true };
  }

  async function restoreToDesktop({ shortcutPath }) {
    if (!shortcutPath || typeof shortcutPath !== 'string') {
      throw new Error('Missing shortcut path');
    }

    const shortcuts = requireShortcutService();
    const resolvedShortcut = path.resolve(shortcutPath);

    if (!isPathInside(resolvedShortcut, getDrawerRoot())) {
      throw new Error('Only drawer entries can be restored');
    }

    if (!fs.existsSync(resolvedShortcut)) {
      throw new Error('Shortcut does not exist');
    }

    const ext = path.extname(resolvedShortcut).toLowerCase();
    if (ext !== '.lnk') {
      throw new Error('Only .lnk shortcuts can be restored');
    }

    const targetPath = shortcuts.resolveShortcutTarget(resolvedShortcut);
    if (!targetPath || !fs.existsSync(targetPath)) {
      throw new Error('Target file does not exist');
    }

    const storageRoot = getFileStorageRoot();
    const isInStorage = isPathInside(targetPath, storageRoot);

    if (!isInStorage) {
      throw new Error('File is not managed by TidyDesk (not in storage)');
    }

    const desktopPath = getDesktopPath();
    const fileName = path.basename(targetPath);
    const destPath = nextAvailablePath(desktopPath, fileName);

    await fs.promises.rename(targetPath, destPath);
    console.log(`[TIDYDESK] Restored file to desktop: ${targetPath} -> ${destPath}`);

    await fs.promises.unlink(resolvedShortcut);

    const storageDir = path.dirname(targetPath);
    try {
      const remaining = await fs.promises.readdir(storageDir);
      if (remaining.length === 0) {
        await fs.promises.rmdir(storageDir);
      }
    } catch (err) {
      console.warn(`[TIDYDESK] Failed to cleanup storage dir: ${storageDir}`, err.message);
    }

    return { success: true, restoredPath: destPath };
  }

  async function addAppToDrawer({ shortcutPath, targetFolder }) {
    if (!shortcutPath || typeof shortcutPath !== 'string') {
      throw new Error('Missing shortcut path');
    }

    if (!fs.existsSync(shortcutPath)) {
      throw new Error('Shortcut does not exist');
    }

    const targetDir = resolveDrawerPath(targetFolder);
    await fs.promises.mkdir(targetDir, { recursive: true });

    const fileName = path.basename(shortcutPath);
    const destPath = nextAvailablePath(targetDir, fileName);
    await fs.promises.copyFile(shortcutPath, destPath);

    console.log(`[TIDYDESK] Added app to drawer: ${shortcutPath} -> ${destPath}`);

    return { success: true, path: destPath };
  }

  return {
    setRuntimeServices,
    getFileStorageRoot,
    getDesktopPath,
    getDrawerRoot,
    isPathInside,
    resolveDrawerPath,
    nextAvailablePath,
    prepareStorage,
    readDesktopFiles,
    createDesktopFolder,
    renameDesktopItem,
    deleteDesktopItem,
    importExternalFiles,
    openDesktopFile,
    restoreToDesktop,
    addAppToDrawer
  };
}

module.exports = createDrawerStorage;
