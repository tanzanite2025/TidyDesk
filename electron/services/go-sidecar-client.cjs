const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const readline = require('readline');

function createGoSidecarClient({ executablePath, cwd, timeoutMs = 5000 }) {
  let child = null;
  let rl = null;
  let nextId = 1;
  const pending = new Map();

  function isRunning() {
    return Boolean(child && !child.killed && child.exitCode === null);
  }

  function start() {
    if (isRunning()) return;

    child = spawn(executablePath, [], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    rl = readline.createInterface({ input: child.stdout });
    rl.on('line', line => {
      let response;
      try {
        response = JSON.parse(line);
      } catch (err) {
        console.warn('[TIDYDESK] Invalid sidecar response:', line);
        return;
      }

      const entry = pending.get(response.id);
      if (!entry) return;

      clearTimeout(entry.timer);
      pending.delete(response.id);

      if (response.ok) {
        entry.resolve(response.data);
      } else {
        entry.reject(new Error(response.error || 'Sidecar request failed'));
      }
    });

    child.stderr.on('data', chunk => {
      const message = chunk.toString().trim();
      if (message) console.warn('[TIDYDESK] Sidecar stderr:', message);
    });

    child.once('exit', (code, signal) => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`Sidecar exited: code=${code}, signal=${signal}`));
      }
      pending.clear();
      rl?.close();
      rl = null;
      child = null;
    });
  }

  function request(method, params = {}) {
    start();

    const id = String(nextId++);
    const payload = JSON.stringify({ id, method, params });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Sidecar request timeout: ${method}`));
      }, timeoutMs);

      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${payload}\n`, 'utf8', err => {
        if (!err) return;
        clearTimeout(timer);
        pending.delete(id);
        reject(err);
      });
    });
  }

  function stop() {
    if (!child) return;
    child.kill();
    child = null;
  }

  return {
    isRunning,
    request,
    stop
  };
}

function createAppsCacheSidecarClient({ app, executablePath }) {
  const resolvedExecutablePath = executablePath || path.join(__dirname, '..', '..', 'sidecars', 'apps-cache', 'tidydesk-apps-cache.exe');
  const client = createGoSidecarClient({
    executablePath: resolvedExecutablePath,
    cwd: path.dirname(resolvedExecutablePath)
  });

  const userDataPath = app.getPath('userData');

  return {
    ping: () => client.request('ping'),
    getVersion: () => client.request('sidecar.version'),
    getHealth: () => client.request('sidecar.health'),
    getCacheInfo: () => client.request('apps.cacheInfo', { userDataPath }),
    readCache: () => client.request('apps.readCache', { userDataPath }),
    scanMetadata: (options = {}) => client.request('apps.scanMetadata', {
      startMenuPaths: options.startMenuPaths || [
        path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
        path.join(os.homedir(), 'AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs')
      ],
      desktopPath: options.desktopPath || app.getPath('desktop'),
      maxDepth: options.maxDepth || 3,
      skipDirectories: options.skipDirectories || [
        'Accessories',
        'Administrative Tools',
        'Maintenance',
        'System Tools',
        'Startup'
      ]
    }),
    stop: client.stop,
    isRunning: client.isRunning
  };
}

module.exports = {
  createGoSidecarClient,
  createAppsCacheSidecarClient
};
