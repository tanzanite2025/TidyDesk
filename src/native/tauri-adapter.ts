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
  AddTodoCommentInput,
  ChangePasswordInput,
  CreateTodoCardInput,
  CreateWorkspaceInviteInput,
  DeleteTodoCommentInput,
  ImportLocalTodosResult,
  LoginWithPasswordInput,
  MoveTodoCardInput,
  RegisterWithPasswordInput,
  RemoteAuthSessionInfo,
  RemoteWorkspaceInfo,
  SwitchAccountSessionInput,
  SyncStatusSnapshot,
  TodoCardComment,
  TodoCommentNotificationPayload,
  TodoCounts,
  TodoState,
  TodoUnreadCommentSummary,
  UpdateTodoCardInput,
  WorkspaceInviteInfo,
  WorkspaceMemberInfo
} from '../types/todo';
import type {
  CaptureOpenedPayload,
  DataRestoreSummary,
  DataSnapshotSummary,
  HotkeyBindingUpdatePayload,
  HotkeyBindingValidationPayload,
  HotkeySettings,
  HotkeyUpdateResult,
  HotkeyValidationResult,
  ModuleStatePayload,
  ResidentSettings,
  ResidentSettingsUpdate,
  SnapshotVerificationReport,
  SnipBackgroundImageResult,
  SnipCompletePayload,
  SnipCompleteResult,
  StickerData,
  StickerPinResult,
  StickerUpdatedPayload,
  TidyDeskSendChannel
} from '../types/tidydesk-api';
import type { UpdateMetadata, UpdateSnapshot } from '../types/update';

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface TauriRuntimeWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
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

