import type { QuickNote } from '../types/quick-note';
import type { TodoCard, TodoCardComment, TodoState } from '../types/todo';
import type { NativeCapabilities, NativeClient } from './types';
import { createWebAccountsClient } from './web-http-auth';
import { createWebHttpContext } from './web-http-context';
import { createDesktopUnsupportedStubs } from './web-http-helpers';
import { createWebQuickNotesModule } from './web-http-notes';
import { createWebSseController } from './web-http-sse';
import { createWebTodosModule, type WebTodosModule } from './web-http-todos';
import { createHttpStatusError, isTransientSyncError } from './web-offline-store';

const MOBILE_WEB_CAPABILITIES: NativeCapabilities = {
  canScreenSnip: false,
  canUseNativeFileDialog: false,
  canUseGlobalHotkeys: false,
  platformLayout: 'mobile'
};

/**
 * Web/Mobile HTTP adapter composition entrypoint speaking `/api/v1` sync endpoints
 * across Todos, QuickNotes, Auth, and SSE realtime updates.
 */
export function createWebHttpNativeClient(): NativeClient {
  const ctx = createWebHttpContext();

  let todosModule: WebTodosModule;
  let notesModule: ReturnType<typeof createWebQuickNotesModule>;
  let sse: ReturnType<typeof createWebSseController> | null = null;

  const expireSessionOnUnauthorized = () => {
    sse?.stop();
    const prevScope = ctx.getCurrentScope();
    const hasPending = ctx.getOutboxEntries().length > 0;
    if (hasPending && prevScope) {
      ctx.persistScopeSnapshot();
      ctx.setDetachedScope(prevScope);
    } else {
      ctx.clearAllCaches();
      todosModule.resetSessionFlags();
      notesModule.clearAndEmitEmpty();
    }
    ctx.setSession(null);
    const snap = ctx.toSessionSnapshot(null);
    for (const cb of ctx.sessionListeners) cb(snap);
  };

  const pullLatestUnlocked = async (options?: { failOnOfflinePull?: boolean }): Promise<TodoState> => {
    const active = ctx.getSession();
    if (!active) {
      if (ctx.getDetachedScope()) {
        const localState = await todosModule.buildLocalState();
        todosModule.emitLocalState(localState);
        notesModule.emitLocalNotes();
        if (options?.failOnOfflinePull) {
          throw new Error(
            `当前处于离线连续模式（待传 ${ctx.getOutboxEntries().length} 条），请重登原账号同步`
          );
        }
        return localState;
      }
      ctx.requireSession();
    }

    const activeSession = ctx.requireSession();
    const wsId = ctx.resolveWorkspaceId(activeSession);

    try {
      const pendingOutbox = ctx.getOutboxEntries();
      if (pendingOutbox.length > 0) {
        const pushRes = await fetch(`${activeSession.serverEndpoint}/api/v1/sync/push`, {
          method: 'POST',
          headers: ctx.authHeaders(activeSession, 'application/json'),
          body: JSON.stringify({
            workspaceId: wsId,
            entries: pendingOutbox.map(entry => ({
              entityKind: entry.entityKind,
              entityId: entry.entityId,
              operation: entry.operation,
              payload: entry.payload
            }))
          })
        });
        if (pushRes.status === 401) {
          expireSessionOnUnauthorized();
          throw createHttpStatusError('登录凭证已失效或被吊销，请重新登录 (401)', 401);
        }
        if (!pushRes.ok) {
          throw createHttpStatusError(`推送离线变更失败 (${pushRes.status})`, pushRes.status);
        }
        const pushed = (await pushRes.json()) as {
          nextCursor?: string;
          acked?: Array<{ entityKind?: string; entityId?: string }>;
        };
        if (Array.isArray(pushed.acked) && pushed.acked.length > 0) {
          ctx.markOutboxEntriesAcked(pushed.acked);
        }
        if (pushed.nextCursor) {
          ctx.recordSyncCursor(pushed.nextCursor);
        }
      }

      const res = await fetch(
        `${activeSession.serverEndpoint}/api/v1/sync/pull?workspaceId=${encodeURIComponent(wsId)}&cursor=0`,
        { headers: ctx.authHeaders(activeSession) }
      );
      if (res.status === 401) {
        expireSessionOnUnauthorized();
        throw createHttpStatusError('登录凭证已失效或被吊销，请重新登录 (401)', 401);
      }
      if (!res.ok) {
        throw createHttpStatusError(`拉取云端数据失败 (${res.status})`, res.status);
      }
      const pulled = (await res.json()) as {
        nextCursor: string;
        cards: TodoCard[];
        removedCardIds: string[];
        cardComments?: TodoCardComment[];
        removedCardCommentIds?: string[];
        quickNotes?: QuickNote[];
        removedQuickNoteIds?: string[];
      };

      ctx.recordSyncCursor(pulled.nextCursor);
      const state = await todosModule.applyPulledSync({
        cards: pulled.cards,
        removedCardIds: pulled.removedCardIds,
        cardComments: pulled.cardComments,
        removedCardCommentIds: pulled.removedCardCommentIds
      });
      notesModule.applyPulledNotes(pulled.quickNotes, pulled.removedQuickNoteIds);
      ctx.persistScopeSnapshot();
      return state;
    } catch (err) {
      if (!options?.failOnOfflinePull && isTransientSyncError(err)) {
        const localState = await todosModule.buildLocalState();
        todosModule.emitLocalState(localState);
        notesModule.emitLocalNotes();
        return localState;
      }
      throw err;
    }
  };

  const pullLatest = (options?: { failOnOfflinePull?: boolean }): Promise<TodoState> =>
    ctx.runSerializedSync(() => pullLatestUnlocked(options));

  todosModule = createWebTodosModule(ctx, pullLatest, expireSessionOnUnauthorized, pullLatestUnlocked);
  notesModule = createWebQuickNotesModule(ctx, pullLatest, expireSessionOnUnauthorized);
  const sseController = createWebSseController(ctx, pullLatest, expireSessionOnUnauthorized);
  sse = sseController;

  const accounts = createWebAccountsClient(ctx, sseController, () => {
    ctx.clearAllCaches();
    todosModule.resetSessionFlags();
    notesModule.clearAndEmitEmpty();
  });

  if (ctx.getSession()) {
    sseController.start();
  }

  return {
    isAvailable: () => Boolean(ctx.getSession() || ctx.getDetachedScope()),
    capabilities: MOBILE_WEB_CAPABILITIES,
    todos: todosModule.client,
    quickNotes: notesModule.client,
    accounts,
    sync: {
      getStatus: async () => {
        const pending = ctx.getOutboxEntries().length;
        if (ctx.getSession()) {
          const base = ctx.isRealtimeEnabled()
            ? '移动端 SSE 实时协同连接已就绪'
            : '移动端已登录（手动同步模式）';
          return ctx.buildSyncStatus(pending > 0 ? `${base} · 待同步 ${pending} 条` : base);
        }
        const detached = ctx.getDetachedScope();
        return ctx.buildSyncStatus(
          detached
            ? `离线连续工作区（${detached.userId}）· 待传 ${pending} 条`
            : '未登录云端工作区'
        );
      },
      clearOutbox: async () => {
        ctx.clearOutboxEntries();
        return ctx.buildSyncStatus('已清空移动端本地待同步队列');
      },
      runOnce: async () => {
        await pullLatest({ failOnOfflinePull: true });
        return ctx.buildSyncStatus('已完成本地队列推送并拉取最新云端协同状态');
      },
      setRealtimeEnabled: async enabled => {
        ctx.setRealtimeEnabledFlag(enabled);
        if (enabled) sse.start();
        else sse.stop();
        return ctx.buildSyncStatus(enabled ? '已开启实时同步推送' : '已暂停实时同步推送');
      },
      onRealtimeApplied: cb => {
        ctx.realtimeListeners.add(cb);
        return () => ctx.realtimeListeners.delete(cb);
      }
    },
    ...createDesktopUnsupportedStubs()
  };
}
