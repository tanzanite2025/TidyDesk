const { contextBridge, ipcRenderer, webUtils } = require('electron');

const validWindowActions = new Set([
  'close',
  'minimize',
  'expand-drawer',
  'collapse-drawer',
  'toggle-drawer',
  'open-files',
  'open-todos',
  'open-capture',
  'start-screenshot',
  'close-panel'
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
  
  // 发送事件到主进程（用于用户交互追踪等）
  send: (channel) => {
    const validChannels = ['user-first-interaction', 'drawer-opened', 'file-dropped'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel);
    }
  },
  
  getPathForFile: (file) => webUtils.getPathForFile(file),
  
  onDrawerState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('drawer-state', listener);
    return () => ipcRenderer.removeListener('drawer-state', listener);
  },

  onModuleState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('module-state', listener);
    return () => ipcRenderer.removeListener('module-state', listener);
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
  
  // 还原文件到桌面
  restoreToDesktop: (payload) => {
    if (!payload || typeof payload !== 'object') {
      return Promise.reject(new Error('Invalid payload: must be an object'));
    }
    if (typeof payload.shortcutPath !== 'string') {
      return Promise.reject(new Error('Invalid parameter: shortcutPath must be a string'));
    }
    return ipcRenderer.invoke('restore-to-desktop', payload);
  },
  
  // 扫描已安装的应用程序
  scanInstalledApps: () => ipcRenderer.invoke('scan-installed-apps'),
  
  // 刷新应用列表
  refreshApps: () => ipcRenderer.invoke('refresh-apps'),
  
  // 获取缓存信息
  getCacheInfo: () => ipcRenderer.invoke('get-cache-info'),
  
  // 打开应用选择器
  openAppPicker: (payload) => {
    if (!payload || typeof payload !== 'object') {
      return Promise.reject(new Error('Invalid payload: must be an object'));
    }
    if (typeof payload.targetFolder !== 'string') {
      return Promise.reject(new Error('Invalid parameter: targetFolder must be a string'));
    }
    return ipcRenderer.invoke('open-app-picker', payload);
  },
  
  // 关闭应用选择器
  closeAppPicker: () => ipcRenderer.invoke('close-app-picker'),
  
  // 获取应用选择器的目标文件夹
  getAppPickerTarget: () => ipcRenderer.invoke('get-app-picker-target'),
  
  // 监听目标文件夹设置
  onSetTargetFolder: (callback) => {
    const listener = (_event, targetFolder) => callback(targetFolder);
    ipcRenderer.on('set-target-folder', listener);
    return () => ipcRenderer.removeListener('set-target-folder', listener);
  },
  
  // 添加应用到抽屉
  addAppToDrawer: (payload) => {
    if (!payload || typeof payload !== 'object') {
      return Promise.reject(new Error('Invalid payload: must be an object'));
    }
    if (typeof payload.shortcutPath !== 'string' || typeof payload.targetFolder !== 'string') {
      return Promise.reject(new Error('Invalid parameters: shortcutPath and targetFolder must be strings'));
    }
    return ipcRenderer.invoke('add-app-to-drawer', payload);
  },

  // 待办 / Markdown API
  readTodoState: () => ipcRenderer.invoke('todo-read-state'),
  getTodoCounts: () => ipcRenderer.invoke('todo-get-counts'),
  createTodoCard: (payload) => {
    if (!payload || typeof payload !== 'object') {
      return Promise.reject(new Error('Invalid payload: must be an object'));
    }
    return ipcRenderer.invoke('todo-create-card', payload);
  },
  updateTodoCard: (payload) => {
    if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string') {
      return Promise.reject(new Error('Invalid payload: must include id'));
    }
    return ipcRenderer.invoke('todo-update-card', payload);
  },
  deleteTodoCard: (cardId) => {
    if (typeof cardId !== 'string' || cardId.length === 0) {
      return Promise.reject(new Error('Invalid card id'));
    }
    return ipcRenderer.invoke('todo-delete-card', cardId);
  },
  moveTodoCard: (payload) => {
    if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string' || typeof payload.columnId !== 'string') {
      return Promise.reject(new Error('Invalid move payload'));
    }
    return ipcRenderer.invoke('todo-move-card', payload);
  },
  getClipboardText: () => ipcRenderer.invoke('clipboard-read-text'),
  onTodoCountsUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('todo-counts-updated', listener);
    return () => ipcRenderer.removeListener('todo-counts-updated', listener);
  },
  onCaptureOpened: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('capture-opened', listener);
    return () => ipcRenderer.removeListener('capture-opened', listener);
  },

  // 截图贴纸 API
  completeSnipSelection: (rect) => {
    if (!rect || typeof rect !== 'object') {
      return Promise.reject(new Error('Invalid snip rectangle'));
    }
    const { x, y, width, height } = rect;
    if (![x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value))) {
      return Promise.reject(new Error('Invalid snip rectangle values'));
    }
    return ipcRenderer.invoke('snip-complete-selection', rect);
  },
  cancelSnip: () => ipcRenderer.invoke('snip-cancel'),
  getSticker: (stickerId) => {
    if (typeof stickerId !== 'string' || stickerId.length === 0) {
      return Promise.reject(new Error('Invalid sticker id'));
    }
    return ipcRenderer.invoke('sticker-get', stickerId);
  },
  toggleStickerPin: (stickerId) => {
    if (typeof stickerId !== 'string' || stickerId.length === 0) {
      return Promise.reject(new Error('Invalid sticker id'));
    }
    return ipcRenderer.invoke('sticker-toggle-pin', stickerId);
  },
  copySticker: (stickerId) => {
    if (typeof stickerId !== 'string' || stickerId.length === 0) {
      return Promise.reject(new Error('Invalid sticker id'));
    }
    return ipcRenderer.invoke('sticker-copy', stickerId);
  },
  saveStickerAs: (stickerId) => {
    if (typeof stickerId !== 'string' || stickerId.length === 0) {
      return Promise.reject(new Error('Invalid sticker id'));
    }
    return ipcRenderer.invoke('sticker-save-as', stickerId);
  },
  closeSticker: (stickerId) => {
    if (typeof stickerId !== 'string' || stickerId.length === 0) {
      return Promise.reject(new Error('Invalid sticker id'));
    }
    return ipcRenderer.invoke('sticker-close', stickerId);
  },
  onStickerUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('sticker-updated', listener);
    return () => ipcRenderer.removeListener('sticker-updated', listener);
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
