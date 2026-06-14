const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { hasEnvVar, loadReleaseEnvFromWindowsUserEnv } = require('./tauri-release-env.cjs');

function hasValue(value) {
  return Boolean(value && String(value).trim());
}

function quoteForCmd(value) {
  const stringValue = String(value);
  if (!/\s/.test(stringValue)) {
    return stringValue;
  }
  return `"${stringValue.replace(/"/g, '\\"')}"`;
}

function tryDecodeBase64(value) {
  try {
    return Buffer.from(String(value).trim(), 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function isEncryptedPrivateKey(encodedKey) {
  const decoded = tryDecodeBase64(encodedKey);
  return Boolean(decoded && decoded.includes('encrypted secret key'));
}

function ensureSigningKeyEnv() {
  loadReleaseEnvFromWindowsUserEnv();

  if (hasValue(process.env.TAURI_SIGNING_PRIVATE_KEY)) {
    const configuredValue = String(process.env.TAURI_SIGNING_PRIVATE_KEY).trim();
    if (fs.existsSync(configuredValue)) {
      const keyContents = fs.readFileSync(configuredValue, 'utf8').trim();
      if (!keyContents) {
        throw new Error(`Signing key file is empty: ${configuredValue}`);
      }
      process.env.TAURI_SIGNING_PRIVATE_KEY = keyContents;
      console.log('[TAURI-UPDATER] loaded signing key from TAURI_SIGNING_PRIVATE_KEY');
    }

    if (
      isEncryptedPrivateKey(process.env.TAURI_SIGNING_PRIVATE_KEY) &&
      !hasEnvVar('TAURI_SIGNING_PRIVATE_KEY_PASSWORD')
    ) {
      throw new Error(
        'Encrypted updater signing key detected. Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD before running a release build.'
      );
    }

    return;
  }

  if (!hasValue(process.env.TAURI_SIGNING_PRIVATE_KEY_PATH)) {
    return;
  }

  const resolvedPath = path.resolve(process.env.TAURI_SIGNING_PRIVATE_KEY_PATH);
  const keyContents = fs.readFileSync(resolvedPath, 'utf8').trim();
  if (!keyContents) {
    throw new Error(`Signing key file is empty: ${resolvedPath}`);
  }

  process.env.TAURI_SIGNING_PRIVATE_KEY = keyContents;
  console.log('[TAURI-UPDATER] loaded signing key from TAURI_SIGNING_PRIVATE_KEY_PATH');

  if (
    isEncryptedPrivateKey(process.env.TAURI_SIGNING_PRIVATE_KEY) &&
    !hasEnvVar('TAURI_SIGNING_PRIVATE_KEY_PASSWORD')
  ) {
    throw new Error(
      'Encrypted updater signing key detected. Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD before running a release build.'
    );
  }
}

function applyReleaseBuildStabilityDefaults() {
  if (!hasEnvVar('CARGO_BUILD_JOBS')) {
    process.env.CARGO_BUILD_JOBS = '1';
    console.log('[TAURI-UPDATER] defaulted CARGO_BUILD_JOBS=1 to reduce peak memory during release builds');
  }
}

function localTauriCliPath() {
  const executableName = process.platform === 'win32' ? 'tauri.cmd' : 'tauri';
  const executablePath = path.join(__dirname, '..', 'node_modules', '.bin', executableName);
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Local Tauri CLI was not found. Run npm install first: ${executablePath}`);
  }
  return executablePath;
}

function main() {
  ensureSigningKeyEnv();
  applyReleaseBuildStabilityDefaults();

  const tauriCommand = localTauriCliPath();
  const tauriArgs = ['build', ...process.argv.slice(2)];
  const spawnOptions = {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 1024 * 1024 * 50
  };
  const result = process.platform === 'win32'
    ? spawnSync(
        process.env.ComSpec || 'cmd.exe',
        ['/d', '/s', '/c', `${quoteForCmd(tauriCommand)} ${tauriArgs.map(quoteForCmd).join(' ')}`],
        spawnOptions
      )
    : spawnSync(tauriCommand, tauriArgs, spawnOptions);

  if (result.error) {
    throw result.error;
  }

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  process.exit(result.status ?? 1);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[TAURI-UPDATER] ${message}`);
  process.exit(1);
}
