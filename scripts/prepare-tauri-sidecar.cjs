const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function getTargetTriple() {
  if (process.env.TAURI_TARGET_TRIPLE) return process.env.TAURI_TARGET_TRIPLE;
  if (process.env.CARGO_BUILD_TARGET) return process.env.CARGO_BUILD_TARGET;

  const key = `${process.platform}-${process.arch}`;
  const triples = {
    'win32-x64': 'x86_64-pc-windows-msvc',
    'win32-arm64': 'aarch64-pc-windows-msvc',
    'darwin-x64': 'x86_64-apple-darwin',
    'darwin-arm64': 'aarch64-apple-darwin',
    'linux-x64': 'x86_64-unknown-linux-gnu',
    'linux-arm64': 'aarch64-unknown-linux-gnu'
  };

  const triple = triples[key];
  if (!triple) throw new Error(`Unsupported Tauri sidecar target: ${key}`);
  return triple;
}

function getExecutableSuffix() {
  return process.platform === 'win32' ? '.exe' : '';
}

function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const sidecarDir = path.join(projectRoot, 'sidecars', 'apps-cache');
  const sourceName = `tidydesk-apps-cache${getExecutableSuffix()}`;
  const sourcePath = path.join(sidecarDir, sourceName);
  const targetTriple = getTargetTriple();
  const targetDir = path.join(projectRoot, 'src-tauri', 'sidecars', 'apps-cache');
  const targetPath = path.join(targetDir, `tidydesk-apps-cache-${targetTriple}${getExecutableSuffix()}`);

  execFileSync('go', ['-C', path.join('sidecars', 'apps-cache'), 'build', '-o', sourceName, '.'], {
    cwd: projectRoot,
    stdio: 'inherit'
  });

  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);

  console.log('[TAURI-SIDECAR] prepared:', {
    sourcePath,
    targetPath,
    targetTriple
  });
}

main();
