const { spawnSync } = require('child_process');

function hasEnvVar(name) {
  return Object.prototype.hasOwnProperty.call(process.env, name);
}

function readWindowsUserEnvVar(name) {
  if (process.platform !== 'win32') {
    return { present: false, value: undefined };
  }

  const result = spawnSync('reg.exe', ['query', 'HKCU\\Environment', '/v', name], {
    encoding: 'utf8',
    env: process.env
  });

  if (result.status !== 0 || !result.stdout) {
    return { present: false, value: undefined };
  }

  const line = result.stdout
    .split(/\r?\n/)
    .find(nextLine => nextLine.trimStart().startsWith(`${name}    REG_`) || nextLine.trimStart().startsWith(`${name}\tREG_`));

  if (!line) {
    return { present: false, value: undefined };
  }

  const match = line.match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s*(.*)$`));
  if (!match) {
    return { present: false, value: undefined };
  }

  return { present: true, value: match[1] ?? '' };
}

function loadReleaseEnvFromWindowsUserEnv(options = {}) {
  const { silent = false } = options;
  const candidateNames = [
    'TAURI_SIGNING_PRIVATE_KEY',
    'TAURI_SIGNING_PRIVATE_KEY_PATH',
    'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
    'TIDYDESK_UPDATER_BASE_URL',
    'TIDYDESK_UPDATER_NOTES',
    'TIDYDESK_UPDATER_MANIFEST_DIR',
    'TAURI_TARGET_TRIPLE'
  ];
  const loadedNames = [];

  for (const name of candidateNames) {
    if (hasEnvVar(name)) {
      continue;
    }

    const resolved = readWindowsUserEnvVar(name);
    if (!resolved.present) {
      continue;
    }

    process.env[name] = resolved.value;
    loadedNames.push(name);
  }

  if (!silent && loadedNames.length > 0) {
    console.log('[TAURI-UPDATER] loaded release env from Windows user environment:', loadedNames.join(', '));
  }

  return loadedNames;
}

module.exports = {
  hasEnvVar,
  readWindowsUserEnvVar,
  loadReleaseEnvFromWindowsUserEnv
};
