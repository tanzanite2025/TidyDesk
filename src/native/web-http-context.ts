import type { QuickNote, QuickNotesState } from '../types/quick-note';
import type {
  AccountSessionSnapshot,
  SyncStatusSnapshot,
  TodoCard,
  TodoCardComment,
  TodoCommentNotificationPayload,
  TodoCounts,
  TodoState,
  TodoUnreadCommentSummary
} from '../types/todo';
import type { SyncRealtimeAppliedPayload } from './types';
import { readStoredWebSession, type StoredWebSession, writeStoredWebSession } from './web-http-helpers';

export interface WebHttpContext {
  getSession: () => StoredWebSession | null;
  setSession: (next: StoredWebSession | null) => void;
  requireSession: () => StoredWebSession;
  resolveWorkspaceId: (s?: StoredWebSession | null) => string;
  authHeaders: (active: StoredWebSession, contentType?: string) => Record<string, string>;
  toSessionSnapshot: (s: StoredWebSession | null) => AccountSessionSnapshot;
  buildSyncStatus: (statusMessage: string) => SyncStatusSnapshot;
  recordSyncCursor: (cursor: string) => void;
  isRealtimeEnabled: () => boolean;
  setRealtimeEnabledFlag: (enabled: boolean) => void;
  cardsById: Map<string, TodoCard>;
  commentsByCardId: Map<string, TodoCardComment[]>;
  quickNotesById: Map<string, QuickNote>;
  blobUrlCache: Map<string, string>;
  pendingBlobFetches: Map<string, Promise<string | undefined>>;
  sessionListeners: Set<(payload: AccountSessionSnapshot) => void>;
  stateListeners: Set<(payload: TodoState) => void>;
  countListeners: Set<(payload: TodoCounts) => void>;
  commentListeners: Set<(payload: { cardIds: string[] }) => void>;
  unreadListeners: Set<(payload: TodoUnreadCommentSummary) => void>;
  notificationListeners: Set<(payload: TodoCommentNotificationPayload) => void>;
  quickNoteListeners: Set<(payload: QuickNotesState) => void>;
  realtimeListeners: Set<(payload: SyncRealtimeAppliedPayload) => void>;
  clearAllCaches: () => void;
}

export function createWebHttpContext(): WebHttpContext {
  let session: StoredWebSession | null = readStoredWebSession();
  let realtimeEnabled = true;

  const cardsById = new Map<string, TodoCard>();
  const commentsByCardId = new Map<string, TodoCardComment[]>();
  const quickNotesById = new Map<string, QuickNote>();
  const blobUrlCache = new Map<string, string>();
  const pendingBlobFetches = new Map<string, Promise<string | undefined>>();

  const sessionListeners = new Set<(payload: AccountSessionSnapshot) => void>();
  const stateListeners = new Set<(payload: TodoState) => void>();
  const countListeners = new Set<(payload: TodoCounts) => void>();
  const commentListeners = new Set<(payload: { cardIds: string[] }) => void>();
  const unreadListeners = new Set<(payload: TodoUnreadCommentSummary) => void>();
  const notificationListeners = new Set<(payload: TodoCommentNotificationPayload) => void>();
  const quickNoteListeners = new Set<(payload: QuickNotesState) => void>();
  const realtimeListeners = new Set<(payload: SyncRealtimeAppliedPayload) => void>();

  const resolveWorkspaceId = (s: StoredWebSession | null = session): string =>
    (s?.workspaceId || '').trim() || 'default';

  const requireSession = (): StoredWebSession => {
    if (!session) {
      throw new Error('请先输入服务端地址、账号 ID 与凭据登录同步工作区');
    }
    return session;
  };

  const authHeaders = (active: StoredWebSession, contentType?: string): Record<string, string> => ({
    ...(contentType ? { 'Content-Type': contentType } : {}),
    Authorization: `Bearer ${active.token}`,
    'X-TidyDesk-User': active.userId
  });

  const toSessionSnapshot = (s: StoredWebSession | null): AccountSessionSnapshot => {
    if (!s) {
      return {
        authMode: 'local',
        activeUserId: null,
        displayName: null,
        serverEndpoint:
          typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8787',
        workspaceId: 'default',
        hasToken: false,
        lastSyncCursor: null,
        lastSyncAt: null,
        syncEnabled: false
      };
    }
    return {
      authMode: 'account',
      activeUserId: s.userId,
      displayName: s.displayName || s.userId,
      serverEndpoint: s.serverEndpoint,
      workspaceId: resolveWorkspaceId(s),
      hasToken: Boolean(s.token),
      lastSyncCursor: s.lastSyncCursor ?? null,
      lastSyncAt: s.lastSyncAt ?? null,
      syncEnabled: true
    };
  };

  const buildSyncStatus = (statusMessage: string): SyncStatusSnapshot => ({
    authMode: session ? 'account' : 'local',
    activeUserId: session?.userId ?? null,
    syncEnabled: Boolean(session),
    serverEndpoint: session?.serverEndpoint ?? null,
    workspaceId: resolveWorkspaceId(session),
    pendingCount: 0,
    lastSyncCursor: session?.lastSyncCursor ?? null,
    lastSyncAt: session?.lastSyncAt ?? null,
    realtimeActive: Boolean(session && realtimeEnabled),
    statusMessage
  });

  const recordSyncCursor = (cursor: string) => {
    if (!session) return;
    session.lastSyncCursor = cursor;
    session.lastSyncAt = String(Date.now());
    writeStoredWebSession(session);
  };

  const clearAllCaches = () => {
    for (const url of blobUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    blobUrlCache.clear();
    pendingBlobFetches.clear();
    cardsById.clear();
    commentsByCardId.clear();
    quickNotesById.clear();
  };

  return {
    getSession: () => session,
    setSession: next => {
      session = next;
      writeStoredWebSession(next);
    },
    requireSession,
    resolveWorkspaceId,
    authHeaders,
    toSessionSnapshot,
    buildSyncStatus,
    recordSyncCursor,
    isRealtimeEnabled: () => realtimeEnabled,
    setRealtimeEnabledFlag: enabled => {
      realtimeEnabled = enabled;
    },
    cardsById,
    commentsByCardId,
    quickNotesById,
    blobUrlCache,
    pendingBlobFetches,
    sessionListeners,
    stateListeners,
    countListeners,
    commentListeners,
    unreadListeners,
    notificationListeners,
    quickNoteListeners,
    realtimeListeners,
    clearAllCaches
  };
}
