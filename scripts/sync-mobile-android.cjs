const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * Convert `major.minor.patch` into a strictly monotonic Android integer versionCode.
 */
function computeAndroidVersionCode(rawVersion) {
  const match = String(rawVersion || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    throw new Error(`Invalid semantic version for Android versionCode: "${rawVersion}"`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const code = major * 1_000_000 + minor * 1_000 + patch;
  if (!Number.isSafeInteger(code) || code <= 0) {
    throw new Error(`Computed Android versionCode must be positive, got ${code}`);
  }
  return code;
}

function runCmd(command, args, cwd) {
  const res =
    process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${command} ${args.join(' ')}`], {
          cwd,
          stdio: 'inherit'
        })
      : spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`Command "${command} ${args.join(' ')}" failed with status ${res.status}`);
  }
}

function syncLauncherIcons(projectRoot, androidResDir) {
  const icon512 = path.join(projectRoot, 'public', 'icons', 'icon-512.png');
  const icon192 = path.join(projectRoot, 'public', 'icons', 'icon-192.png');
  if (!fs.existsSync(icon512) || !fs.existsSync(icon192)) {
    throw new Error('Missing public/icons/icon-512.png or icon-192.png for Android launcher icons');
  }

  const iconTargets = [
    { dir: 'mipmap-mdpi', src: icon192 },
    { dir: 'mipmap-hdpi', src: icon192 },
    { dir: 'mipmap-xhdpi', src: icon192 },
    { dir: 'mipmap-xxhdpi', src: icon512 },
    { dir: 'mipmap-xxxhdpi', src: icon512 }
  ];

  for (const target of iconTargets) {
    const dirPath = path.join(androidResDir, target.dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const fileName of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      fs.copyFileSync(target.src, path.join(dirPath, fileName));
    }
  }
}

function updateGradleVersion(gradlePath, versionName, versionCode) {
  const raw = fs.readFileSync(gradlePath, 'utf8');
  if (!/versionCode\s+\d+/.test(raw) || !/versionName\s+"[^"]+"/.test(raw)) {
    throw new Error(`Could not locate versionCode/versionName inside ${gradlePath}`);
  }
  const next = raw
    .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
    .replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);
  fs.writeFileSync(gradlePath, next, 'utf8');
}

function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const rootPkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const versionName = String(rootPkg.version || '').trim();
  const versionCode = computeAndroidVersionCode(versionName);

  const mobileDir = path.join(projectRoot, 'mobile-android');
  const mobilePkgPath = path.join(mobileDir, 'package.json');
  const mobilePkg = JSON.parse(fs.readFileSync(mobilePkgPath, 'utf8'));
  mobilePkg.version = versionName;
  fs.writeFileSync(mobilePkgPath, `${JSON.stringify(mobilePkg, null, 2)}\n`, 'utf8');

  const mobileLockPath = path.join(mobileDir, 'package-lock.json');
  if (fs.existsSync(mobileLockPath)) {
    const mobileLock = JSON.parse(fs.readFileSync(mobileLockPath, 'utf8'));
    mobileLock.version = versionName;
    if (mobileLock.packages && mobileLock.packages['']) {
      mobileLock.packages[''].version = versionName;
    }
    fs.writeFileSync(mobileLockPath, `${JSON.stringify(mobileLock, null, 2)}\n`, 'utf8');
  }

  const gradlePath = path.join(mobileDir, 'android', 'app', 'build.gradle');
  updateGradleVersion(gradlePath, versionName, versionCode);

  const androidResDir = path.join(mobileDir, 'android', 'app', 'src', 'main', 'res');
  syncLauncherIcons(projectRoot, androidResDir);

  const distMobileIndex = path.join(projectRoot, 'dist-mobile', 'index.html');
  if (!fs.existsSync(distMobileIndex) || process.argv.includes('--rebuild')) {
    runCmd(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:mobile'], projectRoot);
  }

  if (fs.existsSync(path.join(mobileDir, 'node_modules', '@capacitor', 'cli'))) {
    runCmd(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['cap', 'sync', 'android'], mobileDir);
  } else {
    throw new Error(
      'mobile-android/node_modules missing. Run `npm ci` inside mobile-android before `npm run mobile:sync`.'
    );
  }

  console.log('[TIDYDESK-ANDROID] Synced Android shell project cleanly', {
    versionName,
    versionCode
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  computeAndroidVersionCode,
  updateGradleVersion
};
