import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildUpdaterManifest,
  selectInstallerArtifact
} = require('./generate-tauri-latest-json.cjs');
const { computeAndroidVersionCode, updateGradleVersion } = require('./sync-mobile-android.cjs');
const { stageWindowsReleaseBundle, verifyPublishedBundleDirs } = require('./verify-release-bundle.cjs');

test('selectInstallerArtifact matches exact version and rejects stale leftovers', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidydesk-updater-pkg-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'TidyDesk_0.0.1_x64-setup.exe'), 'old');
    fs.writeFileSync(path.join(tmpDir, 'TidyDesk_0.0.1_x64-setup.exe.sig'), 'old-sig');
    fs.writeFileSync(path.join(tmpDir, 'TidyDesk_0.0.2_x64-setup.exe'), 'new');
    fs.writeFileSync(path.join(tmpDir, 'TidyDesk_0.0.2_x64-setup.exe.sig'), 'new-sig\n');

    const selected = selectInstallerArtifact(tmpDir, '0.0.2', 'TidyDesk');
    assert.equal(selected.installerName, 'TidyDesk_0.0.2_x64-setup.exe');
    assert.equal(selected.signature, 'new-sig');

    assert.throws(
      () => selectInstallerArtifact(tmpDir, '0.0.3', 'TidyDesk'),
      /No NSIS installer matching version 0\.0\.3/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('selectInstallerArtifact fails loudly when signature is missing or ambiguous', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidydesk-updater-ambig-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'TidyDesk_0.0.2_x64-setup.exe'), 'bin1');
    assert.throws(
      () => selectInstallerArtifact(tmpDir, '0.0.2', 'TidyDesk'),
      /Updater signature not found/
    );

    fs.writeFileSync(path.join(tmpDir, 'TidyDesk_0.0.2_x64-setup.exe.sig'), 'sig1');
    fs.writeFileSync(path.join(tmpDir, 'TidyDesk_0.0.2_arm64-setup.exe'), 'bin2');
    fs.writeFileSync(path.join(tmpDir, 'TidyDesk_0.0.2_arm64-setup.exe.sig'), 'sig2');

    assert.throws(
      () => selectInstallerArtifact(tmpDir, '0.0.2', 'TidyDesk'),
      /Multiple NSIS installers match version 0\.0\.2/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('buildUpdaterManifest validates required fields and constructs release URL', () => {
  const manifest = buildUpdaterManifest({
    version: '0.0.2',
    installerName: 'TidyDesk_0.0.2_x64-setup.exe',
    signature: 'sig-abc',
    targetKey: 'windows-x86_64',
    baseUrl: 'https://github.com/tanzanite2025/TidyDesk/releases/download/v0.0.2/',
    notes: '- 修复自动更新超时与重试',
    pubDate: '2026-11-24T12:00:00.000Z'
  });

  assert.equal(manifest.version, '0.0.2');
  assert.equal(manifest.notes, '- 修复自动更新超时与重试');
  assert.equal(
    manifest.platforms['windows-x86_64'].url,
    'https://github.com/tanzanite2025/TidyDesk/releases/download/v0.0.2/TidyDesk_0.0.2_x64-setup.exe'
  );
  assert.equal(manifest.platforms['windows-x86_64'].signature, 'sig-abc');

  assert.throws(
    () =>
      buildUpdaterManifest({
        version: '0.0.2',
        installerName: 'TidyDesk_0.0.2_x64-setup.exe',
        signature: '  ',
        targetKey: 'windows-x86_64',
        baseUrl: 'https://github.com/tanzanite2025/TidyDesk/releases/download/v0.0.2'
      }),
    /non-empty signature/
  );
});

test('computeAndroidVersionCode and updateGradleVersion enforce monotonic Android release versions', () => {
  assert.equal(computeAndroidVersionCode('0.0.7'), 7);
  assert.equal(computeAndroidVersionCode('0.1.2'), 1002);
  assert.equal(computeAndroidVersionCode('1.2.3'), 1002003);
  assert.throws(() => computeAndroidVersionCode('0.0.0'), /must be positive/);
  assert.throws(() => computeAndroidVersionCode('invalid'), /Invalid semantic version/);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidydesk-gradle-ver-'));
  try {
    const gradleFile = path.join(tmpDir, 'build.gradle');
    fs.writeFileSync(
      gradleFile,
      'defaultConfig {\n  applicationId "com.tidydesk.mobile"\n  versionCode 1\n  versionName "0.0.1"\n}\n',
      'utf8'
    );
    updateGradleVersion(gradleFile, '0.0.7', 7);
    const updated = fs.readFileSync(gradleFile, 'utf8');
    assert.match(updated, /versionCode 7/);
    assert.match(updated, /versionName "0\.0\.7"/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('stageWindowsReleaseBundle & verifyPublishedBundleDirs enforce full cross-artifact integrity', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tidydesk-pub-verify-'));
  try {
    const projectDir = path.join(tmpRoot, 'repo');
    const nsisDir = path.join(projectDir, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
    const tauriReleaseDir = path.join(projectDir, 'release-tauri');
    const serverReleaseDir = path.join(projectDir, 'release-server');
    const winStageDir = path.join(tmpRoot, 'windows-flat');
    const apkDir = path.join(tmpRoot, 'android-flat');

    fs.mkdirSync(path.join(projectDir, 'src-tauri'), { recursive: true });
    fs.mkdirSync(nsisDir, { recursive: true });
    fs.mkdirSync(tauriReleaseDir, { recursive: true });
    fs.mkdirSync(serverReleaseDir, { recursive: true });
    fs.mkdirSync(apkDir, { recursive: true });

    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ version: '0.0.9' }));
    fs.writeFileSync(
      path.join(projectDir, 'src-tauri', 'tauri.conf.json'),
      JSON.stringify({ productName: 'TidyDesk' })
    );

    // Put both current and stale artifacts on disk to ensure exact-version staging ignores stale files
    fs.writeFileSync(path.join(nsisDir, 'TidyDesk_0.0.8_x64-setup.exe'), 'old-exe');
    fs.writeFileSync(path.join(nsisDir, 'TidyDesk_0.0.8_x64-setup.exe.sig'), 'old-sig');
    fs.writeFileSync(path.join(nsisDir, 'TidyDesk_0.0.9_x64-setup.exe'), 'new-exe-binary');
    fs.writeFileSync(path.join(nsisDir, 'TidyDesk_0.0.9_x64-setup.exe.sig'), 'new-sig-009\n');

    fs.writeFileSync(path.join(serverReleaseDir, 'tidydesk-sync-server-v0.0.8.zip'), 'old-zip');
    fs.writeFileSync(path.join(serverReleaseDir, 'tidydesk-sync-server-v0.0.9.zip'), 'new-zip-009');

    fs.writeFileSync(
      path.join(tauriReleaseDir, 'latest.json'),
      JSON.stringify({
        version: '0.0.9',
        platforms: {
          'windows-x86_64': {
            signature: 'new-sig-009',
            url: 'https://github.com/tanzanite2025/TidyDesk/releases/download/v0.0.9/TidyDesk_0.0.9_x64-setup.exe'
          }
        }
      })
    );

    const staged = stageWindowsReleaseBundle({
      projectRoot: projectDir,
      outputDir: winStageDir
    });
    assert.deepEqual(staged.files, [
      'TidyDesk_0.0.9_x64-setup.exe',
      'TidyDesk_0.0.9_x64-setup.exe.sig',
      'latest.json',
      'tidydesk-sync-server-v0.0.9.zip'
    ]);

    fs.writeFileSync(path.join(apkDir, 'TidyDesk-Mobile-v0.0.9.apk'), 'apk-binary');

    const okSummary = verifyPublishedBundleDirs({
      windowsDir: winStageDir,
      androidDir: apkDir,
      expectedVersion: '0.0.9'
    });
    assert.equal(okSummary.manifestVersion, '0.0.9');

    // Signature drift between latest.json and .sig must fail loudly
    fs.writeFileSync(path.join(winStageDir, 'TidyDesk_0.0.9_x64-setup.exe.sig'), 'wrong-sig');
    assert.throws(
      () =>
        verifyPublishedBundleDirs({
          windowsDir: winStageDir,
          androidDir: apkDir,
          expectedVersion: '0.0.9'
        }),
      /signature mismatch/
    );

    // Restore valid sig, remove latest.json -> must fail loudly
    fs.writeFileSync(path.join(winStageDir, 'TidyDesk_0.0.9_x64-setup.exe.sig'), 'new-sig-009');
    fs.rmSync(path.join(winStageDir, 'latest.json'));
    assert.throws(
      () =>
        verifyPublishedBundleDirs({
          windowsDir: winStageDir,
          androidDir: apkDir,
          expectedVersion: '0.0.9'
        }),
      /Missing Tauri updater latest\.json/
    );

    const workflowText = fs.readFileSync(
      path.resolve(
        path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
        '../.github/workflows/release.yml'
      ),
      'utf8'
    );
    assert.match(workflowText, /--stage-windows release-windows/);
    assert.match(workflowText, /path: release-windows\/\*/);
    assert.match(workflowText, /--verify-publish release-bundle\/windows release-bundle\/android/);
    assert.match(workflowText, /fail_on_unmatched_files: true/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
