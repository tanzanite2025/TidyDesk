const { contextBridge, ipcRenderer, webUtils } = require('electron');

const validWindowActions = new Set([
  'close',
  'minimize',
  'expand-drawer',
  'collapse-drawer',
  'toggle-drawer'
]);

contextBridge.exposeInMainWorld('tidyDesk', {
  readDesktopFiles: () => ipcRenderer.invoke('read-desktop-files'),
  
  createDrawer: (name) => {
    if (typeof name !== 'string' || name.length === 0 || name.length > 255) {
      return Promise.reject(new Error('Invalid drawer name: must be 1-255 characters'));
    }
    return ipcRenderer.invoke('create-desktop-folder', name);
  },
  
  renameItem: (payload) => {
    if (!payload || typeof payload !== 'object') {
      return Promise.reject(new Error('Invalid payload: must be an object'));
    }
    if (typeof payload.oldName !== 'string' || typeof payload.newName !== 'string') {
      return Promise.reject(new Error('Invalid name parameters: must be strings'));
    }
    if (payload.newName.length === 0 || payload.newName.length > 255) {
      return Promise.reject(new Error('Invalid new name: must be 1-255 characters'));
    }
    return ipcRenderer.invoke('rename-desktop-item', payload);
  },
  
  deleteItem: (payload) => {
    if (!payload || typeof payload !== 'object') {
      return Promise.reject(new Error('Invalid payload: must be an object'));
    }
    if (typeof payload.name !== 'string') {
      return Promise.reject(new Error('Invalid name parameter: must be a string'));
    }
    return ipcRenderer.invoke('delete-desktop-item', payload);
  },
  
  importExternalFiles: (payload) => {
    if (!payload || typeof payload !== 'object') {
      return Promise.reject(new Error('Invalid payload: must be an object'));
    }
    if (!Array.isArray(payload.filePaths)) {
      return Promise.reject(new Error('Invalid filePaths: must be an array'));
    }
    if (payload.filePaths.length === 0 || payload.filePaths.length > 100) {
      return Promise.reject(new Error('Invalid filePaths length: must be 1-100'));
    }
    return ipcRenderer.invoke('import-external-files', payload);
  },
  
  openFile: (filePath) => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return Promise.reject(new Error('Invalid file path: must be a non-empty string'));
    }
    return ipcRenderer.invoke('open-desktop-file', filePath);
  },
  
  windowControl: (action) => {
    if (validWindowActions.has(action)) ipcRenderer.send('window-control', action);
  },
  
  getPathForFile: (file) => webUtils.getPathForFile(file),
  
  onDrawerState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('drawer-state', listener);
    return () => ipcRenderer.removeListener('drawer-state', listener);
  },
  
  // 文件监控事件
  onTargetFileDeleted: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('target-file-deleted', listener);
    return () => ipcRenderer.removeListener('target-file-deleted', listener);
  },
  
  onTargetFileRestored: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('target-file-restored', listener);
    return () => ipcRenderer.removeListener('target-file-restored', listener);
  },
  
  onShortcutsValidated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('shortcuts-validated', listener);
    return () => ipcRenderer.removeListener('shortcuts-validated', listener);
  },
  
  // 验证和修复 API
  validateAllShortcuts: () => ipcRenderer.invoke('validate-all-shortcuts'),
  
  repairShortcut: (payload) => {
    if (!payload || typeof payload !== 'object') {
      return Promise.reject(new Error('Invalid payload: must be an object'));
    }
    if (typeof payload.shortcutPath !== 'string' || typeof payload.targetPath !== 'string') {
      return Promise.reject(new Error('Invalid parameters: shortcutPath and targetPath must be strings'));
    }
    return ipcRenderer.invoke('repair-shortcut', payload);
  },
  
  // 自动更新 API
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  }
});
