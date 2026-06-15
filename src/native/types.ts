import type {
  AddAppToDrawerPayload,
  AppIconsUpdatedPayload,
  AppPickerTargetResult,
  CacheInfoResult,
  CaptureOpenedPayload,
  DesktopFilesResult,
  DeleteItemPayload,
  DrawerStatePayload,
  FileIconRequest,
  FileIconResult,
  HotkeyBindingUpdatePayload,
  HotkeyBindingValidationPayload,
  HotkeySettings,
  HotkeyUpdateResult,
  HotkeyValidationResult,
  ImportExternalFilesResult,
  ImportExternalFilesPayload,
  InstalledAppsResult,
  ModuleStatePayload,
  OpenAppPickerPayload,
  RailModule,
  RenameItemPayload,
  RepairShortcutPayload,
  RepairShortcutResult,
  ResidentSettings,
  ResidentSettingsUpdate,
  RestoreToDesktopPayload,
  RestoreToDesktopResult,
  ShortcutValidationStats,
  SnipBackgroundImageResult,
  SnipRect,
  StickerData,
  StickerPinResult,
  StickerUpdatedPayload,
  TargetFileEventPayload,
  TidyDeskSendChannel,
  WindowAction
} from '../types/tidydesk-api';
import type { UpdateMetadata, UpdateSnapshot } from '../types/update';
import type {
  CreateQuickNoteInput,
  QuickNotesState,
  UpdateQuickNoteInput
} from '../types/quick-note';
import type {
  CreateTodoCardInput,
  MoveTodoCardInput,
  TodoCounts,
  TodoState,
  UpdateTodoCardInput
} from '../types/todo';

export interface NativeFilesClient {
  readDesktopFiles: () => Promise<DesktopFilesResult>;
  readIcons: (files: FileIconRequest[]) => Promise<FileIconResult[]>;
  importExternalFiles: (payload: ImportExternalFilesPayload) => Promise<ImportExternalFilesResult>;
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

export interface NativeQuickNotesClient {
  readState: () => Promise<QuickNotesState>;
  createNote: (payload: CreateQuickNoteInput) => Promise<QuickNotesState>;
  updateNote: (payload: UpdateQuickNoteInput) => Promise<QuickNotesState>;
  deleteNote: (noteId: string) => Promise<QuickNotesState>;
}

export interface NativeAppsClient {
  scanInstalled: () => Promise<InstalledAppsResult>;
  refresh: () => Promise<InstalledAppsResult>;
  getCacheInfo: () => Promise<CacheInfoResult>;
  openPicker: (payload: OpenAppPickerPayload) => Promise<unknown>;
  closePicker: () => Promise<unknown>;
  getPickerTarget: () => Promise<AppPickerTargetResult>;
  onSetTargetFolder: (callback: (targetFolder: string) => void) => (() => void) | undefined;
  onIconsUpdated: (callback: (payload: AppIconsUpdatedPayload) => void) => (() => void) | undefined;
  addToDrawer: (payload: AddAppToDrawerPayload) => Promise<unknown>;
}

export interface NativeWindowsClient {
  control: (action: WindowAction) => void;
  getPathForFile: (file: File) => string;
  onDrawerState: (callback: (payload: DrawerStatePayload) => void) => (() => void) | undefined;
  onModuleState: (callback: (payload: ModuleStatePayload) => void) => (() => void) | undefined;
}

export interface NativeToolWindowsClient {
  openTodo: () => Promise<unknown>;
  closeTodo: () => Promise<unknown>;
}

export interface NativeResidentClient {
  getSettings: () => Promise<ResidentSettings>;
  updateSettings: (payload: ResidentSettingsUpdate) => Promise<ResidentSettings>;
  showHandle: () => Promise<unknown>;
  hideHandle: () => Promise<unknown>;
  openSettings: () => Promise<unknown>;
  onOpenSettings: (callback: () => void) => (() => void) | undefined;
}

export interface NativeHotkeysClient {
  getSettings: () => Promise<HotkeySettings>;
  validateBinding: (payload: HotkeyBindingValidationPayload) => Promise<HotkeyValidationResult>;
  updateBinding: (payload: HotkeyBindingUpdatePayload) => Promise<HotkeyUpdateResult>;
  resetDefaults: () => Promise<HotkeyUpdateResult>;
}

export interface NativeClipboardClient {
  readText: () => Promise<string>;
}

export interface NativeCaptureClient {
  onOpened: (callback: (payload: CaptureOpenedPayload) => void) => (() => void) | undefined;
  completeSnipSelection: (rect: SnipRect) => Promise<unknown>;
  cancelSnip: () => Promise<unknown>;
  getBackgroundImage: () => Promise<SnipBackgroundImageResult>;
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
  getMetadata: () => Promise<UpdateMetadata>;
  getState: () => Promise<UpdateSnapshot>;
  check: () => Promise<UpdateSnapshot>;
  download: () => Promise<UpdateSnapshot>;
  install: () => Promise<UpdateSnapshot>;
  onChange: (callback: (payload: UpdateSnapshot) => void) => (() => void) | undefined;
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
  quickNotes: NativeQuickNotesClient;
  apps: NativeAppsClient;
  windows: NativeWindowsClient;
  toolWindows: NativeToolWindowsClient;
  resident: NativeResidentClient;
  hotkeys: NativeHotkeysClient;
  clipboard: NativeClipboardClient;
  capture: NativeCaptureClient;
  stickers: NativeStickersClient;
  updates: NativeUpdatesClient;
  events: NativeEventsClient;
  activeModuleType?: RailModule;
}
