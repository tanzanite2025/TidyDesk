const fs = require('fs');
const path = require('path');
const { createGoSidecarClient } = require('../electron/services/go-sidecar-client.cjs');

async function main() {
  const packageRoot = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '..', 'release', 'win-unpacked');
  const resourcesPath = path.join(packageRoot, 'resources');
  const sidecarPath = path.join(resourcesPath, 'sidecars', 'apps-cache', 'tidydesk-apps-cache.exe');

  if (!fs.existsSync(packageRoot)) {
    throw new Error(`Packaged app directory not found: ${packageRoot}`);
  }
  if (!fs.existsSync(resourcesPath)) {
    throw new Error(`Packaged resources directory not found: ${resourcesPath}`);
  }
  if (!fs.existsSync(sidecarPath)) {
    throw new Error(`Packaged sidecar not found: ${sidecarPath}`);
  }

  const stats = fs.statSync(sidecarPath);
  const client = createGoSidecarClient({
    executablePath: sidecarPath,
    cwd: path.dirname(sidecarPath),
    timeoutMs: 5000
  });

  try {
    const ping = await client.request('ping');
    const version = await client.request('sidecar.version');
    const health = await client.request('sidecar.health');

    console.log('[PACKAGED-SIDECAR] verified:', {
      packageRoot,
      sidecarPath,
      size: stats.size,
      ping,
      name: version.name,
      version: version.version,
      protocolVersion: version.protocolVersion,
      runtime: version.runtime,
      methods: Array.isArray(version.methods) ? version.methods.length : 0,
      status: health.status
    });
  } finally {
    client.stop();
  }
}

main().catch(err => {
  console.error('[PACKAGED-SIDECAR] verification failed:', err);
  process.exitCode = 1;
});