export function createTauriNativeClient(): NativeClient {
  return {
    isAvailable: isTauriRuntime,
    capabilities: {
      canScreenSnip: true,
      canUseNativeFileDialog: true,
      canUseGlobalHotkeys: true,
      platformLayout: 'desktop'
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
      listCardComments: (cardId: string) =>
        invoke<TodoCardComment[]>('todos_list_card_comments', { cardId }),
      addCardComment: (payload: AddTodoCommentInput) =>
        invoke<TodoCardComment>('todos_add_card_comment', { payload }),
      deleteCardComment: (payload: DeleteTodoCommentInput) =>
        invoke<TodoCardComment[]>('todos_delete_card_comment', { payload }),
      getUnreadCommentSummary: () =>
        invoke<TodoUnreadCommentSummary>('todos_get_unread_comment_summary'),
      markCardCommentsRead: (cardId: string) =>
        invoke<TodoUnreadCommentSummary>('todos_mark_card_comments_read', { cardId }),
      markAllCommentsRead: () =>
        invoke<TodoUnreadCommentSummary>('todos_mark_all_comments_read'),
      consumePendingFocusCard: () =>
        invoke<string | null>('todos_consume_pending_focus_card'),
      onCountsUpdated: callback => onTauriEvent<TodoCounts>('todo-counts-updated', callback),
      onUpdated: callback => onTauriEvent<TodoState>('todos-updated', callback),
      onCommentsUpdated: callback =>
        onTauriEvent<{ cardIds: string[] }>('todo-comments-updated', callback),
      onUnreadCommentsUpdated: callback =>
        onTauriEvent<TodoUnreadCommentSummary>('todo-comment-unread-updated', callback),
      onFocusCardRequested: callback =>
        onTauriEvent<{ cardId: string }>('todo-focus-card', callback),
      onCommentNotification: callback =>
        onTauriEvent<TodoCommentNotificationPayload>('todo-comment-notification', callback),
      onSnipError: callback => onTauriEvent<{ error: string }>('todo-snip-error', callback)
    },
    accounts: {
      getSession: () => invoke<AccountSessionSnapshot>('accounts_get_session'),
      switchSession: (payload: SwitchAccountSessionInput) =>
        invoke<AccountSessionSnapshot>('accounts_switch_session', { payload }),
      loginWithPassword: (payload: LoginWithPasswordInput) =>
        invoke<AccountSessionSnapshot>('accounts_login_with_password', { payload }),
      registerWithPassword: (payload: RegisterWithPasswordInput) =>
        invoke<AccountSessionSnapshot>('accounts_register_with_password', { payload }),
      changePassword: (payload: ChangePasswordInput) =>
        invoke<void>('accounts_change_password', { payload }),
      listRemoteSessions: () => invoke<RemoteAuthSessionInfo[]>('accounts_list_remote_sessions'),
      revokeRemoteSession: (tokenId: string) =>
        invoke<void>('accounts_revoke_remote_session', { tokenId }),
      listWorkspaces: () => invoke<RemoteWorkspaceInfo[]>('accounts_list_workspaces'),
      listWorkspaceMembers: (workspaceId?: string) =>
        invoke<WorkspaceMemberInfo[]>('accounts_list_workspace_members', {
          workspaceId: workspaceId ?? null
        }),
      createWorkspace: (title: string) =>
        invoke<RemoteWorkspaceInfo>('accounts_create_workspace', { payload: { title } }),
      createWorkspaceInvite: (payload: CreateWorkspaceInviteInput) =>
        invoke<WorkspaceInviteInfo>('accounts_create_workspace_invite', { payload }),
      listWorkspaceInvites: (workspaceId: string) =>
        invoke<WorkspaceInviteInfo[]>('accounts_list_workspace_invites', { workspaceId }),
      revokeWorkspaceInvite: (workspaceId: string, inviteCode: string) =>
        invoke<WorkspaceInviteInfo>('accounts_revoke_workspace_invite', {
          payload: { workspaceId, inviteCode }
        }),
      joinWorkspaceByInvite: (inviteCode: string) =>
        invoke<RemoteWorkspaceInfo>('accounts_join_workspace_by_invite', {
          payload: { inviteCode }
        }),
      logoutToLocal: (keepLocalContinuity = true) =>
        invoke<AccountSessionSnapshot>('accounts_logout_to_local', {
          payload: { keepLocalContinuity }
        }),
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
    windows: {
      control: action => {
        invoke('windows_control', { payload: { action } }).catch(err => {
          console.error('[TIDYDESK] Failed windows_control:', err);
        });
      },
      getShellState: () => invoke<ModuleStatePayload>('windows_get_shell_state'),
      getPathForFile: () => unavailable('windows.getPathForFile'),
      onModuleState: callback => onTauriEvent<ModuleStatePayload>('module-state', callback)
    },
    toolWindows: {
      openTodo: (cardId?: string) => invoke('open_todo_window', { cardId: cardId ?? null }),
      closeTodo: () => invoke('close_todo_window')
    },
    resident: {
      getSettings: () => invoke<ResidentSettings>('resident_get_settings'),
      updateSettings: (payload: ResidentSettingsUpdate) =>
        invoke<ResidentSettings>('resident_update_settings', { payload }),
      showHandle: () => invoke('resident_show_handle'),
      hideHandle: () => invoke('resident_hide_handle'),
      openSettings: () => invoke('resident_open_settings')
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
      completeSnipSelection: (payload: SnipCompletePayload) =>
        invoke<SnipCompleteResult>('snip_complete_selection', { payload }),
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
      cancelDownload: () => invoke<UpdateSnapshot>('updates_cancel_download'),
      install: () => invoke<UpdateSnapshot>('updates_install'),
      onChange: callback => onTauriEvent<UpdateSnapshot>('updates-state', callback)
    },
    events: {
      send: (channel: TidyDeskSendChannel) => {
        invoke('events_send', { payload: { channel } }).catch(err => {
          console.error('[TIDYDESK] Failed events_send:', err);
        });
      }
    },
    backup: {
      listSnapshots: () => invoke<DataSnapshotSummary[]>('backup_list_snapshots'),
      createSnapshot: (targetDir?: string) =>
        invoke<DataSnapshotSummary>('backup_create_snapshot', {
          targetDir: targetDir ?? null
        }),
      verifySnapshot: (snapshotDir: string) =>
        invoke<SnapshotVerificationReport>('backup_verify_snapshot', { snapshotDir }),
      restoreSnapshot: (snapshotDir: string) =>
        invoke<DataRestoreSummary>('backup_restore_snapshot', { snapshotDir })
    }
  };
}
