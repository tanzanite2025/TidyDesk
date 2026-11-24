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
