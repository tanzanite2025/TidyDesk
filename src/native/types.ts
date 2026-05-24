import type {
  AddAppToDrawerPayload,
  AppPickerTargetResult,
  AppVersionInfo,
  CacheInfoResult,
  CaptureOpenedPayload,
  DesktopFilesResult,
  DeleteItemPayload,
  DrawerStatePayload,
  ImportExternalFilesPayload,
  InstalledAppsResult,
  ModuleStatePayload,
  OpenAppPickerPayload,
  RailModule,
  RenameItemPayload,
  RepairShortcutPayload,
  RepairShortcutResult,
  RestoreToDesktopPayload,
  RestoreToDesktopResult,
  ShortcutValidationStats,
  SnipRect,
  StickerData,
  StickerPinResult,
  StickerUpdatedPayload,
  TargetFileEventPayload,
  UpdateStatusPayload,
  TidyDeskSendChannel,
  WindowAction
} from '../types/tidydesk-api';
import type {
  CreateTodoCardInput,
  MoveTodoCardInput,
  TodoCounts,
  TodoState,
  UpdateTodoCardInput
} from '../types/todo';

export interface NativeFilesClient {
  readDesktopFiles: () => Promise<DesktopFilesResult>;
  importExternalFiles: (payload: ImportExternalFilesPayload) => Promise<unknown>;
  open: (filePath: string) => Promise<unknown>;
  restoreToDesktop: (payload: RestoreToDesktopPayload) => Promise<RestoreToDesktopResult>;
}

export interface NativeDrawersClient {
  create: (name: string) => Promise<unknown>;
  renameItem: (payload: RenameItemPayload) => Promise<unknown>;
  deleteItem: (payload: DeleteItemPayload) => Promise<unknown>;
}

export interface NativeShortcutsClient {
  validateAll: () => Promise<ShortcutValidationStats>;
  repair: (payload: RepairShortcutPayload) => Promise<RepairShortcutResult>;
  onTargetFileDeleted: (callback: (payload: TargetFileEventPayload) => void) => (() => void) | undefined;
  onTargetFileRestored: (callback: (payload: TargetFileEventPayload) => void) => (() => void) | undefined;
  onValidated: (callback: (payload: ShortcutValidationStats) => void) => (() => void) | undefined;
}

export interface NativeTodosClient {
  readState: () => Promise<TodoState>;
  getCounts: () => Promise<TodoCounts>;
  createCard: (payload: CreateTodoCardInput) => Promise<TodoState>;
  updateCard: (payload: UpdateTodoCardInput) => Promise<TodoState>;
  deleteCard: (cardId: string) => Promise<TodoState>;
  moveCard: (payload: MoveTodoCardInput) => Promise<TodoState>;
  onCountsUpdated: (callback: (payload: TodoCounts) => void) => (() => void) | undefined;
}

export interface NativeAppsClient {
  scanInstalled: () => Promise<InstalledAppsResult>;
  refresh: () => Promise<InstalledAppsResult>;
  getCacheInfo: () => Promise<CacheInfoResult>;
  openPicker: (payload: OpenAppPickerPayload) => Promise<unknown>;
  closePicker: () => Promise<unknown>;
  getPickerTarget: () => Promise<AppPickerTargetResult>;
  onSetTargetFolder: (callback: (targetFolder: string) => void) => (() => void) | undefined;
  addToDrawer: (payload: AddAppToDrawerPayload) => Promise<unknown>;
}

export interface NativeWindowsClient {
  control: (action: WindowAction) => void;
  getPathForFile: (file: File) => string;
  onDrawerState: (callback: (payload: DrawerStatePayload) => void) => (() => void) | undefined;
  onModuleState: (callback: (payload: ModuleStatePayload) => void) => (() => void) | undefined;
}

export interface NativeClipboardClient {
  readText: () => Promise<string>;
}

export interface NativeCaptureClient {
  onOpened: (callback: (payload: CaptureOpenedPayload) => void) => (() => void) | undefined;
  completeSnipSelection: (rect: SnipRect) => Promise<unknown>;
  cancelSnip: () => Promise<unknown>;
}

export interface NativeStickersClient {
  get: (stickerId: string) => Promise<StickerData | null>;
  togglePin: (stickerId: string) => Promise<StickerPinResult>;
  copy: (stickerId: string) => Promise<unknown>;
  saveAs: (stickerId: string) => Promise<unknown>;
  close: (stickerId: string) => Promise<unknown>;
  onUpdated: (callback: (payload: StickerUpdatedPayload) => void) => (() => void) | undefined;
}

export interface NativeUpdatesClient {
  getAppVersion: () => Promise<AppVersionInfo>;
  checkForUpdates: () => Promise<UpdateStatusPayload>;
  downloadUpdate: () => Promise<unknown>;
  installUpdate: () => Promise<unknown>;
  onStatus: (callback: (payload: UpdateStatusPayload) => void) => (() => void) | undefined;
}

export interface NativeEventsClient {
  send: (channel: TidyDeskSendChannel) => void;
}

export interface NativeClient {
  isAvailable: () => boolean;
  files: NativeFilesClient;
  drawers: NativeDrawersClient;
  shortcuts: NativeShortcutsClient;
  todos: NativeTodosClient;
  apps: NativeAppsClient;
  windows: NativeWindowsClient;
  clipboard: NativeClipboardClient;
  capture: NativeCaptureClient;
  stickers: NativeStickersClient;
  updates: NativeUpdatesClient;
  events: NativeEventsClient;
  activeModuleType?: RailModule;
}
