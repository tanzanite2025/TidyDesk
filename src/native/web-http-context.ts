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
import {
  readStoredWebSession,
  resolveDefaultMobileServerEndpoint,
  type StoredWebSession,
  writeStoredWebSession
} from './web-http-helpers';
import {
  clearOfflineWorkspaceState,
  coalesceOutboxEntries,
  type MobileOutboxEntry,
  type MobileWorkspaceScope,
  readDetachedScope,
  readOfflineWorkspaceState,
  removeAckedOutboxEntries,
  writeDetachedScope,
  writeOfflineWorkspaceState
} from './web-offline-store';

export interface WebHttpContext {
  getSession: () => StoredWebSession | null;
  setSession: (next: StoredWebSession | null) => void;
  getDetachedScope: () => MobileWorkspaceScope | null;
  setDetachedScope: (next: MobileWorkspaceScope | null) => void;
  getCurrentScope: () => MobileWorkspaceScope | null;
  requireActiveOrDetachedScope: () => MobileWorkspaceScope;
  requireSession: () => StoredWebSession;
  resolveWorkspaceId: (s?: StoredWebSession | null) => string;
  authHeaders: (active: StoredWebSession, contentType?: string) => Record<string, string>;
  toSessionSnapshot: (s: StoredWebSession | null) => AccountSessionSnapshot;
  buildSyncStatus: (statusMessage: string) => SyncStatusSnapshot;
  recordSyncCursor: (cursor: string) => void;
  isRealtimeEnabled: () => boolean;
  setRealtimeEnabledFlag: (enabled: boolean) => void;
  getOutboxEntries: () => MobileOutboxEntry[];
  enqueueOfflineMutation: (entry: MobileOutboxEntry) => MobileOutboxEntry[];
  markOutboxEntriesAcked: (acked: Array<{ entityKind?: string; entityId?: string }>) => MobileOutboxEntry[];
  clearOutboxEntries: () => void;
  persistScopeSnapshot: () => void;
  hydrateScopeFromOfflineStore: (scope: MobileWorkspaceScope) => void;
  wipeScopeOfflineData: (scope: MobileWorkspaceScope) => void;
  runSerializedSync: <T>(task: () => Promise<T>) => Promise<T>;
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
  let detachedScope: MobileWorkspaceScope | null = session ? null : readDetachedScope();
  if (session && detachedScope) {
    detachedScope = null;
    writeDetachedScope(null);
  }
  let realtimeEnabled = true;
  let outboxEntries: MobileOutboxEntry[] = [];
  let syncChain: Promise<unknown> = Promise.resolve();

  const runSerializedSync = <T>(task: () => Promise<T>): Promise<T> => {
    const next = syncChain.then(task, task);
    syncChain = next.catch(() => undefined);
    return next;
  };

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

  const getCurrentScope = (): MobileWorkspaceScope | null => {
    if (session) {
      return {
        userId: session.userId,
        workspaceId: resolveWorkspaceId(session),
        displayName: session.displayName,
        serverEndpoint: session.serverEndpoint
      };
    }
    return detachedScope;
  };

  const requireActiveOrDetachedScope = (): MobileWorkspaceScope => {
    const scope = getCurrentScope();
    if (!scope) {
      throw new Error('请先输入服务端地址、账号 ID 与凭据登录同步工作区');
    }
    return scope;
  };

  const requireSession = (): StoredWebSession => {
    if (!session) {
      throw new Error('请先输入服务端地址、账号 ID 与凭据登录同步工作区');
    }
    return session;
  };

  const persistScopeSnapshot = () => {
    const scope = getCurrentScope();
    if (!scope) return;
    const commentsObj: Record<string, TodoCardComment[]> = {};
    for (const [cardId, list] of commentsByCardId.entries()) {
      commentsObj[cardId] = list;
    }
    writeOfflineWorkspaceState(scope.userId, scope.workspaceId, {
      updatedAt: String(Date.now()),
      cards: Array.from(cardsById.values()),
      commentsByCardId: commentsObj,
      quickNotes: Array.from(quickNotesById.values()),
      outbox: outboxEntries
    });
  };

  const hydrateScopeFromOfflineStore = (scope: MobileWorkspaceScope) => {
    const cached = readOfflineWorkspaceState(scope.userId, scope.workspaceId);
    cardsById.clear();
    for (const card of cached.cards) {
      if (card?.id) cardsById.set(card.id, card);
    }
    commentsByCardId.clear();
    for (const [cardId, list] of Object.entries(cached.commentsByCardId || {})) {
      if (Array.isArray(list)) commentsByCardId.set(cardId, list);
    }
    quickNotesById.clear();
    for (const note of cached.quickNotes) {
      if (note?.id) quickNotesById.set(note.id, note);
    }
    outboxEntries = cached.outbox;
  };

  const initialScope = getCurrentScope();
  if (initialScope) {
    try {
      hydrateScopeFromOfflineStore(initialScope);
    } catch (err) {
      console.error('[CRITICAL] Failed to hydrate initial mobile offline scope:', err);
    }
  }

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
        displayName: detachedScope?.displayName || null,
        serverEndpoint: detachedScope?.serverEndpoint || resolveDefaultMobileServerEndpoint() || null,
        workspaceId: detachedScope?.workspaceId || 'default',
        hasToken: false,
        lastSyncCursor: null,
        lastSyncAt: null,
        syncEnabled: false,
        detachedUserId: detachedScope?.userId || null,
        detachedWorkspaceId: detachedScope?.workspaceId || null
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
      syncEnabled: true,
      detachedUserId: null,
      detachedWorkspaceId: null
    };
  };

  const buildSyncStatus = (statusMessage: string): SyncStatusSnapshot => ({
    authMode: session ? 'account' : 'local',
    activeUserId: session?.userId ?? null,
    syncEnabled: Boolean(session),
    serverEndpoint: session?.serverEndpoint ?? detachedScope?.serverEndpoint ?? null,
    workspaceId: session ? resolveWorkspaceId(session) : detachedScope?.workspaceId || 'default',
    pendingCount: outboxEntries.length,
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
    outboxEntries = [];
  };

  return {
    getSession: () => session,
    setSession: next => {
      session = next;
      writeStoredWebSession(next);
    },
    getDetachedScope: () => detachedScope,
    setDetachedScope: next => {
      detachedScope = next;
      writeDetachedScope(next);
    },
    getCurrentScope,
    requireActiveOrDetachedScope,
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
    getOutboxEntries: () => [...outboxEntries],
    enqueueOfflineMutation: entry => {
      outboxEntries = coalesceOutboxEntries(outboxEntries, entry);
      persistScopeSnapshot();
      return [...outboxEntries];
    },
    markOutboxEntriesAcked: acked => {
      outboxEntries = removeAckedOutboxEntries(outboxEntries, acked);
      persistScopeSnapshot();
      return [...outboxEntries];
    },
    clearOutboxEntries: () => {
      outboxEntries = [];
      persistScopeSnapshot();
    },
    persistScopeSnapshot,
    hydrateScopeFromOfflineStore,
    wipeScopeOfflineData: scope => {
      clearOfflineWorkspaceState(scope.userId, scope.workspaceId);
    },
    runSerializedSync,
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
