import type { TidyFile, TidyFolder } from './file';
import type {
  CreateTodoCardInput,
  MoveTodoCardInput,
  TodoCounts,
  TodoState,
  UpdateTodoCardInput
} from './todo';

export type RailModule = 'files' | 'todos' | 'capture' | null;

export type WindowAction =
  | 'close'
  | 'minimize'
  | 'expand-drawer'
  | 'collapse-drawer'
  | 'toggle-drawer'
  | 'open-files'
  | 'open-todos'
  | 'open-capture'
  | 'show-files-tab'
  | 'show-capture-tab'
  | 'start-screenshot'
  | 'close-panel';

export type TidyDeskSendChannel = 'user-first-interaction' | 'drawer-opened' | 'file-dropped';

export interface DesktopFilesResult {
  files: TidyFile[];
  folders: TidyFolder[];
  desktopPath?: string;
  tidyBoxPath?: string;
}

export interface RenameItemPayload {
  oldName: string;
  newName: string;
  parentFolder: string | null;
}

export interface DeleteItemPayload {
  name: string;
  parentFolder: string | null;
}

export interface ImportExternalFilesPayload {
  filePaths: string[];
  targetFolder: string | null;
}

export interface ImportedFileResult {
  source: string;
  shortcut: string;
  mode: string;
}

export interface ImportExternalFilesResult {
  success: boolean;
  added: ImportedFileResult[];
}

export interface RestoreToDesktopPayload {
  shortcutPath: string;
}

export interface RestoreToDesktopResult {
  success: boolean;
  restoredPath: string;
}

export interface ShortcutValidationStats {
  total: number;
  valid: number;
  invalid: number;
  repaired: number;
}

export interface RepairShortcutPayload {
  shortcutPath: string;
  targetPath: string;
}

export interface RepairShortcutResult {
  repaired: boolean;
  newPath: string | null;
}

export interface TargetFileEventPayload {
  targetPath: string;
  shortcutCount: number;
}

export interface InstalledApp {
  name: string;
  shortcutPath: string;
  targetPath: string;
  icon: string | null;
  category: string;
}

export interface InstalledAppsResult {
  success: boolean;
  apps: InstalledApp[];
  error?: string;
}

export interface AppIconUpdate {
  shortcutPath: string;
  icon: string | null;
}

export interface AppIconsUpdatedPayload {
  icons: AppIconUpdate[];
  complete?: boolean;
}

export interface AppCacheInfo {
  exists?: boolean;
  valid?: boolean;
  ageMinutes?: number;
  lastScanTime?: string | number | null;
  appCount?: number;
  cacheAge?: number;
  isExpired?: boolean;
  [key: string]: unknown;
}

export interface CacheInfoResult {
  success: boolean;
  info?: AppCacheInfo;
  error?: string;
}

export interface ResidentSettings {
  autostartEnabled: boolean;
  launchMinimized: boolean;
  backgroundMonitorEnabled: boolean;
  autoUpdateCheckEnabled: boolean;
  autoStickAfterSnip: boolean;
}

export interface ResidentSettingsUpdate {
  autostartEnabled?: boolean;
  launchMinimized?: boolean;
  backgroundMonitorEnabled?: boolean;
  autoUpdateCheckEnabled?: boolean;
  autoStickAfterSnip?: boolean;
}

export interface AppPickerTargetResult {
  targetFolder: string | null;
}

export interface OpenAppPickerPayload {
  targetFolder: string;
}

export interface AddAppToDrawerPayload {
  shortcutPath: string;
  targetFolder: string;
}

export interface CaptureOpenedPayload {
  clipboardText?: string;
}

export interface SnipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnipBackgroundImageResult {
  success: boolean;
  imagePath?: string | null;
  imageUrl?: string | null;
  error?: string;
}

export interface StickerData {
  id: string;
  imagePath: string;
  imageUrl: string;
  alwaysOnTop: boolean;
  createdAt: string;
}

export interface StickerPinResult {
  success: boolean;
  alwaysOnTop?: boolean;
}

export interface StickerUpdatedPayload {
  id: string;
  alwaysOnTop: boolean;
}

