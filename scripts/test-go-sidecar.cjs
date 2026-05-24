const path = require('path');
const { app } = require('electron');
const { createAppsCacheSidecarClient } = require('../electron/services/go-sidecar-client.cjs');

async function main() {
  await app.whenReady();

  const executablePath = path.join(__dirname, '..', 'sidecars', 'apps-cache', 'tidydesk-apps-cache.exe');
  const client = createAppsCacheSidecarClient({ app, executablePath });

  try {
    const ping = await client.ping();
    console.log('[GO-SIDECAR] ping:', ping);

    const version = await client.getVersion();
    console.log('[GO-SIDECAR] version:', {
      name: version.name,
      version: version.version,
      protocolVersion: version.protocolVersion,
      runtime: version.runtime,
      methods: version.methods
    });

    const health = await client.getHealth();
    console.log('[GO-SIDECAR] health:', {
      status: health.status,
      uptimeMs: health.uptimeMs,
      methods: health.methods?.length
    });

    const cacheInfo = await client.getCacheInfo();
    console.log('[GO-SIDECAR] cacheInfo:', cacheInfo);

    const cache = await client.readCache();
    const appCount = Array.isArray(cache.apps) ? cache.apps.length : 0;
    console.log('[GO-SIDECAR] readCache:', {
      version: cache.version,
      timestamp: cache.timestamp,
      appCount
    });

    const metadata = await client.scanMetadata();
    console.log('[GO-SIDECAR] scanMetadata:', {
      scannedPaths: metadata.scannedPaths,
      shortcutCount: metadata.shortcuts.length,
      durationMs: metadata.durationMs,
      sample: metadata.shortcuts.slice(0, 5).map(item => ({
        name: item.name,
        source: item.source,
        category: item.category
      }))
    });
  } finally {
    client.stop();
    app.quit();
  }
}

main().catch(err => {
  console.error('[GO-SIDECAR] test failed:', err);
  app.quit();
  process.exitCode = 1;
});
