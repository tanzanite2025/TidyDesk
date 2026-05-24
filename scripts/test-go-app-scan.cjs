const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const CONFIG = require('../electron/config.cjs');
const createAppCacheService = require('../electron/services/app-cache.cjs');
const createAppService = require('../electron/services/apps.cjs');
const { createAppsCacheSidecarClient } = require('../electron/services/go-sidecar-client.cjs');

async function main() {
  await app.whenReady();

  const executablePath = path.join(__dirname, '..', 'sidecars', 'apps-cache', 'tidydesk-apps-cache.exe');
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Missing sidecar executable: ${executablePath}`);
  }

  const goAppsClient = createAppsCacheSidecarClient({ app, executablePath });
  const appCache = createAppCacheService({ app });
  const appService = createAppService({
    app,
    shell,
    config: CONFIG,
    getDesktopPath: () => app.getPath('desktop'),
    appCache,
    goAppsClient
  });

  try {
    const startedAt = Date.now();
    const apps = await appService.refreshApps();
    const durationMs = Date.now() - startedAt;

    console.log('[GO-APP-SCAN] result:', {
      appCount: apps.length,
      durationMs,
      sample: apps.slice(0, 5).map(item => ({
        name: item.name,
        category: item.category,
        hasIcon: Boolean(item.icon),
        targetPath: item.targetPath
      }))
    });
  } finally {
    goAppsClient.stop();
    app.quit();
  }
}

main().catch(err => {
  console.error('[GO-APP-SCAN] test failed:', err);
  app.quit();
  process.exitCode = 1;
});