export interface DrawerStatePayload {
  expanded: boolean;
  activeModule?: RailModule;
}

export interface ModuleStatePayload {
  expanded: boolean;
  activeModule: RailModule;
}

export type UpdateStatus =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'dev-mode'
  | 'success';

export interface AppVersionInfo {
  version: string;
  name: string;
  isPackaged: boolean;
}

export interface UpdateStatusPayload {
  status: UpdateStatus;
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  percent?: number;
  message?: string;
  [key: string]: unknown;
}

export interface TidyDeskAPI {
  readDesktopFiles: () => Promise<DesktopFilesResult>;
  createDrawer: (name: string) => Promise<unknown>;
  renameItem: (payload: RenameItemPayload) => Promise<unknown>;
  deleteItem: (payload: DeleteItemPayload) => Promise<unknown>;
  importExternalFiles: (payload: ImportExternalFilesPayload) => Promise<ImportExternalFilesResult>;
  openFile: (filePath: string) => Promise<unknown>;
  windowControl: (action: WindowAction) => void;
  send: (channel: TidyDeskSendChannel) => void;
  getPathForFile: (file: File) => string;
  onDrawerState: (callback: (payload: DrawerStatePayload) => void) => () => void;
  onModuleState: (callback: (payload: ModuleStatePayload) => void) => () => void;
  onTargetFileDeleted: (callback: (payload: TargetFileEventPayload) => void) => () => void;
  onTargetFileRestored: (callback: (payload: TargetFileEventPayload) => void) => () => void;
  onShortcutsValidated: (callback: (payload: ShortcutValidationStats) => void) => () => void;
  validateAllShortcuts: () => Promise<ShortcutValidationStats>;
  repairShortcut: (payload: RepairShortcutPayload) => Promise<RepairShortcutResult>;
  restoreToDesktop: (payload: RestoreToDesktopPayload) => Promise<RestoreToDesktopResult>;
  scanInstalledApps: () => Promise<InstalledAppsResult>;
  refreshApps: () => Promise<InstalledAppsResult>;
  getCacheInfo: () => Promise<CacheInfoResult>;
  openAppPicker: (payload: OpenAppPickerPayload) => Promise<unknown>;
  closeAppPicker: () => Promise<unknown>;
  getAppPickerTarget: () => Promise<AppPickerTargetResult>;
  onSetTargetFolder: (callback: (targetFolder: string) => void) => () => void;
  addAppToDrawer: (payload: AddAppToDrawerPayload) => Promise<unknown>;
  readTodoState: () => Promise<TodoState>;
  getTodoCounts: () => Promise<TodoCounts>;
  createTodoCard: (payload: CreateTodoCardInput) => Promise<TodoState>;
  updateTodoCard: (payload: UpdateTodoCardInput) => Promise<TodoState>;
  deleteTodoCard: (cardId: string) => Promise<TodoState>;
  moveTodoCard: (payload: MoveTodoCardInput) => Promise<TodoState>;
  getClipboardText: () => Promise<string>;
  onTodoCountsUpdated: (callback: (payload: TodoCounts) => void) => () => void;
  onCaptureOpened: (callback: (payload: CaptureOpenedPayload) => void) => () => void;
  completeSnipSelection: (rect: SnipRect) => Promise<unknown>;
  cancelSnip: () => Promise<unknown>;
  getSticker: (stickerId: string) => Promise<StickerData | null>;
  toggleStickerPin: (stickerId: string) => Promise<StickerPinResult>;
  copySticker: (stickerId: string) => Promise<unknown>;
  saveStickerAs: (stickerId: string) => Promise<unknown>;
  closeSticker: (stickerId: string) => Promise<unknown>;
  onStickerUpdated: (callback: (payload: StickerUpdatedPayload) => void) => () => void;
  getAppVersion: () => Promise<AppVersionInfo>;
  checkForUpdates: () => Promise<UpdateStatusPayload>;
  downloadUpdate: () => Promise<unknown>;
  installUpdate: () => Promise<unknown>;
  onUpdateStatus: (callback: (payload: UpdateStatusPayload) => void) => () => void;
}
