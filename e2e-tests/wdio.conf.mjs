import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

process.env.WDIO_SKIP_DRIVER_SETUP = '1';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const appBinaryName = isWindows ? 'tidydesk.exe' : 'tidydesk';
const tauriAppPath = path.join(rootDir, 'src-tauri', 'target', 'release', appBinaryName);
const tauriCliCommand = 'npx';
const tauriDriverCommand = process.env.TAURI_DRIVER_PATH || 'tauri-driver';
const repoEdgeDriverPath = path.join(rootDir, isWindows ? 'msedgedriver.exe' : 'msedgedriver');
const edgeDriverPath =
  process.env.TIDYDESK_EDGE_DRIVER_PATH ||
  process.env.EDGEWEBDRIVER ||
  (fs.existsSync(repoEdgeDriverPath) ? repoEdgeDriverPath : '');
const tauriDriverPort = Number(process.env.TIDYDESK_TAURI_DRIVER_PORT || '4321');

let tauriDriverProcess;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    shell: isWindows,
  });

  if (result.status !== 0) {
    const detail = result.error?.message || `status=${result.status} signal=${result.signal}`;
    throw new Error(`Command failed: ${command} ${args.join(' ')} (${detail})`);
  }
}

function ensureTauriAppBuilt() {
  if (process.env.TIDYDESK_SKIP_E2E_BUILD === '1') {
    if (!fs.existsSync(tauriAppPath)) {
      throw new Error(
        `TIDYDESK_SKIP_E2E_BUILD=1 but app binary is missing: ${tauriAppPath}`,
      );
    }
    return;
  }

  run(tauriCliCommand, ['--yes', '@tauri-apps/cli@2', 'build', '--no-bundle', '--ci']);
}

function ensureDriverHints() {
  if (!edgeDriverPath && isWindows) {
    console.warn(
      '[TIDYDESK-E2E] TIDYDESK_EDGE_DRIVER_PATH/EDGEWEBDRIVER is not set. ' +
        'tauri-driver will fall back to PATH lookup for msedgedriver.exe.',
    );
  }
}

function startTauriDriver() {
  const driverArgs = [];
  driverArgs.push('--port', String(tauriDriverPort));
  if (edgeDriverPath) {
    driverArgs.push('--native-driver', edgeDriverPath);
  }

  tauriDriverProcess = spawn(tauriDriverCommand, driverArgs, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });
}

function stopTauriDriver() {
  if (!tauriDriverProcess || tauriDriverProcess.killed) {
    return;
  }
  tauriDriverProcess.kill();
}

function waitForDriverReady(timeoutMs = 15000) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      if (tauriDriverProcess?.exitCode !== null && tauriDriverProcess?.exitCode !== undefined) {
        reject(new Error(`tauri-driver exited early with code ${tauriDriverProcess.exitCode}`));
        return;
      }

      const socket = net.createConnection({
        host: '127.0.0.1',
        port: tauriDriverPort,
      });

      socket.once('connect', () => {
        socket.end();
        resolve();
      });

      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`Timed out waiting for tauri-driver on port ${tauriDriverPort}`));
          return;
        }
        setTimeout(tryConnect, 250);
      });
    };

    tryConnect();
  });
}

export const config = {
  runner: 'local',
  specs: ['./specs/**/*.e2e.mjs'],
  maxInstances: 1,
  logLevel: 'warn',
  waitforTimeout: 20000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 1,
  framework: 'mocha',
  reporters: ['spec'],
  injectGlobals: true,
  hostname: '127.0.0.1',
  port: tauriDriverPort,
  path: '/',
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },
  capabilities: [
    {
      browserName: 'wry',
      'tauri:options': {
        application: tauriAppPath,
      },
    },
  ],
  async onPrepare() {
    ensureDriverHints();
    ensureTauriAppBuilt();
    startTauriDriver();
    await waitForDriverReady();
  },
  beforeSession() {
    if (!fs.existsSync(tauriAppPath)) {
      throw new Error(`Tauri app binary was not found: ${tauriAppPath}`);
    }
  },
  onComplete() {
    stopTauriDriver();
  },
};
