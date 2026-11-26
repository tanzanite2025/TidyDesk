const fs = require('node:fs');
const path = require('node:path');
const { resolveBundleDir, selectInstallerArtifact } = require('./generate-tauri-latest-json.cjs');

/**
 * Copy exact-version Windows desktop + server release artifacts into one flat directory
 * so `actions/upload-artifact` does not preserve nested workspace paths or stale versions.
 */
function stageWindowsReleaseBundle({
  projectRoot = path.resolve(__dirname, '..'),
  outputDir = path.join(projectRoot, 'release-windows')
} = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const version = String(pkg.version || '').trim();
  if (!version) {
    throw new Error('[CRITICAL] package.json missing valid version for Windows release staging');
  }
  const tauriConfPath = path.join(projectRoot, 'src-tauri', 'tauri.conf.json');
  const productName = fs.existsSync(tauriConfPath)
    ? JSON.parse(fs.readFileSync(tauriConfPath, 'utf8')).productName || 'TidyDesk'
    : 'TidyDesk';

  const bundleDir = resolveBundleDir(projectRoot);
  const { installerName, installerPath, signaturePath } = selectInstallerArtifact(
    bundleDir,
    version,
    productName
  );

  const manifestPath = path.join(projectRoot, 'release-tauri', 'latest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`[CRITICAL] Updater manifest missing at ${manifestPath}`);
  }

  const expectedZipName = `tidydesk-sync-server-v${version}.zip`;
  const serverZipPath = path.join(projectRoot, 'release-server', expectedZipName);
  if (!fs.existsSync(serverZipPath)) {
    throw new Error(`[CRITICAL] Expected server bundle missing at ${serverZipPath}`);
  }

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  fs.copyFileSync(installerPath, path.join(outputDir, installerName));
  fs.copyFileSync(signaturePath, path.join(outputDir, `${installerName}.sig`));
  fs.copyFileSync(manifestPath, path.join(outputDir, 'latest.json'));
  fs.copyFileSync(serverZipPath, path.join(outputDir, expectedZipName));

  return {
    outputDir,
    files: fs.readdirSync(outputDir).sort()
  };
}

/**
 * Fail loudly before publishing a GitHub Release if any expected desktop, updater manifest,
 * signature consistency, download URL match, server archive, or Android APK check fails.
 */
