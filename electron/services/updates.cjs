const { autoUpdater } = require('electron-updater');

function createUpdateService({ app, notifyUpdate = () => {} }) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.logger = require('electron-log');
  autoUpdater.logger.transports.file.level = 'info';

  function sendUpdateStatus(status, data = {}) {
    notifyUpdate({ status, ...data });
  }

  function checkForUpdates() {
    if (process.env.NODE_ENV === 'development') {
      console.log('[TIDYDESK] Skip update check in development mode');
      return;
    }

    console.log('[TIDYDESK] Checking for updates...');
    autoUpdater.checkForUpdates().catch(err => {
      console.error('[TIDYDESK] Failed to check for updates:', err);
    });
  }

  async function checkForUpdatesNow() {
    if (process.env.NODE_ENV === 'development') {
      return {
        status: 'dev-mode',
        message: '开发模式下不检查更新',
        currentVersion: app.getVersion()
      };
    }

    try {
      const result = await autoUpdater.checkForUpdates();
      return {
        status: 'success',
        currentVersion: app.getVersion(),
        updateInfo: result?.updateInfo || null
      };
    } catch (err) {
      return {
        status: 'error',
        message: err.message,
        currentVersion: app.getVersion()
      };
    }
  }

  async function downloadUpdate() {
    if (process.env.NODE_ENV === 'development') {
      return { status: 'dev-mode', message: '开发模式下不下载更新' };
    }

    try {
      await autoUpdater.downloadUpdate();
      return { status: 'success', message: '开始下载更新' };
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  }

  function installUpdate() {
    if (process.env.NODE_ENV === 'development') {
      return { status: 'dev-mode', message: '开发模式下不安装更新' };
    }

    try {
      autoUpdater.quitAndInstall(false, true);
      return { status: 'success', message: '正在安装更新...' };
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  }

  function getAppVersion() {
    return {
      version: app.getVersion(),
      name: app.getName(),
      isPackaged: app.isPackaged
    };
  }

  function registerEventListeners() {
    autoUpdater.on('checking-for-update', () => {
      console.log('[TIDYDESK] Checking for update...');
      sendUpdateStatus('checking');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('[TIDYDESK] Update available:', info.version);
      sendUpdateStatus('available', {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: info.releaseNotes
      });
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log('[TIDYDESK] Update not available. Current version:', info.version);
      sendUpdateStatus('not-available', { version: info.version });
    });

    autoUpdater.on('error', (err) => {
      console.error('[TIDYDESK] Update error:', err);
      sendUpdateStatus('error', { message: err.message });
    });

    autoUpdater.on('download-progress', (progressObj) => {
      console.log(`[TIDYDESK] Download progress: ${progressObj.percent.toFixed(2)}%`);
      sendUpdateStatus('downloading', {
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
        bytesPerSecond: progressObj.bytesPerSecond
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[TIDYDESK] Update downloaded:', info.version);
      sendUpdateStatus('downloaded', {
        version: info.version,
        releaseNotes: info.releaseNotes
      });
    });
  }

  function registerIpcHandlers(ipcMain) {
    ipcMain.handle('check-for-updates', async () => checkForUpdatesNow());
    ipcMain.handle('download-update', async () => downloadUpdate());
    ipcMain.handle('install-update', async () => installUpdate());
    ipcMain.handle('get-app-version', async () => getAppVersion());
  }

  registerEventListeners();

  return {
    checkForUpdates,
    checkForUpdatesNow,
    downloadUpdate,
    installUpdate,
    getAppVersion,
    registerIpcHandlers
  };
}

module.exports = createUpdateService;
