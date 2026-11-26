import type { TidyFile, TidyFolder } from './file';

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
  | 'close-capture'
  | 'start-screenshot'
  | 'close-panel';

export type TidyDeskSendChannel = 'user-first-interaction' | 'drawer-opened' | 'file-dropped';

export interface DesktopFilesResult {
  files: TidyFile[];
  folders: TidyFolder[];
  desktopPath?: string;
  tidyBoxPath?: string;
}

export interface FileIconRequest {
  id: string;
  path: string;
  targetPath?: string | null;
}

export interface FileIconResult {
  id: string;
  icon?: string | null;
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

export type ImportSkippedReason = 'missing' | 'alreadyInDrawer' | 'protected';

export interface ImportSkippedFileResult {
  source: string;
  reason: ImportSkippedReason;
}

export interface ImportFailedFileResult {
  source: string;
  error: string;
}

export interface ImportExternalFilesResult {
  success: boolean;
  added: ImportedFileResult[];
  skipped: ImportSkippedFileResult[];
  failed: ImportFailedFileResult[];
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

export type HotkeyAction =
  | 'paste_pending_sticker'
  | 'toggle_quick_capture'
  | 'toggle_files_drawer'
  | 'new_sticky_note';

export type HotkeyRegistrationStatus = 'registered' | 'conflict' | 'disabled' | 'unset';

export interface HotkeyBinding {
  action: HotkeyAction;
  label: string;
  accelerator: string | null;
  displayAccelerator: string | null;
  enabled: boolean;
  status: HotkeyRegistrationStatus;
  statusMessage: string | null;
}

export interface HotkeySettings {
  version: number;
  bindings: HotkeyBinding[];
}

export interface HotkeyBindingUpdatePayload {
  action: HotkeyAction;
  accelerator: string | null;
  enabled: boolean;
}

export interface HotkeyBindingValidationPayload {
  action: HotkeyAction;
  accelerator: string | null;
  enabled: boolean;
}

export interface HotkeyValidationResult {
  valid: boolean;
  reason: string | null;
  message: string;
  normalizedAccelerator: string | null;
  displayAccelerator: string | null;
}

export interface HotkeyUpdateResult {
  success: boolean;
  reason: string | null;
  message: string;
  settings: HotkeySettings;
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

export type SnipTargetKind = 'standard' | 'todo_card';

export type SnipOutputAction =
  | 'default'
  | 'copy'
  | 'pin_sticker'
  | 'save_as'
  | 'stash_pending'
  | 'attach_todo';

export interface SnipMonitorMeta {
  width: number;
  height: number;
  logicalWidth: number;
  logicalHeight: number;
  scaleFactor: number;
}

export interface SnipSnapRect {
  x: number;
  y: number;
  width: number;
  height: number;
  title?: string;
}

export interface SnipCompletePayload extends SnipRect {
  action?: SnipOutputAction;
  hasAnnotations?: boolean;
  compositedPngBase64?: string;
  compositedPngBytes?: number[];
  sessionId?: number;
}

export interface SnipCompleteResult {
  success: boolean;
  action?: SnipOutputAction;
  stickerId?: string | null;
  pasted?: boolean;
  savedPath?: string | null;
  canceled?: boolean;
}

export interface SnipBackgroundImageResult {
  success: boolean;
  sessionId?: number | null;
  imagePath?: string | null;
  imageUrl?: string | null;
  targetKind?: SnipTargetKind;
  monitor?: SnipMonitorMeta | null;
  snapRects?: SnipSnapRect[];
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

export interface DataSnapshotSummary {
  snapshotDir: string;
  folderName: string;
  createdAtMs: string;
  appVersion: string;
  scopeId: string;
  fileCount: number;
  totalBytes: number;
  corruptError?: string | null;
}

export interface SnapshotVerificationReport {
  snapshotDir: string;
  scopeId: string;
  verifiedFiles: number;
  totalBytes: number;
  valid: boolean;
}

export interface DataRestoreSummary {
  snapshotDir: string;
  restoredFiles: number;
  preRestoreSnapshotDir: string | null;
  scopeId: string;
}
