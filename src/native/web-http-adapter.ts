import type { QuickNote } from '../types/quick-note';
import type { TodoCard, TodoState } from '../types/todo';
import type { NativeCapabilities, NativeClient } from './types';
import { createWebAccountsClient } from './web-http-auth';
import { createWebHttpContext } from './web-http-context';
import { createDesktopUnsupportedStubs } from './web-http-helpers';
import { createWebQuickNotesModule } from './web-http-notes';
import { createWebSseController } from './web-http-sse';
import { createWebTodosModule } from './web-http-todos';

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

  let todosModule: ReturnType<typeof createWebTodosModule>;
  let notesModule: ReturnType<typeof createWebQuickNotesModule>;

  const pullLatest = async (): Promise<TodoState> => {
    const active = ctx.requireSession();
    const wsId = ctx.resolveWorkspaceId(active);
    const res = await fetch(
      `${active.serverEndpoint}/api/v1/sync/pull?workspaceId=${encodeURIComponent(wsId)}&cursor=0`,
      { headers: ctx.authHeaders(active) }
    );
    if (!res.ok) {
      throw new Error(`拉取云端数据失败 (${res.status})`);
    }
    const pulled = (await res.json()) as {
      nextCursor: string;
      cards: TodoCard[];
      removedCardIds: string[];
      quickNotes?: QuickNote[];
      removedQuickNoteIds?: string[];
    };

    ctx.recordSyncCursor(pulled.nextCursor);
    const state = await todosModule.applyPulledCards(pulled.cards, pulled.removedCardIds);
    notesModule.applyPulledNotes(pulled.quickNotes, pulled.removedQuickNoteIds);
    return state;
  };

  todosModule = createWebTodosModule(ctx, pullLatest);
  notesModule = createWebQuickNotesModule(ctx, pullLatest);
  const sse = createWebSseController(ctx, pullLatest);

  const accounts = createWebAccountsClient(ctx, sse, () => {
    ctx.clearAllCaches();
    notesModule.clearAndEmitEmpty();
  });

  if (ctx.getSession()) {
    sse.start();
  }

  return {
    isAvailable: () => Boolean(ctx.getSession()),
    capabilities: MOBILE_WEB_CAPABILITIES,
    todos: todosModule.client,
    quickNotes: notesModule.client,
    accounts,
    sync: {
      getStatus: async () =>
        ctx.buildSyncStatus(
          ctx.getSession()
            ? ctx.isRealtimeEnabled()
              ? '移动端 SSE 实时协同连接已就绪'
              : '移动端已登录（手动同步模式）'
            : '未登录云端工作区'
        ),
      clearOutbox: async () => {
        throw new Error('本地 Outbox 管理 仅在 Windows 桌面端可用');
      },
      runOnce: async () => {
        await pullLatest();
        return ctx.buildSyncStatus('已拉取最新云端协同状态');
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
