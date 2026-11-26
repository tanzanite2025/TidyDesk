import type { QuickNote } from '../types/quick-note';
import type { TodoCard, TodoCardComment } from '../types/todo';

export const WEB_DETACHED_SCOPE_KEY = 'tidydesk_mobile_detached_scope_v1';
const WEB_OFFLINE_STATE_PREFIX = 'tidydesk_mobile_offline_state_v1:';
export const MAX_MOBILE_OUTBOX_ENTRIES = 500;

export interface MobileWorkspaceScope {
  userId: string;
  workspaceId: string;
  displayName?: string;
  serverEndpoint?: string;
}

export type MobileOutboxEntityKind = 'card' | 'quickNote' | 'cardComment';

export interface MobileOutboxEntry {
  entityKind: MobileOutboxEntityKind;
  entityId: string;
  operation: 'upsert' | 'delete';
  payload: Record<string, unknown>;
  updatedAt: string;
}

export interface MobileOfflineWorkspaceState {
  updatedAt: string;
  cards: TodoCard[];
  commentsByCardId: Record<string, TodoCardComment[]>;
  quickNotes: QuickNote[];
  outbox: MobileOutboxEntry[];
}

function emptyOfflineState(): MobileOfflineWorkspaceState {
  return {
    updatedAt: String(Date.now()),
    cards: [],
    commentsByCardId: {},
    quickNotes: [],
    outbox: []
  };
}

export function normalizeScopeWorkspaceId(workspaceId?: string | null): string {
  return (workspaceId || '').trim() || 'default';
}

export function makeScopeStorageKey(userId: string, workspaceId?: string | null): string {
  const cleanUser = userId.trim();
  const cleanWs = normalizeScopeWorkspaceId(workspaceId);
  if (!cleanUser) {
    throw new Error('[CRITICAL] Cannot resolve offline storage scope without userId');
  }
  return `${WEB_OFFLINE_STATE_PREFIX}${cleanUser}:${cleanWs}`;
}

export function isSameWorkspaceScope(
  left: Pick<MobileWorkspaceScope, 'userId' | 'workspaceId'> | null | undefined,
  right: Pick<MobileWorkspaceScope, 'userId' | 'workspaceId'> | null | undefined
): boolean {
  if (!left || !right) return false;
  return (
    left.userId.trim() === right.userId.trim() &&
    normalizeScopeWorkspaceId(left.workspaceId) === normalizeScopeWorkspaceId(right.workspaceId)
  );
}

export function readDetachedScope(): MobileWorkspaceScope | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(WEB_DETACHED_SCOPE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MobileWorkspaceScope>;
    if (!parsed || typeof parsed.userId !== 'string' || !parsed.userId.trim()) {
      return null;
    }
    return {
      userId: parsed.userId.trim(),
      workspaceId: normalizeScopeWorkspaceId(parsed.workspaceId),
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : undefined,
      serverEndpoint: typeof parsed.serverEndpoint === 'string' ? parsed.serverEndpoint : undefined
    };
  } catch (err) {
    console.error('[CRITICAL] Failed to parse mobile detached scope:', err);
    return null;
  }
}

