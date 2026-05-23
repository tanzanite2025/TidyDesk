/**
 * TidyDesk Window API 类型定义
 */

interface TidyDeskAPI {
  readDesktopFiles: () => Promise<any>;
  createDrawer: (name: string) => Promise<any>;
  renameItem: (payload: any) => Promise<any>;
  deleteItem: (payload: any) => Promise<any>;
  importExternalFiles: (payload: any) => Promise<any>;
  openFile: (filePath: string) => Promise<any>;
  windowControl: (action: string) => void;
  send: (channel: string) => void;
  getPathForFile: (file: File) => string;
  onDrawerState: (callback: (payload: any) => void) => () => void;
  onTargetFileDeleted: (callback: (payload: any) => void) => () => void;
  onTargetFileRestored: (callback: (payload: any) => void) => () => void;
  onShortcutsValidated: (callback: (payload: any) => void) => () => void;
  validateAllShortcuts: () => Promise<any>;
  repairShortcut: (payload: any) => Promise<any>;
  restoreToDesktop: (payload: any) => Promise<any>;
  scanInstalledApps: () => Promise<any>;
  refreshApps: () => Promise<{ success: boolean; apps: any[] }>;
  getCacheInfo: () => Promise<{ success: boolean; info: any }>;
  openAppPicker: (payload: { targetFolder: string }) => Promise<any>;
  closeAppPicker: () => Promise<any>;
  getAppPickerTarget: () => Promise<{ targetFolder: string | null }>;
  onSetTargetFolder: (callback: (targetFolder: string) => void) => () => void;
  addAppToDrawer: (payload: any) => Promise<any>;
  readTodoState: () => Promise<any>;
  getTodoCounts: () => Promise<any>;
  createTodoCard: (payload: any) => Promise<any>;
  updateTodoCard: (payload: any) => Promise<any>;
  deleteTodoCard: (cardId: string) => Promise<any>;
  moveTodoCard: (payload: any) => Promise<any>;
  getClipboardText: () => Promise<string>;
  onTodoCountsUpdated: (callback: (payload: any) => void) => () => void;
  onCaptureOpened: (callback: (payload: any) => void) => () => void;
  onModuleState: (callback: (payload: any) => void) => () => void;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<any>;
  downloadUpdate: () => Promise<any>;
  installUpdate: () => Promise<any>;
  onUpdateStatus: (callback: (payload: any) => void) => () => void;
}

interface Window {
  tidyDesk: TidyDeskAPI;
}
