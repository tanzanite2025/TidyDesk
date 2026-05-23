/**
 * Windows 注册表监听服务
 * 实时检测应用安装/卸载
 */

const Registry = require('winreg');
const EventEmitter = require('events');

class RegistryWatcher extends EventEmitter {
  constructor() {
    super();
    this.watchers = [];
    this.knownApps = new Map(); // appKey -> appName
    this.isRunning = false;
  }

  /**
   * 开始监听
   */
  async start() {
    if (this.isRunning) {
      console.log('[TIDYDESK] Registry watcher already running');
      return;
    }

    this.isRunning = true;
    console.log('[TIDYDESK] Starting registry watcher...');

    try {
      // 监听 64 位应用
      await this.watchKey(
        Registry.HKLM,
        '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        '64-bit'
      );

      // 监听 32 位应用（在 64 位系统上）
      await this.watchKey(
        Registry.HKLM,
        '\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        '32-bit'
      );

      // 监听用户级应用
      await this.watchKey(
        Registry.HKCU,
        '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        'User'
      );

      console.log('[TIDYDESK] Registry watcher started successfully');
      console.log(`[TIDYDESK] Monitoring ${this.knownApps.size} installed applications`);
    } catch (err) {
      console.error('[TIDYDESK] Failed to start registry watcher:', err);
      this.isRunning = false;
    }
  }

  /**
   * 监听单个注册表键
   */
  async watchKey(hive, key, label) {
    try {
      const regKey = new Registry({ hive, key });

      // 初始化：获取当前应用列表
      const initialApps = await this.scanKey(regKey);
      initialApps.forEach(({ appKey, appName }) => {
        this.knownApps.set(appKey, appName);
      });

      console.log(`[TIDYDESK] Watching ${label} apps: ${initialApps.length} found`);

      // 定期检查变化（每 5 秒）
      const interval = setInterval(() => {
        this.checkChanges(regKey, label).catch(err => {
          console.error(`[TIDYDESK] Error checking ${label} registry:`, err.message);
        });
      }, 5000);

      this.watchers.push({ regKey, interval, label });
    } catch (err) {
      console.warn(`[TIDYDESK] Failed to watch ${label} registry:`, err.message);
    }
  }

  /**
   * 检查变化
   */
  async checkChanges(regKey, label) {
    try {
      const currentApps = await this.scanKey(regKey);
      const currentMap = new Map(currentApps.map(({ appKey, appName }) => [appKey, appName]));

      // 检测新安装的应用
      for (const [appKey, appName] of currentMap) {
        if (!this.knownApps.has(appKey)) {
          console.log(`[TIDYDESK] App installed (${label}): ${appName || appKey}`);
          this.emit('app-installed', { appKey, appName, label });
          this.knownApps.set(appKey, appName);
        }
      }

      // 检测卸载的应用
      for (const [appKey, appName] of this.knownApps) {
        if (!currentMap.has(appKey)) {
          console.log(`[TIDYDESK] App uninstalled (${label}): ${appName || appKey}`);
          this.emit('app-uninstalled', { appKey, appName, label });
          this.knownApps.delete(appKey);
        }
      }
    } catch (err) {
      // 静默失败，避免日志污染
      if (err.message !== 'The system cannot find the file specified.') {
        console.debug(`[TIDYDESK] Registry check error (${label}):`, err.message);
      }
    }
  }

  /**
   * 扫描注册表键
   */
  async scanKey(regKey) {
    return new Promise((resolve) => {
      regKey.keys((err, items) => {
        if (err) {
          resolve([]);
          return;
        }

        // 获取每个应用的详细信息
        const promises = items.map(item => this.getAppInfo(item));
        Promise.all(promises).then(apps => {
          resolve(apps.filter(app => app !== null));
        });
      });
    });
  }

  /**
   * 获取应用信息
   */
  async getAppInfo(regKey) {
    return new Promise((resolve) => {
      regKey.values((err, items) => {
        if (err) {
          resolve(null);
          return;
        }

        const values = {};
        items.forEach(item => {
          values[item.name] = item.value;
        });

        // 只返回有显示名称的应用
        if (values.DisplayName) {
          resolve({
            appKey: regKey.key,
            appName: values.DisplayName,
            installLocation: values.InstallLocation,
            uninstallString: values.UninstallString
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * 停止监听
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('[TIDYDESK] Stopping registry watcher...');

    this.watchers.forEach(({ interval, label }) => {
      clearInterval(interval);
      console.log(`[TIDYDESK] Stopped watching ${label} apps`);
    });

    this.watchers = [];
    this.knownApps.clear();
    this.isRunning = false;

    console.log('[TIDYDESK] Registry watcher stopped');
  }

  /**
   * 获取监控状态
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      watchedApps: this.knownApps.size,
      watchers: this.watchers.length
    };
  }
}

module.exports = RegistryWatcher;
