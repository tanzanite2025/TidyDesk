const fs = require('fs');
const path = require('path');

function createAppService({ app, shell, config, getDesktopPath, appCache, performanceCore = null, goAppsClient = null }) {
  // 防止竞态条件的锁机制
  let isScanning = false;
  let scanningPromise = null;
  let lastScanDiagnostics = { failedShortcuts: [], skippedShortcuts: [], metadata: null };

  /**
   * 扫描已安装的应用（带缓存和竞态条件保护）
   */
  async function scanInstalledApps(forceRefresh = false) {
    // 使用性能核心的互斥锁（如果可用）
    if (performanceCore) {
      return performanceCore.throttleManager.lock('app-scan', async () => {
        return await scanInstalledAppsInternal(forceRefresh);
      }, 60000); // 60 秒超时
    } else {
      // 降级：使用原有的锁机制
      return await scanInstalledAppsInternal(forceRefresh);
    }
  }

  /**
   * 内部扫描函数（带原有的竞态条件保护）
   */
  async function scanInstalledAppsInternal(forceRefresh = false) {
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
        
        const apps = await scanInstalledAppsRealInternal();
        
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
   * 真正的内部扫描函数（实际扫描逻辑）
   */
  async function scanInstalledAppsRealInternal() {
    if (!goAppsClient) {
      throw new Error('Go apps sidecar client is required for application scanning');
    }
    return scanInstalledAppsWithGoMetadata();
  }

  async function scanInstalledAppsWithGoMetadata() {
    const metadataStart = Date.now();
    const metadata = await goAppsClient.scanMetadata({
      desktopPath: getDesktopPath(),
      maxDepth: config.SCAN.MAX_RECURSION_DEPTH,
      skipDirectories: config.SCAN.SKIP_DIRECTORIES
    });
    const metadataElapsed = Date.now() - metadataStart;
    const shortcuts = Array.isArray(metadata?.shortcuts) ? metadata.shortcuts : [];
    const metadataDuration = typeof metadata?.durationMs === 'number' ? metadata.durationMs : metadataElapsed;
    const diagnostics = {
      failedShortcuts: [],
      skippedShortcuts: [],
      metadata: {
        durationMs: metadataDuration,
        shortcutCount: shortcuts.length,
        scannedPaths: Array.isArray(metadata?.scannedPaths) ? metadata.scannedPaths : []
      }
    };
    console.log(`[TIDYDESK] Go metadata scan completed in ${metadataDuration}ms, found ${shortcuts.length} shortcuts`);

    const apps = [];
    const seenPaths = new Set();
    for (const shortcut of shortcuts) {
      await addShortcutApp(shortcut.shortcutPath, shortcut.name, apps, seenPaths, diagnostics);
    }

    apps.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    lastScanDiagnostics = diagnostics;
    if (diagnostics.failedShortcuts.length > 0 || diagnostics.skippedShortcuts.length > 0) {
      console.log(`[TIDYDESK] Go scan diagnostics: failed=${diagnostics.failedShortcuts.length}, skipped=${diagnostics.skippedShortcuts.length}`);
    }
    console.log(`[TIDYDESK] Go metadata + Electron completion found ${apps.length} installed applications`);
    return apps;
  }

  async function addShortcutApp(shortcutPath, shortcutName, apps, seenPaths, diagnostics) {
    if (!shortcutPath || path.extname(shortcutPath).toLowerCase() !== '.lnk') {
      diagnostics.skippedShortcuts.push({ shortcutPath, reason: 'invalid-shortcut-path' });
      return;
    }

    const displayName = shortcutName || path.basename(shortcutPath, '.lnk');
    const nameLower = displayName.toLowerCase();
    if (
      nameLower.includes('uninstall') ||
      nameLower.includes('unins') ||
      nameLower.includes('setup') ||
      nameLower.includes('installer')
    ) {
      diagnostics.skippedShortcuts.push({ shortcutPath, name: displayName, reason: 'installer-or-uninstaller' });
      return;
    }

    try {
      const shortcutDetails = shell.readShortcutLink(shortcutPath);
      const targetPath = shortcutDetails?.target;

      if (!targetPath) {
        diagnostics.skippedShortcuts.push({ shortcutPath, name: displayName, reason: 'missing-target' });
        return;
      }
      if (seenPaths.has(targetPath)) {
        diagnostics.skippedShortcuts.push({ shortcutPath, name: displayName, targetPath, reason: 'duplicate-target' });
        return;
      }
      if (!fs.existsSync(targetPath)) {
        diagnostics.skippedShortcuts.push({ shortcutPath, name: displayName, targetPath, reason: 'target-not-found' });
        return;
      }
      if (path.extname(targetPath).toLowerCase() !== '.exe') {
        diagnostics.skippedShortcuts.push({ shortcutPath, name: displayName, targetPath, reason: 'target-not-executable' });
        return;
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
        name: displayName,
        shortcutPath,
        targetPath,
        icon,
        category: categorizeApp(displayName, targetPath)
      });
    } catch (err) {
      diagnostics.failedShortcuts.push({ shortcutPath, name: displayName, reason: err.message });
      console.warn(`[TIDYDESK] Failed to complete shortcut ${shortcutPath}`, err.message);
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
      await scanInstalledApps(true);
      const elapsed = Date.now() - startTime;
      console.log(`[TIDYDESK] Incremental update handled by Go full scan in ${elapsed}ms`);
    } catch (err) {
      console.error('[TIDYDESK] Incremental update failed:', err);
      throw err;
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

  return {
    scanInstalledApps,
    refreshApps: () => scanInstalledApps(true), // 强制刷新
    updateSingleApp, // 增量更新
    removeSingleApp  // 增量移除
  };
}

module.exports = createAppService;
