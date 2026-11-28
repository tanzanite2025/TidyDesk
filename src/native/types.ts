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
  RailModule,
  ResidentSettings,
  ResidentSettingsUpdate,
  SnapshotVerificationReport,
  SnipBackgroundImageResult,
  SnipCompletePayload,
  SnipCompleteResult,
  StickerData,
  StickerPinResult,
  StickerUpdatedPayload,
  TidyDeskSendChannel,
  WindowAction
} from '../types/tidydesk-api';
import type { UpdateMetadata, UpdateSnapshot } from '../types/update';
import type {
  CreateQuickNoteInput,
  QuickNotesState,
  StickyNotesState,
  UpdateQuickNoteInput,
  UpdateStickyNoteOptionsInput
} from '../types/quick-note';
import type {
  AccountSessionSnapshot,
  AddTodoAttachmentBytesInput,
  AddTodoCommentInput,
  ChangePasswordInput,
  CreateTodoCardInput,
  CreateWorkspaceInviteInput,
  DeleteTodoAttachmentInput,
  DeleteTodoCommentInput,
  ImportLocalTodosResult,
  LoginWithPasswordInput,
  MoveTodoCardInput,
  PickTodoAttachmentResult,
  RegisterWithPasswordInput,
  RemoteAuthSessionInfo,
  RemoteWorkspaceInfo,
  SetTodoCardCoverInput,
  SwitchAccountSessionInput,
  SyncStatusSnapshot,
  TodoCard,
  TodoCardComment,
  TodoCommentNotificationPayload,
  TodoCounts,
  TodoState,
  TodoUnreadCommentSummary,
  UpdateTodoAttachmentMetaInput,
  UpdateTodoCardInput,
  WorkspaceInviteInfo,
  WorkspaceMemberInfo
} from '../types/todo';

export interface NativeTodosClient {
  readState: () => Promise<TodoState>;
  getCounts: () => Promise<TodoCounts>;
  createCard: (payload: CreateTodoCardInput) => Promise<TodoState>;
  updateCard: (payload: UpdateTodoCardInput) => Promise<TodoState>;
  deleteCard: (cardId: string) => Promise<TodoState>;
  moveCard: (payload: MoveTodoCardInput) => Promise<TodoState>;
  getCardDetail: (cardId: string) => Promise<TodoCard>;
  addAttachmentBytes: (payload: AddTodoAttachmentBytesInput) => Promise<TodoState>;
  pickAndAddAttachment: (cardId: string, subtaskId?: string | null) => Promise<PickTodoAttachmentResult>;
  deleteAttachment: (payload: DeleteTodoAttachmentInput) => Promise<TodoState>;
  setCardCover: (payload: SetTodoCardCoverInput) => Promise<TodoState>;
  updateAttachmentMeta: (payload: UpdateTodoAttachmentMetaInput) => Promise<TodoState>;
  startSnipForCard: (cardId: string, subtaskId?: string | null) => Promise<unknown>;
  listCardComments: (cardId: string) => Promise<TodoCardComment[]>;
  addCardComment: (payload: AddTodoCommentInput) => Promise<TodoCardComment>;
  deleteCardComment: (payload: DeleteTodoCommentInput) => Promise<TodoCardComment[]>;
  getUnreadCommentSummary: () => Promise<TodoUnreadCommentSummary>;
  markCardCommentsRead: (cardId: string) => Promise<TodoUnreadCommentSummary>;
  markAllCommentsRead: () => Promise<TodoUnreadCommentSummary>;
  consumePendingFocusCard?: () => Promise<string | null>;
  onCountsUpdated: (callback: (payload: TodoCounts) => void) => (() => void) | undefined;
  onUpdated: (callback: (payload: TodoState) => void) => (() => void) | undefined;
  onCommentsUpdated?: (callback: (payload: { cardIds: string[] }) => void) => (() => void) | undefined;
  onUnreadCommentsUpdated?: (
    callback: (payload: TodoUnreadCommentSummary) => void
  ) => (() => void) | undefined;
  onFocusCardRequested?: (
    callback: (payload: { cardId: string }) => void
  ) => (() => void) | undefined;
  onCommentNotification?: (
    callback: (payload: TodoCommentNotificationPayload) => void
  ) => (() => void) | undefined;
  onSnipError?: (callback: (payload: { error: string }) => void) => (() => void) | undefined;
}

export interface NativeQuickNotesClient {
  readState: () => Promise<QuickNotesState>;
  createNote: (payload: CreateQuickNoteInput) => Promise<QuickNotesState>;
  updateNote: (payload: UpdateQuickNoteInput) => Promise<QuickNotesState>;
  deleteNote: (noteId: string) => Promise<QuickNotesState>;
  onUpdated: (callback: (payload: QuickNotesState) => void) => (() => void) | undefined;
}

export interface NativeStickyNotesClient {
  list: () => Promise<StickyNotesState>;
  open: (noteId: string) => Promise<StickyNotesState>;
  unpin: (noteId: string) => Promise<StickyNotesState>;
  updateOptions: (payload: UpdateStickyNoteOptionsInput) => Promise<StickyNotesState>;
  onUpdated: (callback: (payload: StickyNotesState) => void) => (() => void) | undefined;
}

