const fs = require('fs');
const path = require('path');
const { hasEnvVar, loadReleaseEnvFromWindowsUserEnv, readWindowsUserEnvVar } = require('./tauri-release-env.cjs');

const hasValue = name => {
  const value = process.env[name];
  return Boolean(value && String(value).trim());
};

const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const tryDecodeBase64 = value => {
  try {
    return Buffer.from(String(value).trim(), 'base64').toString('utf8');
  } catch {
    return null;
  }
};

const isEncryptedPrivateKey = value => {
  const decoded = tryDecodeBase64(value);
  return Boolean(decoded && decoded.includes('encrypted secret key'));
};

const resolveSigningKey = () => {
  if (hasValue('TAURI_SIGNING_PRIVATE_KEY')) {
    const configuredValue = String(process.env.TAURI_SIGNING_PRIVATE_KEY).trim();
    if (fs.existsSync(configuredValue)) {
      return fs.readFileSync(path.resolve(configuredValue), 'utf8').trim();
    }
    return configuredValue;
  }

  if (hasValue('TAURI_SIGNING_PRIVATE_KEY_PATH')) {
    return fs.readFileSync(path.resolve(process.env.TAURI_SIGNING_PRIVATE_KEY_PATH), 'utf8').trim();
  }

  return null;
};

const projectRoot = path.resolve(__dirname, '..');
const tauriConfigPath = path.join(projectRoot, 'src-tauri', 'tauri.conf.json');
const tauriConfig = readJson(tauriConfigPath);
loadReleaseEnvFromWindowsUserEnv();

const missing = [];

if (!hasValue('TAURI_SIGNING_PRIVATE_KEY') && !hasValue('TAURI_SIGNING_PRIVATE_KEY_PATH')) {
  missing.push({
    name: 'TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH',
    message: 'A release build needs the updater signing private key to generate signed artifacts.'
  });
}

const signingKey = resolveSigningKey();
const userSigningKeyPassword = readWindowsUserEnvVar('TAURI_SIGNING_PRIVATE_KEY_PASSWORD');
if (
  signingKey &&
  isEncryptedPrivateKey(signingKey) &&
  !hasEnvVar('TAURI_SIGNING_PRIVATE_KEY_PASSWORD') &&
  !userSigningKeyPassword.present
) {
  missing.push({
    name: 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
    message: 'The configured updater signing key is encrypted. Set the password env var for non-interactive release builds. Use an empty string if the key was created with no password.'
  });
}

const updaterConfig = tauriConfig.plugins?.updater;
if (!updaterConfig || typeof updaterConfig !== 'object') {
  missing.push({
    name: 'src-tauri/tauri.conf.json > plugins.updater',
    message: 'Updater plugin configuration is missing.'
  });
} else {
  const endpoints = Array.isArray(updaterConfig.endpoints) ? updaterConfig.endpoints : [];
  if (endpoints.length === 0) {
    missing.push({
      name: 'src-tauri/tauri.conf.json > plugins.updater.endpoints',
      message: 'At least one updater endpoint must be configured.'
    });
  } else {
    for (const endpoint of endpoints) {
      try {
        new URL(String(endpoint));
      } catch (error) {
        missing.push({
          name: `invalid updater endpoint: ${endpoint}`,
          message: `Updater endpoint is not a valid URL: ${error.message}`
        });
      }
    }
  }

  if (!updaterConfig.pubkey || !String(updaterConfig.pubkey).trim()) {
    missing.push({
      name: 'src-tauri/tauri.conf.json > plugins.updater.pubkey',
      message: 'Updater public key must be embedded in the Tauri config for release builds.'
    });
  }
}

if (tauriConfig.bundle?.createUpdaterArtifacts !== true) {
  missing.push({
    name: 'src-tauri/tauri.conf.json > bundle.createUpdaterArtifacts',
    message: 'Release builds must enable updater artifacts so the installer signature is generated.'
  });
}

if (missing.length === 0) {
  console.log('[TAURI-UPDATER] release configuration looks good');
  process.exit(0);
}

console.error('[TAURI-UPDATER] missing or invalid release configuration:');
for (const item of missing) {
  console.error(`- ${item.name}: ${item.message}`);
}
process.exit(1);
