const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const CONFIG = require('../electron/config.cjs');
const createAppService = require('../electron/services/apps.cjs');
const { createAppsCacheSidecarClient } = require('../electron/services/go-sidecar-client.cjs');

function createNoopCache() {
  return {
    loadCache: async () => null,
    saveCache: async () => undefined,
    isCacheValid: () => false
  };
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function findDuplicates(apps, field) {
  const counts = new Map();
  for (const item of apps) {
    const key = normalizeKey(item[field]);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }))
    .slice(0, 30);
}

function summarizeWarnings(warnings) {
  return warnings
    .filter(line => line.includes('Failed to complete shortcut') || line.includes('Failed to get icon'))
    .slice(0, 50);
}

async function main() {
  await app.whenReady();

  const executablePath = path.join(__dirname, '..', 'sidecars', 'apps-cache', 'tidydesk-apps-cache.exe');
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Missing sidecar executable: ${executablePath}`);
  }

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(item => item instanceof Error ? item.message : String(item)).join(' '));
    originalWarn(...args);
  };

  const goAppsClient = createAppsCacheSidecarClient({ app, executablePath });
  const service = createAppService({
    app,
    shell,
    config: CONFIG,
    getDesktopPath: () => app.getPath('desktop'),
    appCache: createNoopCache(),
    goAppsClient
  });

  try {
    const startedAt = Date.now();
    const apps = await service.refreshApps();
    const durationMs = Date.now() - startedAt;
    const duplicateTargets = findDuplicates(apps, 'targetPath');

    console.log('[APP-SCAN-DIAGNOSTICS] report:', JSON.stringify({
      count: apps.length,
      durationMs,
      iconless: apps.filter(item => !item.icon).length,
      duplicateTargets,
      warnings: summarizeWarnings(warnings),
      sample: apps.slice(0, 5).map(item => ({
        name: item.name,
        category: item.category,
        targetPath: item.targetPath,
        hasIcon: Boolean(item.icon)
      }))
    }, null, 2));
  } finally {
    console.warn = originalWarn;
    goAppsClient.stop();
    app.quit();
  }
}

main().catch(err => {
  console.error('[APP-SCAN-DIAGNOSTICS] failed:', err);
  app.quit();
  process.exitCode = 1;
});