export function writeDetachedScope(scope: MobileWorkspaceScope | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (!scope) {
      localStorage.removeItem(WEB_DETACHED_SCOPE_KEY);
      return;
    }
    localStorage.setItem(
      WEB_DETACHED_SCOPE_KEY,
      JSON.stringify({
        userId: scope.userId.trim(),
        workspaceId: normalizeScopeWorkspaceId(scope.workspaceId),
        displayName: scope.displayName,
        serverEndpoint: scope.serverEndpoint
      })
    );
  } catch (err) {
    throw new Error(
      `保存移动端离线连续工作区状态失败: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function stripEphemeralMediaUrls(card: TodoCard): TodoCard {
  return {
    ...card,
    attachments: (card.attachments || []).map(({ thumbUrl: _t, assetUrl: _a, ...rest }) => rest),
    previewAttachments: undefined,
    subtasks: (card.subtasks || []).map(sub => ({
      ...sub,
      attachments: (sub.attachments || []).map(({ thumbUrl: _t, assetUrl: _a, ...rest }) => rest)
    }))
  };
}

export function readOfflineWorkspaceState(
  userId: string,
  workspaceId?: string | null
): MobileOfflineWorkspaceState {
  if (typeof localStorage === 'undefined') return emptyOfflineState();
  const key = makeScopeStorageKey(userId, workspaceId);
  const raw = localStorage.getItem(key);
  if (!raw) return emptyOfflineState();
  try {
    const parsed = JSON.parse(raw) as Partial<MobileOfflineWorkspaceState>;
    return {
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : String(Date.now()),
      cards: Array.isArray(parsed.cards) ? parsed.cards : [],
      commentsByCardId:
        parsed.commentsByCardId && typeof parsed.commentsByCardId === 'object'
          ? parsed.commentsByCardId
          : {},
      quickNotes: Array.isArray(parsed.quickNotes) ? parsed.quickNotes : [],
      outbox: Array.isArray(parsed.outbox) ? parsed.outbox : []
    };
  } catch (err) {
    console.error(`[CRITICAL] Corrupt mobile offline state at ${key}:`, err);
    throw new Error('移动端本地离线缓存损坏，请重登后刷新或彻底清空本地缓存');
  }
}

export function writeOfflineWorkspaceState(
  userId: string,
  workspaceId: string,
  state: MobileOfflineWorkspaceState
): void {
  if (typeof localStorage === 'undefined') return;
  const key = makeScopeStorageKey(userId, workspaceId);
  const sanitized: MobileOfflineWorkspaceState = {
    updatedAt: state.updatedAt || String(Date.now()),
    cards: state.cards.map(stripEphemeralMediaUrls),
    commentsByCardId: state.commentsByCardId,
    quickNotes: state.quickNotes,
    outbox: state.outbox
  };
  try {
    localStorage.setItem(key, JSON.stringify(sanitized));
  } catch (err) {
    throw new Error(
      `保存本地离线数据失败（存储空间不足或受限）: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export function clearOfflineWorkspaceState(userId: string, workspaceId?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  const key = makeScopeStorageKey(userId, workspaceId);
  localStorage.removeItem(key);
}

export function coalesceOutboxEntries(
  existing: MobileOutboxEntry[],
  incoming: MobileOutboxEntry
): MobileOutboxEntry[] {
  const idx = existing.findIndex(
    item => item.entityKind === incoming.entityKind && item.entityId === incoming.entityId
  );
  if (idx >= 0) {
    const next = [...existing];
    next[idx] = incoming;
    return next;
  }
  if (existing.length >= MAX_MOBILE_OUTBOX_ENTRIES) {
    throw new Error(
      `[CRITICAL] 本地离线待同步队列已达上限 (${MAX_MOBILE_OUTBOX_ENTRIES} 条)，请联网登录后同步`
    );
  }
  return [...existing, incoming];
}

export function removeAckedOutboxEntries(
  existing: MobileOutboxEntry[],
  acked: Array<{ entityKind?: string; entityId?: string }>
): MobileOutboxEntry[] {
  if (!acked || acked.length === 0) return existing;
  const ackedSet = new Set(acked.map(a => `${a.entityKind || ''}:${a.entityId || ''}`));
  return existing.filter(item => !ackedSet.has(`${item.entityKind}:${item.entityId}`));
}

export function isTransientSyncError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') {
      return status >= 500 || status === 408 || status === 429;
    }
  }
  if (err instanceof TypeError) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network request failed') ||
      msg.includes('load failed') ||
      msg.includes('err_internet_disconnected') ||
      msg.includes('err_connection') ||
      msg.includes('timed out')
    );
  }
  return false;
}

export function createHttpStatusError(message: string, status: number): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

export function assertCanSwitchTargetScope(params: {
  currentScope: MobileWorkspaceScope | null;
  targetScope: Pick<MobileWorkspaceScope, 'userId' | 'workspaceId'>;
  pendingOutboxCount: number;
}): void {
  const { currentScope, targetScope, pendingOutboxCount } = params;
  if (!currentScope || pendingOutboxCount <= 0) return;
  if (isSameWorkspaceScope(currentScope, targetScope)) return;
  throw new Error(
    `本地仍有 ${pendingOutboxCount} 条「${currentScope.userId} / ${normalizeScopeWorkspaceId(
      currentScope.workspaceId
    )}」的未同步离线编辑；请先重登原账号同步，或彻底清空本地离线数据后再切换账号或工作区。`
  );
}
