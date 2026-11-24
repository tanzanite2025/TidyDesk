import type { NativeClient } from './types';
import type {
  CreateQuickNoteInput,
  QuickNotesState,
  StickyNotesState,
  UpdateQuickNoteInput,
  UpdateStickyNoteOptionsInput
} from '../types/quick-note';
import type {
  AccountSessionSnapshot,
  ChangePasswordInput,
  CreateTodoCardInput,
  ImportLocalTodosResult,
  LoginWithPasswordInput,
  MoveTodoCardInput,
  RemoteAuthSessionInfo,
  RemoteWorkspaceInfo,
  SwitchAccountSessionInput,
  SyncStatusSnapshot,
  TodoCounts,
  TodoState,
  UpdateTodoCardInput
} from '../types/todo';
import type {
  CaptureOpenedPayload,
  DesktopFilesResult,
  DrawerStatePayload,
  FileIconRequest,
  FileIconResult,
  HotkeyBindingUpdatePayload,
  HotkeyBindingValidationPayload,
  HotkeySettings,
  HotkeyUpdateResult,
  HotkeyValidationResult,
  AppIconsUpdatedPayload,
  ImportExternalFilesResult,
  InstalledApp,
  InstalledAppsResult,
  ModuleStatePayload,
  RepairShortcutPayload,
  RepairShortcutResult,
  ResidentSettings,
  ResidentSettingsUpdate,
  SnipBackgroundImageResult,
  SnipRect,
  StickerData,
  StickerPinResult,
  StickerUpdatedPayload,
  TidyDeskSendChannel,
  TargetFileEventPayload,
  RestoreToDesktopResult
} from '../types/tidydesk-api';
import type { UpdateMetadata, UpdateSnapshot } from '../types/update';
import type { ShortcutValidationStats } from '../types/tidydesk-api';

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface TauriRuntimeWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
}

interface ShortcutMetadata {
  name?: string;
  shortcutPath?: string;
  source?: string;
  category?: string;
  size?: number;
  modifiedAt?: string;
  depth?: number;
}

interface ScanMetadataResult {
  shortcuts?: ShortcutMetadata[];
  scannedPaths?: string[];
  durationMs?: number;
}

interface ScanInstalledResult {
  apps?: InstalledApp[];
  metadata?: ScanMetadataResult;
  skippedCount?: number;
}

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const tauriWindow = window as TauriRuntimeWindow;
  return Boolean(tauriWindow.__TAURI_INTERNALS__) || navigator.userAgent.toLowerCase().includes('tauri');
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const api = await import('@tauri-apps/api/core');
  return (api.invoke as TauriInvoke)<T>(command, args);
}

async function fileUrl(filePath: string): Promise<string> {
  const api = await import('@tauri-apps/api/core');
  return api.convertFileSrc(filePath);
}

function onTauriEvent<T>(eventName: string, callback: (payload: T) => void): () => void {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  import('@tauri-apps/api/event')
    .then(api => api.listen<T>(eventName, event => callback(event.payload)))
    .then(nextUnlisten => {
      if (disposed) nextUnlisten();
      else unlisten = nextUnlisten;
    })
    .catch(err => {
      console.error(`[TIDYDESK] Failed to listen Tauri event "${eventName}":`, err);
    });

  return () => {
    disposed = true;
    unlisten?.();
  };
}

function unavailable(feature: string): never {
  throw new Error(`Tauri NativeClient feature is not implemented yet: ${feature}`);
}

