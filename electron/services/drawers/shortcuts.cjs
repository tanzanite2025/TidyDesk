const path = require('path');
const fs = require('fs');
const os = require('os');

function createShortcutService({ shell, config, storage }) {
  async function moveFileToDrawer(sourcePath, targetDir) {
    if (!fs.existsSync(sourcePath)) {
      throw new Error('Source file does not exist');
    }

    const systemPaths = [
      ...config.SYSTEM_PATHS,
      process.env.SYSTEMROOT,
      process.env.WINDIR
    ].filter(Boolean);

    const resolvedSource = path.resolve(sourcePath).toLowerCase();
    for (const sysPath of systemPaths) {
      if (sysPath && resolvedSource.startsWith(sysPath.toLowerCase())) {
        throw new Error('Cannot move system files');
      }
    }

    const itemName = path.basename(sourcePath);
    const ext = path.extname(itemName).toLowerCase();
    const desktopPath = storage.getDesktopPath();
    const isFromDesktop = storage.isPathInside(sourcePath, desktopPath);

    if (ext === '.lnk' || ext === '.url') {
      const copiedShortcutPath = storage.nextAvailablePath(targetDir, itemName);
      await fs.promises.copyFile(sourcePath, copiedShortcutPath);

      if (isFromDesktop) {
        await fs.promises.unlink(sourcePath);
      }

      return {
        shortcutPath: copiedShortcutPath,
        storagePath: null,
        originalPath: sourcePath,
        moved: isFromDesktop
      };
    }

    const storageRoot = storage.getFileStorageRoot();
    const storageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const storageDir = path.join(storageRoot, storageId);
    await fs.promises.mkdir(storageDir, { recursive: true });

    const storagePath = path.join(storageDir, itemName);

    if (isFromDesktop) {
      await fs.promises.rename(sourcePath, storagePath);
      console.log(`[TIDYDESK] Moved file from desktop: ${sourcePath} -> ${storagePath}`);
    } else {
      await fs.promises.copyFile(sourcePath, storagePath);
      console.log(`[TIDYDESK] Copied file: ${sourcePath} -> ${storagePath}`);
    }

    const sourceStats = await fs.promises.stat(storagePath);
    const shortcutPath = storage.nextAvailablePath(targetDir, `${itemName}.lnk`);
    const ok = shell.writeShortcutLink(shortcutPath, 'create', {
      target: storagePath,
      cwd: sourceStats.isDirectory() ? storagePath : path.dirname(storagePath),
      description: `TidyDesk managed file: ${itemName}`
    });

    if (!ok) {
      if (isFromDesktop) {
        await fs.promises.rename(storagePath, sourcePath);
      }
      throw new Error(`Failed to create shortcut for "${sourcePath}"`);
    }

    return {
      shortcutPath,
      storagePath,
      originalPath: sourcePath,
      moved: isFromDesktop
    };
  }

  async function createDrawerShortcut(sourcePath, targetDir) {
    const result = await moveFileToDrawer(sourcePath, targetDir);
    return result.shortcutPath;
  }

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

  function validateShortcut(shortcutPath) {
    const targetPath = resolveShortcutTarget(shortcutPath);

    if (!targetPath) {
      return { isValid: false, targetPath: null };
    }

    const isValid = fs.existsSync(targetPath);
    return { isValid, targetPath };
  }

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

  async function validateAllShortcuts() {
    const drawerRoot = storage.getDrawerRoot();
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

  async function repairShortcut({ shortcutPath, targetPath }) {
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
  }

  return {
    moveFileToDrawer,
    createDrawerShortcut,
    resolveShortcutTarget,
    validateShortcut,
    attemptShortcutRepair,
    validateAllShortcuts,
    repairShortcut
  };
}

module.exports = createShortcutService;
