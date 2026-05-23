const fs = require('fs');
const path = require('path');
const os = require('os');

function createAppService({ app, shell, config, getDesktopPath, appCache }) {
  /**
   * 扫描已安装的应用（带缓存）
   */
  async function scanInstalledApps(forceRefresh = false) {
    // 如果不是强制刷新，尝试使用缓存
    if (!forceRefresh) {
      const cache = await appCache.loadCache();
      if (cache && appCache.isCacheValid(cache)) {
        console.log('[TIDYDESK] Using cached apps (fast path)');
        return cache.apps;
      }
    }

    // 缓存无效或强制刷新，执行完整扫描
    console.log('[TIDYDESK] Scanning installed apps (slow path)...');
    const startTime = Date.now();
    
    const apps = await scanInstalledAppsInternal();
    
    const elapsed = Date.now() - startTime;
    console.log(`[TIDYDESK] Scan completed in ${elapsed}ms, found ${apps.length} apps`);
    
    // 保存到缓存
    await appCache.saveCache(apps);
    
    return apps;
  }

  /**
   * 内部扫描函数（实际扫描逻辑）
   */
  async function scanInstalledAppsInternal() {
    const apps = [];
    const seenPaths = new Set();
    const startMenuPaths = [
      path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
      path.join(os.homedir(), 'AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs')
    ];

    for (const startMenuPath of startMenuPaths) {
      if (!fs.existsSync(startMenuPath)) continue;

      try {
        await scanDirectoryForApps(startMenuPath, apps, seenPaths);
      } catch (err) {
        console.warn(`[TIDYDESK] Failed to scan ${startMenuPath}`, err.message);
      }
    }

    try {
      await scanDirectoryForApps(getDesktopPath(), apps, seenPaths, false);
    } catch (err) {
      console.warn('[TIDYDESK] Failed to scan desktop', err.message);
    }

    apps.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    console.log(`[TIDYDESK] Found ${apps.length} installed applications`);
    return apps;
  }

  async function scanDirectoryForApps(dirPath, apps, seenPaths, recursive = true, depth = 0) {
    if (depth > config.SCAN.MAX_RECURSION_DEPTH) return;

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory() && recursive) {
          if (!config.SCAN.SKIP_DIRECTORIES.includes(entry.name)) {
            await scanDirectoryForApps(fullPath, apps, seenPaths, recursive, depth + 1);
          }
          continue;
        }

        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.lnk') {
          continue;
        }

        try {
          const shortcutDetails = shell.readShortcutLink(fullPath);
          const targetPath = shortcutDetails?.target;

          if (!targetPath || seenPaths.has(targetPath)) continue;
          if (!fs.existsSync(targetPath)) continue;
          if (path.extname(targetPath).toLowerCase() !== '.exe') continue;

          const nameLower = entry.name.toLowerCase();
          if (
            nameLower.includes('uninstall') ||
            nameLower.includes('unins') ||
            nameLower.includes('setup') ||
            nameLower.includes('installer')
          ) {
            continue;
          }

          seenPaths.add(targetPath);

          let icon = null;
          try {
            const iconImage = await app.getFileIcon(targetPath, { size: 'normal' });
            icon = iconImage.toDataURL();
          } catch (err) {
            console.warn(`[TIDYDESK] Failed to get icon for ${targetPath}`);
          }

          apps.push({
            name: entry.name.replace('.lnk', ''),
            shortcutPath: fullPath,
            targetPath,
            icon,
            category: categorizeApp(entry.name, targetPath)
          });
        } catch (err) {
          console.warn(`[TIDYDESK] Failed to read shortcut ${fullPath}`, err.message);
        }
      }
    } catch (err) {
      console.warn(`[TIDYDESK] Failed to scan directory ${dirPath}`, err.message);
    }
  }

  function categorizeApp(name, targetPath) {
    const nameLower = name.toLowerCase();
    const pathLower = targetPath.toLowerCase();

    if (
      nameLower.includes('chrome') ||
      nameLower.includes('firefox') ||
      nameLower.includes('edge') ||
      nameLower.includes('browser')
    ) {
      return 'browser';
    }

    if (
      nameLower.includes('visual studio') ||
      nameLower.includes('vscode') ||
      nameLower.includes('code') ||
      nameLower.includes('git') ||
      pathLower.includes('\\microsoft vs code\\')
    ) {
      return 'development';
    }

    if (
      nameLower.includes('word') ||
      nameLower.includes('excel') ||
      nameLower.includes('powerpoint') ||
      nameLower.includes('office') ||
      nameLower.includes('wps')
    ) {
      return 'office';
    }

    if (
      nameLower.includes('wechat') ||
      nameLower.includes('qq') ||
      nameLower.includes('dingtalk') ||
      nameLower.includes('teams') ||
      nameLower.includes('微信') ||
      nameLower.includes('钉钉')
    ) {
      return 'communication';
    }

    if (
      nameLower.includes('player') ||
      nameLower.includes('music') ||
      nameLower.includes('video') ||
      nameLower.includes('photoshop')
    ) {
      return 'media';
    }

    return 'other';
  }

  return {
    scanInstalledApps,
    refreshApps: () => scanInstalledApps(true) // 强制刷新
  };
}

module.exports = createAppService;