async function scanInstalledAppsWithTargets(): Promise<InstalledAppsResult> {
  try {
    const result = await invoke<ScanInstalledResult>('apps_scan_installed');
    return {
      success: true,
      apps: Array.isArray(result.apps) ? result.apps : []
    };
  } catch (err) {
    return {
      success: false,
      apps: [],
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

async function refreshInstalledAppsWithTargets(): Promise<InstalledAppsResult> {
  try {
    const result = await invoke<ScanInstalledResult>('apps_refresh_installed');
    return {
      success: true,
      apps: Array.isArray(result.apps) ? result.apps : []
    };
  } catch (err) {
    return {
      success: false,
      apps: [],
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

function normalizeModifiedAt(value: unknown): string {
  if (typeof value === 'string' && Number.isNaN(Number(value)) && !Number.isNaN(Date.parse(value))) {
    return value;
  }

  const timestamp = Number(value);
  if (Number.isFinite(timestamp)) {
    return new Date(timestamp).toISOString();
  }

  return new Date().toISOString();
}

function normalizeDesktopFilesResult(result: DesktopFilesResult): DesktopFilesResult {
  return {
    ...result,
    files: Array.isArray(result.files)
      ? result.files.map(file => ({
          ...file,
          modifiedAt: normalizeModifiedAt(file.modifiedAt)
        }))
      : [],
    folders: Array.isArray(result.folders)
      ? result.folders.map(folder => ({
          ...folder,
          modifiedAt: normalizeModifiedAt(folder.modifiedAt)
        }))
      : []
  };
}

export function createTauriNativeClient(): NativeClient {
  return {
    isAvailable: isTauriRuntime,
    capabilities: {
      canScreenSnip: true,
      canUseNativeFileDialog: true,
      canUseGlobalHotkeys: true,
      platformLayout: 'desktop'
    },
    files: {
      readDesktopFiles: async () => normalizeDesktopFilesResult(await invoke<DesktopFilesResult>('files_read_desktop_files')),
      readIcons: (files: FileIconRequest[]) =>
        invoke<FileIconResult[]>('files_read_icons', { payload: { files } }),
      importExternalFiles: payload => invoke<ImportExternalFilesResult>('files_import_external_files', { payload }),
      open: filePath => invoke('files_open', { payload: { filePath } }),
      restoreToDesktop: payload => invoke<RestoreToDesktopResult>('files_restore_to_desktop', { payload }),
      onDrawerFilesChanged: callback => onTauriEvent('drawer-files-changed', () => callback())
    },
    drawers: {
      create: name => invoke('drawers_create', { name }),
      renameItem: payload => invoke('drawers_rename_item', { payload }),
      deleteItem: payload => invoke('drawers_delete_item', { payload })
    },
    shortcuts: {
      validateAll: () => invoke<ShortcutValidationStats>('shortcuts_validate_all'),
      repair: (payload: RepairShortcutPayload) => invoke<RepairShortcutResult>('shortcuts_repair', { payload }),
      onTargetFileDeleted: callback => onTauriEvent<TargetFileEventPayload>('target-file-deleted', callback),
      onTargetFileRestored: callback => onTauriEvent<TargetFileEventPayload>('target-file-restored', callback),
      onValidated: callback => onTauriEvent<ShortcutValidationStats>('shortcuts-validated', callback)
    },
    todos: {
      readState: () => invoke<TodoState>('todos_read_state'),
      getCounts: () => invoke<TodoCounts>('todos_get_counts'),
      createCard: (payload: CreateTodoCardInput) => invoke<TodoState>('todos_create_card', { payload }),
      updateCard: (payload: UpdateTodoCardInput) => invoke<TodoState>('todos_update_card', { payload }),
      deleteCard: (cardId: string) => invoke<TodoState>('todos_delete_card', { cardId }),
      moveCard: (payload: MoveTodoCardInput) => invoke<TodoState>('todos_move_card', { payload }),
      getCardDetail: (cardId: string) => invoke('todos_get_card_detail', { cardId }),
      addAttachmentBytes: payload => invoke<TodoState>('todos_add_attachment_bytes', { payload }),
      pickAndAddAttachment: (cardId: string, subtaskId?: string | null) =>
        invoke('todos_pick_and_add_attachment', { cardId, subtaskId: subtaskId ?? null }),
      deleteAttachment: payload => invoke<TodoState>('todos_delete_attachment', { payload }),
      setCardCover: payload => invoke<TodoState>('todos_set_card_cover', { payload }),
      updateAttachmentMeta: payload => invoke<TodoState>('todos_update_attachment_meta', { payload }),
      startSnipForCard: (cardId: string, subtaskId?: string | null) =>
        invoke('todos_start_snip_for_card', { cardId, subtaskId: subtaskId ?? null }),
      onCountsUpdated: callback => onTauriEvent<TodoCounts>('todo-counts-updated', callback),
      onUpdated: callback => onTauriEvent<TodoState>('todos-updated', callback),
      onSnipError: callback => onTauriEvent<{ error: string }>('todo-snip-error', callback)
    },
    accounts: {
      getSession: () => invoke<AccountSessionSnapshot>('accounts_get_session'),
      switchSession: (payload: SwitchAccountSessionInput) =>
        invoke<AccountSessionSnapshot>('accounts_switch_session', { payload }),
      loginWithPassword: (payload: LoginWithPasswordInput) =>
        invoke<AccountSessionSnapshot>('accounts_login_with_password', { payload }),
      changePassword: (payload: ChangePasswordInput) =>
        invoke<void>('accounts_change_password', { payload }),
      listRemoteSessions: () => invoke<RemoteAuthSessionInfo[]>('accounts_list_remote_sessions'),
      revokeRemoteSession: (tokenId: string) =>
        invoke<void>('accounts_revoke_remote_session', { tokenId }),
      listWorkspaces: () => invoke<RemoteWorkspaceInfo[]>('accounts_list_workspaces'),
      logoutToLocal: () => invoke<AccountSessionSnapshot>('accounts_logout_to_local'),
      importLocalTodos: () => invoke<ImportLocalTodosResult>('accounts_import_local_todos'),
      onSessionChanged: callback =>
        onTauriEvent<AccountSessionSnapshot>('account-session-changed', callback)
    },
    sync: {
      getStatus: () => invoke<SyncStatusSnapshot>('sync_get_status'),
      clearOutbox: () => invoke<SyncStatusSnapshot>('sync_clear_outbox'),
      runOnce: () => invoke<SyncStatusSnapshot>('sync_run_once'),
      setRealtimeEnabled: (enabled: boolean) =>
        invoke<SyncStatusSnapshot>('sync_set_realtime_enabled', { enabled }),
      onRealtimeApplied: callback => onTauriEvent('sync-realtime-applied', callback),
      onRealtimeStateChanged: callback =>
        onTauriEvent('sync-realtime-state-changed', callback)
    },
    quickNotes: {
      readState: () => invoke<QuickNotesState>('quick_notes_read_state'),
      createNote: (payload: CreateQuickNoteInput) => invoke<QuickNotesState>('quick_notes_create_note', { payload }),
      updateNote: (payload: UpdateQuickNoteInput) => invoke<QuickNotesState>('quick_notes_update_note', { payload }),
      deleteNote: (noteId: string) => invoke<QuickNotesState>('quick_notes_delete_note', { noteId }),
      onUpdated: callback => onTauriEvent<QuickNotesState>('quick-notes-updated', callback)
    },
    stickyNotes: {
      list: () => invoke<StickyNotesState>('sticky_notes_list'),
      open: (noteId: string) => invoke<StickyNotesState>('sticky_notes_open', { noteId }),
      unpin: (noteId: string) => invoke<StickyNotesState>('sticky_notes_unpin', { noteId }),
      updateOptions: (payload: UpdateStickyNoteOptionsInput) =>
        invoke<StickyNotesState>('sticky_notes_update_options', { payload }),
      onUpdated: callback => onTauriEvent<StickyNotesState>('sticky-notes-updated', callback)
    },
    apps: {
      scanInstalled: scanInstalledAppsWithTargets,
      refresh: refreshInstalledAppsWithTargets,
      getCacheInfo: async () => {
        try {
          const info = await invoke<Record<string, unknown>>('apps_cache_info');
          return {
            success: true,
            info: {
              ...info,
              source: 'tauri-rust-cache'
            }
          };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err)
          };
        }
      },
      openPicker: payload => invoke('open_app_picker', { payload }),
      closePicker: () => invoke('close_app_picker'),
      getPickerTarget: () => invoke('apps_get_picker_target'),
      onSetTargetFolder: callback => onTauriEvent<string>('set-target-folder', callback),
      onIconsUpdated: callback => onTauriEvent<AppIconsUpdatedPayload>('apps-icons-updated', callback),
      addToDrawer: payload => invoke('apps_add_to_drawer', { payload })
    },
    windows: {
      control: action => {
        invoke('windows_control', { payload: { action } }).catch(err => {
          console.error('[TIDYDESK] Failed windows_control:', err);
        });
      },
      getPathForFile: () => unavailable('windows.getPathForFile'),
      onDrawerState: callback => onTauriEvent<DrawerStatePayload>('drawer-state', callback),
      onModuleState: callback => onTauriEvent<ModuleStatePayload>('module-state', callback)
    },
    toolWindows: {
      openTodo: () => invoke('open_todo_window'),
      closeTodo: () => invoke('close_todo_window')
    },
    resident: {
      getSettings: () => invoke<ResidentSettings>('resident_get_settings'),
      updateSettings: (payload: ResidentSettingsUpdate) =>
        invoke<ResidentSettings>('resident_update_settings', { payload }),
      showHandle: () => invoke('resident_show_handle'),
      hideHandle: () => invoke('resident_hide_handle'),
      openSettings: () => invoke('resident_open_settings'),
      onOpenSettings: callback => onTauriEvent<void>('open-settings-panel', callback)
    },
    hotkeys: {
      getSettings: () => invoke<HotkeySettings>('hotkeys_get_settings'),
      validateBinding: (payload: HotkeyBindingValidationPayload) =>
        invoke<HotkeyValidationResult>('hotkeys_validate_binding', { payload }),
      updateBinding: (payload: HotkeyBindingUpdatePayload) =>
        invoke<HotkeyUpdateResult>('hotkeys_update_binding', { payload }),
      resetDefaults: () => invoke<HotkeyUpdateResult>('hotkeys_reset_defaults')
    },
    clipboard: {
      readText: () => invoke<string>('clipboard_read_text')
    },
    capture: {
      onOpened: callback => onTauriEvent<CaptureOpenedPayload>('capture-opened', callback),
      completeSnipSelection: (rect: SnipRect) => invoke('snip_complete_selection', { payload: rect }),
      cancelSnip: () => invoke('snip_cancel'),
      getBackgroundImage: async () => {
        const result = await invoke<SnipBackgroundImageResult>('snip_get_background_image');
        if (result.success && !result.imageUrl && result.imagePath) {
          return { ...result, imageUrl: await fileUrl(result.imagePath) };
        }
        return result;
      }
    },
    stickers: {
      get: async (stickerId: string) => {
        const sticker = await invoke<StickerData | null>('sticker_get', { sticker_id: stickerId });
        if (!sticker) return null;
        if (sticker.imageUrl) return sticker;
        return { ...sticker, imageUrl: await fileUrl(sticker.imagePath) };
      },
      togglePin: (stickerId: string) => invoke<StickerPinResult>('sticker_toggle_pin', { sticker_id: stickerId }),
      copy: (stickerId: string) => invoke('sticker_copy', { sticker_id: stickerId }),
      saveAs: (stickerId: string) => invoke('sticker_save_as', { sticker_id: stickerId }),
      close: (stickerId: string) => invoke('sticker_close', { sticker_id: stickerId }),
      onUpdated: callback => onTauriEvent<StickerUpdatedPayload>('sticker-updated', callback)
    },
    updates: {
      getMetadata: () => invoke<UpdateMetadata>('updates_get_metadata'),
      getState: () => invoke<UpdateSnapshot>('updates_get_state'),
      check: () => invoke<UpdateSnapshot>('updates_check'),
      download: () => invoke<UpdateSnapshot>('updates_download'),
      install: () => invoke<UpdateSnapshot>('updates_install'),
      onChange: callback => onTauriEvent<UpdateSnapshot>('updates-state', callback)
    },
    events: {
      send: (channel: TidyDeskSendChannel) => {
        invoke('events_send', { payload: { channel } }).catch(err => {
          console.error('[TIDYDESK] Failed events_send:', err);
        });
      }
    }
  };
}