export interface NativeWindowsClient {
  control: (action: WindowAction) => void;
  getShellState?: () => Promise<ModuleStatePayload>;
  getPathForFile: (file: File) => string;
  onModuleState: (callback: (payload: ModuleStatePayload) => void) => (() => void) | undefined;
}

export interface NativeToolWindowsClient {
  openTodo: (cardId?: string) => Promise<unknown>;
  closeTodo: () => Promise<unknown>;
}

export interface NativeResidentClient {
  getSettings: () => Promise<ResidentSettings>;
  updateSettings: (payload: ResidentSettingsUpdate) => Promise<ResidentSettings>;
  showHandle: () => Promise<unknown>;
  hideHandle: () => Promise<unknown>;
  openSettings: () => Promise<unknown>;
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
  completeSnipSelection: (payload: SnipCompletePayload) => Promise<SnipCompleteResult>;
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
  cancelDownload?: () => Promise<UpdateSnapshot>;
  install: () => Promise<UpdateSnapshot>;
  onChange: (callback: (payload: UpdateSnapshot) => void) => (() => void) | undefined;
}

export interface NativeEventsClient {
  send: (channel: TidyDeskSendChannel) => void;
}

export interface NativeBackupClient {
  listSnapshots: () => Promise<DataSnapshotSummary[]>;
  createSnapshot: (targetDir?: string) => Promise<DataSnapshotSummary>;
  verifySnapshot: (snapshotDir: string) => Promise<SnapshotVerificationReport>;
  restoreSnapshot: (snapshotDir: string) => Promise<DataRestoreSummary>;
}

export interface NativeAccountsClient {
  getSession: () => Promise<AccountSessionSnapshot>;
  switchSession: (payload: SwitchAccountSessionInput) => Promise<AccountSessionSnapshot>;
  loginWithPassword?: (payload: LoginWithPasswordInput) => Promise<AccountSessionSnapshot>;
  registerWithPassword?: (payload: RegisterWithPasswordInput) => Promise<AccountSessionSnapshot>;
  changePassword?: (payload: ChangePasswordInput) => Promise<void>;
  listRemoteSessions?: () => Promise<RemoteAuthSessionInfo[]>;
  revokeRemoteSession?: (tokenId: string) => Promise<void>;
  listWorkspaces?: () => Promise<RemoteWorkspaceInfo[]>;
  listWorkspaceMembers?: (workspaceId?: string) => Promise<WorkspaceMemberInfo[]>;
  createWorkspace?: (title: string) => Promise<RemoteWorkspaceInfo>;
  createWorkspaceInvite?: (payload: CreateWorkspaceInviteInput) => Promise<WorkspaceInviteInfo>;
  listWorkspaceInvites?: (workspaceId: string) => Promise<WorkspaceInviteInfo[]>;
  revokeWorkspaceInvite?: (workspaceId: string, inviteCode: string) => Promise<WorkspaceInviteInfo>;
  joinWorkspaceByInvite?: (inviteCode: string) => Promise<RemoteWorkspaceInfo>;
  logoutToLocal: (keepLocalContinuity?: boolean) => Promise<AccountSessionSnapshot>;
  importLocalTodos: () => Promise<ImportLocalTodosResult>;
  onSessionChanged: (callback: (payload: AccountSessionSnapshot) => void) => (() => void) | undefined;
}

export interface SyncRealtimeAppliedPayload {
  pulledCards: number;
  pulledNotes: number;
  cursor: string;
}

export interface SyncRealtimeStateChangedPayload {
  realtimeActive: boolean;
  reason?: string | null;
}

export interface NativeSyncClient {
  getStatus: () => Promise<SyncStatusSnapshot>;
  clearOutbox: () => Promise<SyncStatusSnapshot>;
  runOnce: () => Promise<SyncStatusSnapshot>;
  setRealtimeEnabled?: (enabled: boolean) => Promise<SyncStatusSnapshot>;
  onRealtimeApplied?: (callback: (payload: SyncRealtimeAppliedPayload) => void) => (() => void) | undefined;
  onRealtimeStateChanged?: (
    callback: (payload: SyncRealtimeStateChangedPayload) => void
  ) => (() => void) | undefined;
}

export interface NativeCapabilities {
  canScreenSnip: boolean;
  canUseNativeFileDialog: boolean;
  canUseGlobalHotkeys: boolean;
  platformLayout: 'desktop' | 'mobile';
}

export interface NativeClient {
  isAvailable: () => boolean;
  capabilities?: NativeCapabilities;
  todos: NativeTodosClient;
  accounts: NativeAccountsClient;
  sync: NativeSyncClient;
  quickNotes: NativeQuickNotesClient;
  stickyNotes: NativeStickyNotesClient;
  windows: NativeWindowsClient;
  toolWindows: NativeToolWindowsClient;
  resident: NativeResidentClient;
  hotkeys: NativeHotkeysClient;
  clipboard: NativeClipboardClient;
  capture: NativeCaptureClient;
  stickers: NativeStickersClient;
  updates: NativeUpdatesClient;
  events: NativeEventsClient;
  backup: NativeBackupClient;
  activeModuleType?: RailModule;
}
