const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function runNpmBuild(projectRoot) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${npmCmd} run build`], {
        cwd: projectRoot,
        stdio: 'inherit'
      })
    : spawnSync(npmCmd, ['run', 'build'], {
        cwd: projectRoot,
        stdio: 'inherit'
      });
  if (result.status !== 0) {
    throw new Error(`npm run build failed with exit code ${result.status}`);
  }
}

function copyDirClean(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDirClean(src, dst);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dst);
    }
  }
}

function createZipArchive(sourceDir, zipPath) {
  fs.rmSync(zipPath, { force: true });
  if (process.platform === 'win32') {
    const script = [
      `$ErrorActionPreference = 'Stop'`,
      `Compress-Archive -Path '${sourceDir.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`
    ].join('; ');
    const res = spawnSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'inherit' });
    if (res.status === 0) return;
    throw new Error(`PowerShell Compress-Archive failed with code ${res.status}`);
  }

  const parentDir = path.dirname(sourceDir);
  const folderName = path.basename(sourceDir);
  const zipRes = spawnSync('zip', ['-rq', zipPath, folderName], { cwd: parentDir, stdio: 'inherit' });
  if (zipRes.status === 0) return;

  const pyRes = spawnSync(
    'python3',
    [
      '-c',
      'import shutil, sys; shutil.make_archive(sys.argv[1][:-4], "zip", sys.argv[2], sys.argv[3])',
      zipPath,
      parentDir,
      folderName
    ],
    { stdio: 'inherit' }
  );
  if (pyRes.status !== 0) {
    throw new Error('Failed to create sync server zip archive');
  }
}

function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const distDir = path.join(projectRoot, 'dist');
  if (!fs.existsSync(path.join(distDir, 'index.html')) || process.argv.includes('--rebuild')) {
    console.log('[TIDYDESK-SERVER-PKG] Building frontend dist/ bundle...');
    runNpmBuild(projectRoot);
  }

  const outRoot = path.join(projectRoot, 'release-server');
  const stagingDir = path.join(outRoot, 'tidydesk-sync-server');
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  copyDirClean(path.join(projectRoot, 'server', 'src'), path.join(stagingDir, 'src'));
  copyDirClean(path.join(projectRoot, 'server', 'sql'), path.join(stagingDir, 'sql'));
  copyDirClean(distDir, path.join(stagingDir, 'dist'));
  fs.copyFileSync(
    path.join(projectRoot, 'server', 'docker-compose.yml'),
    path.join(stagingDir, 'docker-compose.yml')
  );
  fs.copyFileSync(
    path.join(projectRoot, 'server', 'README.md'),
    path.join(stagingDir, 'README.md')
  );

  fs.writeFileSync(
    path.join(stagingDir, 'package.json'),
    JSON.stringify(
      {
        name: 'tidydesk-sync-server',
        version: pkg.version,
        private: true,
        type: 'module',
        scripts: {
          start: 'node src/index.mjs',
          cli: 'node src/cli.mjs'
        }
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  fs.writeFileSync(
    path.join(stagingDir, 'start.bat'),
    '@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\necho Starting TidyDesk Sync Server & Mobile Web (PWA)...\r\nnode src\\index.mjs\r\npause\r\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(stagingDir, 'start.sh'),
    '#!/usr/bin/env sh\nset -e\ncd "$(dirname "$0")"\nexec node src/index.mjs\n',
    { encoding: 'utf8', mode: 0o755 }
  );

  const zipPath = path.join(outRoot, `tidydesk-sync-server-v${pkg.version}.zip`);
  createZipArchive(stagingDir, zipPath);
  console.log(`[TIDYDESK-SERVER-PKG] Packed sync server + mobile PWA bundle: ${zipPath}`);
}

main();
