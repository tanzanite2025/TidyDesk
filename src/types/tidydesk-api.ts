export type RailModule = 'todos' | 'capture' | 'settings' | null;

export type WindowAction =
  | 'close'
  | 'minimize'
  | 'open-todos'
  | 'open-capture'
  | 'close-capture'
  | 'open-settings'
  | 'close-settings'
  | 'start-screenshot'
  | 'close-panel';

export type TidyDeskSendChannel = 'user-first-interaction';

export interface ResidentSettings {
  autostartEnabled: boolean;
  launchMinimized: boolean;
  autoUpdateCheckEnabled: boolean;
  autoStickAfterSnip: boolean;
}

export interface ResidentSettingsUpdate {
  autostartEnabled?: boolean;
  launchMinimized?: boolean;
  autoUpdateCheckEnabled?: boolean;
  autoStickAfterSnip?: boolean;
}

export type HotkeyAction =
  | 'paste_pending_sticker'
  | 'toggle_quick_capture'
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