function verifyPublishedBundleDirs({ windowsDir, androidDir, expectedVersion = '' }) {
  if (!fs.existsSync(windowsDir)) {
    throw new Error(`[CRITICAL] Windows release artifact directory missing: ${windowsDir}`);
  }
  if (!fs.existsSync(androidDir)) {
    throw new Error(`[CRITICAL] Android release artifact directory missing: ${androidDir}`);
  }

  const winFiles = fs
    .readdirSync(windowsDir, { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => e.name);
  const androidFiles = fs
    .readdirSync(androidDir, { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => e.name);

  const exeFiles = winFiles.filter(name => name.endsWith('.exe') && !name.endsWith('.exe.sig'));
  const sigFiles = winFiles.filter(name => name.endsWith('.exe.sig'));
  const zipFiles = winFiles.filter(name => name.endsWith('.zip'));
  const apkFiles = androidFiles.filter(name => name.endsWith('.apk'));

  if (exeFiles.length === 0) {
    throw new Error(`[CRITICAL] Missing Windows .exe installer in flat dir ${windowsDir}`);
  }
  for (const exe of exeFiles) {
    if (!sigFiles.includes(`${exe}.sig`)) {
      throw new Error(`[CRITICAL] Missing matching .exe.sig signature for ${exe}`);
    }
    const stat = fs.statSync(path.join(windowsDir, exe));
    if (stat.size <= 0) {
      throw new Error(`[CRITICAL] Installer ${exe} is empty`);
    }
  }
  if (!winFiles.includes('latest.json')) {
    throw new Error(`[CRITICAL] Missing Tauri updater latest.json in flat dir ${windowsDir}`);
  }
  if (zipFiles.length === 0) {
    throw new Error(`[CRITICAL] Missing sync server .zip bundle in flat dir ${windowsDir}`);
  }
  if (apkFiles.length === 0) {
    throw new Error(`[CRITICAL] Missing Android .apk artifact in flat dir ${androidDir}`);
  }

  if (expectedVersion) {
    const expectedZip = `tidydesk-sync-server-v${expectedVersion}.zip`;
    if (!zipFiles.includes(expectedZip)) {
      throw new Error(
        `[CRITICAL] Missing expected server bundle ${expectedZip} in ${windowsDir} (found: ${zipFiles.join(', ')})`
      );
    }
    const expectedApk = `TidyDesk-Mobile-v${expectedVersion}.apk`;
    if (!apkFiles.includes(expectedApk)) {
      throw new Error(
        `[CRITICAL] Missing expected Android APK ${expectedApk} in ${androidDir} (found: ${apkFiles.join(', ')})`
      );
    }
  }

  const manifestRaw = fs.readFileSync(path.join(windowsDir, 'latest.json'), 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (err) {
    throw new Error(
      `[CRITICAL] latest.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!manifest || typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error('[CRITICAL] latest.json missing non-empty version field');
  }
  if (expectedVersion && manifest.version !== expectedVersion) {
    throw new Error(
      `[CRITICAL] latest.json version "${manifest.version}" does not match expected "${expectedVersion}"`
    );
  }
  if (!manifest.platforms || Object.keys(manifest.platforms).length === 0) {
    throw new Error('[CRITICAL] latest.json missing platforms entries');
  }

  for (const [target, info] of Object.entries(manifest.platforms)) {
    if (!info || typeof info.signature !== 'string' || !info.signature.trim() || !info.url) {
      throw new Error(`[CRITICAL] latest.json platform "${target}" missing signature or url`);
    }
    const parsedUrl = new URL(info.url);
    const urlFileName = decodeURIComponent(path.posix.basename(parsedUrl.pathname));
    if (!exeFiles.includes(urlFileName)) {
      throw new Error(
        `[CRITICAL] latest.json URL filename "${urlFileName}" not found among staged installers: ${exeFiles.join(', ')}`
      );
    }
    if (expectedVersion && !parsedUrl.pathname.includes(`/releases/download/v${expectedVersion}/`)) {
      throw new Error(
        `[CRITICAL] latest.json URL "${info.url}" does not point to tag v${expectedVersion}`
      );
    }
    const diskSig = fs.readFileSync(path.join(windowsDir, `${urlFileName}.sig`), 'utf8').trim();
    if (diskSig !== info.signature.trim()) {
      throw new Error(
        `[CRITICAL] latest.json signature mismatch against ${urlFileName}.sig on disk`
      );
    }
  }

  return {
    exeFiles,
    sigFiles,
    zipFiles,
    apkFiles,
    manifestVersion: manifest.version
  };
}

function main() {
  const args = process.argv.slice(2);
  const mode = args[0];
  if (mode === '--stage-windows') {
    const targetDir = args[1]
      ? path.resolve(process.cwd(), args[1])
      : path.resolve(__dirname, '..', 'release-windows');
    const staged = stageWindowsReleaseBundle({ outputDir: targetDir });
    console.log('[TIDYDESK-RELEASE] Staged flat Windows/server release bundle:', staged);
    return;
  }
  if (mode === '--verify-publish') {
    const windowsDir = path.resolve(process.cwd(), args[1] || 'release-bundle/windows');
    const androidDir = path.resolve(process.cwd(), args[2] || 'release-bundle/android');
    const rawTag = (process.env.RELEASE_TAG || '').trim();
    const expectedVersion = rawTag.startsWith('v') ? rawTag.slice(1) : rawTag;
    const summary = verifyPublishedBundleDirs({ windowsDir, androidDir, expectedVersion });
    console.log('[TIDYDESK-RELEASE] Verified all release bundle assets:', summary);
    return;
  }
  throw new Error(
    'Usage: verify-release-bundle.cjs --stage-windows <outDir> | --verify-publish <winDir> <androidDir>'
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  stageWindowsReleaseBundle,
  verifyPublishedBundleDirs
};
