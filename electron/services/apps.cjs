const fs = require('fs');
const path = require('path');
const os = require('os');

function createAppService({ app, shell, config, getDesktopPath, appCache }) {
  // 防止竞态条件的锁机制
  let isScanning = false;
  let scanningPromise = null;

  /**
   * 扫描已安装的应用（带缓存和竞态条件保护）
   */
  async function scanInstalledApps(forceRefresh = false) {
    // 如果正在扫描，返回现有的 Promise
    if (isScanning && scanningPromise) {
      console.log('[TIDYDESK] Scan already in progress, waiting...');
      return scanningPromise;
    }

    isScanning = true;
    scanningPromise = (async () => {
      try {
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
      } finally {
        isScanning = false;
        scanningPromise = null;
      }
    })();

    return scanningPromise;
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

  /**
   * 增量更新：添加或更新单个应用
   */
  async function updateSingleApp({ appKey, appName, installLocation }) {
    console.log(`[TIDYDESK] Incremental update: ${appName}`);
    
    try {
      const startTime = Date.now();
      
      // 1. 尝试在开始菜单中找到快捷方式
      const app = await findAppShortcut(appName, installLocation);
      
      if (!app) {
        console.log(`[TIDYDESK] Could not find shortcut for: ${appName}`);
        return;
      }
      
      // 2. 加载当前缓存
      const cache = await appCache.loadCache();
      if (!cache || !cache.apps) {
        console.log('[TIDYDESK] No cache found, triggering full scan');
        await scanInstalledApps(true);
        return;
      }
      
      // 3. 更新或添加到缓存
      const existingIndex = cache.apps.findIndex(a => 
        a.targetPath === app.targetPath || a.name === app.name
      );
      
      if (existingIndex >= 0) {
        cache.apps[existingIndex] = app;
        console.log(`[TIDYDESK] Updated app: ${app.name}`);
      } else {
        cache.apps.push(app);
        cache.apps.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        console.log(`[TIDYDESK] Added new app: ${app.name}`);
      }
      
      // 4. 保存缓存
      await appCache.saveCache(cache.apps);
      
      const elapsed = Date.now() - startTime;
      console.log(`[TIDYDESK] Incremental update completed in ${elapsed}ms`);
    } catch (err) {
      console.error('[TIDYDESK] Incremental update failed:', err);
      // 失败时触发全量扫描
      console.log('[TIDYDESK] Falling back to full scan');
      await scanInstalledApps(true);
    }
  }

  /**
   * 增量更新：移除单个应用
   */
  async function removeSingleApp({ appKey, appName }) {
    console.log(`[TIDYDESK] Incremental removal: ${appName}`);
    
    try {
      const startTime = Date.now();
      
      // 1. 加载当前缓存
      const cache = await appCache.loadCache();
      if (!cache || !cache.apps) {
        console.log('[TIDYDESK] No cache found, skipping removal');
        return;
      }
      
      // 2. 从缓存中移除
      const originalLength = cache.apps.length;
      cache.apps = cache.apps.filter(app => 
        !app.name.includes(appName) && !app.targetPath.includes(appName)
      );
      
      const removed = originalLength - cache.apps.length;
      
      if (removed > 0) {
        console.log(`[TIDYDESK] Removed ${removed} app(s): ${appName}`);
        
        // 3. 保存缓存
        await appCache.saveCache(cache.apps);
        
        const elapsed = Date.now() - startTime;
        console.log(`[TIDYDESK] Incremental removal completed in ${elapsed}ms`);
      } else {
        console.log(`[TIDYDESK] App not found in cache: ${appName}`);
      }
    } catch (err) {
      console.error('[TIDYDESK] Incremental removal failed:', err);
    }
  }

  /**
   * 在开始菜单中查找应用快捷方式
   */
  async function findAppShortcut(appName, installLocation) {
    const startMenuPaths = [
      path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
      path.join(os.homedir(), 'AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs')
    ];

    for (const startMenuPath of startMenuPaths) {
      if (!fs.existsSync(startMenuPath)) continue;

      try {
        const app = await searchForShortcut(startMenuPath, appName, installLocation);
        if (app) return app;
      } catch (err) {
        console.warn(`[TIDYDESK] Error searching ${startMenuPath}:`, err.message);
      }
    }

    return null;
  }

  /**
   * 递归搜索快捷方式
   */
  async function searchForShortcut(dirPath, appName, installLocation, depth = 0) {
    if (depth > 3) return null;

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          const result = await searchForShortcut(fullPath, appName, installLocation, depth + 1);
          if (result) return result;
          continue;
        }

        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.lnk') {
          continue;
        }

        // 检查文件名是否匹配
        const fileName = entry.name.replace('.lnk', '');
        if (!fileName.toLowerCase().includes(appName.toLowerCase())) {
          continue;
        }

        try {
          const shortcutDetails = shell.readShortcutLink(fullPath);
          const targetPath = shortcutDetails?.target;

          if (!targetPath || !fs.existsSync(targetPath)) continue;
          if (path.extname(targetPath).toLowerCase() !== '.exe') continue;

          // 获取图标
          let icon = null;
          try {
            const iconImage = await app.getFileIcon(targetPath, { size: 'normal' });
            icon = iconImage.toDataURL();
          } catch (err) {
            console.warn(`[TIDYDESK] Failed to get icon for ${targetPath}`);
          }

          return {
            name: fileName,
            shortcutPath: fullPath,
            targetPath,
            icon,
            category: categorizeApp(fileName, targetPath)
          };
        } catch (err) {
          console.warn(`[TIDYDESK] Failed to read shortcut ${fullPath}:`, err.message);
        }
      }
    } catch (err) {
      console.warn(`[TIDYDESK] Failed to search directory ${dirPath}:`, err.message);
    }

    return null;
  }

  return {
    scanInstalledApps,
    refreshApps: () => scanInstalledApps(true), // 强制刷新
    updateSingleApp, // 增量更新
    removeSingleApp  // 增量移除
  };
}

module.exports = createAppService;
