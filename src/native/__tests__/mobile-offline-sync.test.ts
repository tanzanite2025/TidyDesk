import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebHttpNativeClient } from '../web-http-adapter';

describe('mobile offline continuous workspace & outbox sync', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;
  const originalSessionStorage = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
    (globalThis as { localStorage?: Storage }).localStorage = originalLocalStorage;
    (globalThis as { sessionStorage?: Storage }).sessionStorage = originalSessionStorage;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function installTestEnv() {
    const lsMap = new Map<string, string>();
    const ssMap = new Map<string, string>();
    const makeStorage = (m: Map<string, string>): Storage => ({
      get length() {
        return m.size;
      },
      clear: () => m.clear(),
      getItem: k => m.get(k) ?? null,
      key: i => Array.from(m.keys())[i] ?? null,
      removeItem: k => {
        m.delete(k);
      },
      setItem: (k, v) => {
        m.set(k, String(v));
      }
    });
    (globalThis as { localStorage?: Storage }).localStorage = makeStorage(lsMap);
    (globalThis as { sessionStorage?: Storage }).sessionStorage = makeStorage(ssMap);
    (globalThis as { window?: unknown }).window = {
      __TIDYDESK_MOBILE__: true,
      location: { protocol: 'https:', hostname: 'localhost', origin: 'https://localhost' }
    };
  }

  it('queues edits during offline/detached continuity and flushes outbox before pull on re-login', async () => {
    installTestEnv();

    let serverCards: Array<Record<string, unknown>> = [
      {
        id: 'card-server-1',
        boardId: 'default-board',
        columnId: 'todo',
        title: '服务端既有任务',
        priority: 'normal',
        content: '',
        tags: [],
        archived: false,
        subtasks: [],
        attachments: [],
        coverAttachmentId: null,
        position: '000G',
        revision: 1,
        updatedAt: '100',
        createdAt: '100',
        deletedAt: null
      }
    ];
    let serverNotes: Array<Record<string, unknown>> = [];
    const pushedPayloads: Array<unknown> = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/verify')) {
        return new Response(JSON.stringify({ ok: true, displayName: 'Alice' }), { status: 200 });
      }
      if (url.endsWith('/api/v1/auth/logout')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes('/api/v1/sync/events')) {
        return new Response('', { status: 200 });
      }
      if (url.includes('/api/v1/sync/pull')) {
        return new Response(
          JSON.stringify({
            nextCursor: '10',
            cards: serverCards,
            removedCardIds: [],
            cardComments: [],
            removedCardCommentIds: [],
            quickNotes: serverNotes,
            removedQuickNoteIds: []
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/v1/sync/push')) {
        const body = JSON.parse(String(init?.body || '{}')) as {
          entries: Array<{
            entityKind: string;
            entityId: string;
            operation: string;
            payload: Record<string, unknown>;
          }>;
        };
        pushedPayloads.push(body);
        const acked: Array<{ entityKind: string; entityId: string }> = [];
        const mergedCards: Array<Record<string, unknown>> = [];
        for (const entry of body.entries || []) {
          acked.push({ entityKind: entry.entityKind, entityId: entry.entityId });
          if (entry.entityKind === 'card' && entry.operation === 'upsert') {
            const merged = { ...entry.payload, revision: 2 };
            serverCards = [...serverCards.filter(c => c.id !== entry.entityId), merged];
            mergedCards.push(merged);
          } else if (entry.entityKind === 'quickNote' && entry.operation === 'upsert') {
            serverNotes = [...serverNotes.filter(n => n.id !== entry.entityId), entry.payload];
          }
        }
        return new Response(
          JSON.stringify({ nextCursor: '11', acked, mergedCards }),
          { status: 200 }
        );
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const client = createWebHttpNativeClient();
    await client.accounts.switchSession({
      userId: 'alice',
      serverEndpoint: 'http://192.168.1.10:8787',
      workspaceId: 'private:alice',
      token: 'tok-1'
    });
    const onlineInitial = await client.todos.readState();
    expect(onlineInitial.cards).toHaveLength(1);

    // 1) 退出账号但保留离线连续工作区
    const afterLogout = await client.accounts.logoutToLocal(true);
    expect(afterLogout.authMode).toBe('local');
    expect(afterLogout.detachedUserId).toBe('alice');
    expect(afterLogout.detachedWorkspaceId).toBe('private:alice');
    expect(client.isAvailable()).toBe(true);

    // 2) 退出状态下离线新建卡片、评论与快捷记录，禁止图片二进制上传
    await client.todos.createCard({ title: '手机离线新建待办', columnId: 'doing' });
    await client.quickNotes.createNote({ title: '离线灵感', content: '记得买咖啡' });
    await expect(
      client.todos.addAttachmentBytes({
        cardId: 'card-server-1',
        fileName: 'photo.png',
        bytes: [1, 2, 3]
      })
    ).rejects.toThrow(/暂不支持离线上传/);

    const statusBeforeRestart = await client.sync.getStatus();
    expect(statusBeforeRestart.pendingCount).toBe(2);

    // 3) 模拟 App 冷重启：无 Token 会话但 detached 缓存与 Outbox 完整恢复
    const restarted = createWebHttpNativeClient();
    expect(restarted.isAvailable()).toBe(true);
    const restartedState = await restarted.todos.readState();
    expect(restartedState.cards.map(c => c.title)).toContain('手机离线新建待办');
    expect((await restarted.quickNotes.readState()).notes.map(n => n.title)).toContain('离线灵感');

    // 4) 防串库守卫：存在未传 Outbox 时禁止直接切换其他工作区/账号
    await expect(
      restarted.accounts.switchSession({
        userId: 'alice',
        serverEndpoint: 'http://192.168.1.10:8787',
        workspaceId: 'default',
        token: 'tok-2'
      })
    ).rejects.toThrow(/未同步离线编辑/);

    // 5) 重登原账号原工作区 -> 并发触发 todos.readState & quickNotes.readState 时，Outbox 仅推送一次且不重复/不丢失
    await restarted.accounts.switchSession({
      userId: 'alice',
      serverEndpoint: 'http://192.168.1.10:8787',
      workspaceId: 'private:alice',
      token: 'tok-3'
    });
    const [synced, syncedNotes] = await Promise.all([
      restarted.todos.readState(),
      restarted.quickNotes.readState()
    ]);
    expect(pushedPayloads).toHaveLength(1);
    expect(synced.cards.map(c => c.title)).toEqual(
      expect.arrayContaining(['服务端既有任务', '手机离线新建待办'])
    );
    expect(syncedNotes.notes.map(n => n.title)).toContain('离线灵感');
    expect((await restarted.sync.getStatus()).pendingCount).toBe(0);
  });

  it('queues transient network errors while logged in and fails loudly on 403 without queuing', async () => {
    installTestEnv();

    let mode: 'online' | 'offline' | 'forbidden' = 'online';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/verify')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes('/api/v1/sync/events')) {
        return new Response('', { status: 200 });
      }
      if (url.includes('/api/v1/sync/pull')) {
        if (mode === 'offline') throw new TypeError('Failed to fetch');
        return new Response(
          JSON.stringify({ nextCursor: '1', cards: [], removedCardIds: [], quickNotes: [], removedQuickNoteIds: [] }),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/v1/sync/push')) {
        if (mode === 'offline') throw new TypeError('Failed to fetch');
        if (mode === 'forbidden') return new Response('forbidden', { status: 403 });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const client = createWebHttpNativeClient();
    await client.accounts.switchSession({
      userId: 'bob',
      serverEndpoint: 'http://192.168.1.10:8787',
      workspaceId: 'default',
      token: 'tok-bob'
    });

    // 暂时断网 -> 修改自动入队不报错
    mode = 'offline';
    const offlineAfterCreate = await client.todos.createCard({ title: '地铁断网待办' });
    expect(offlineAfterCreate.cards.map(c => c.title)).toContain('地铁断网待办');
    expect((await client.sync.getStatus()).pendingCount).toBe(1);

    // 403 权限拒绝 -> 必须直接显式报错，绝不入队伪造成功
    mode = 'forbidden';
    await expect(client.todos.createCard({ title: '越权待办' })).rejects.toThrow(/403/);
    expect((await client.sync.getStatus()).pendingCount).toBe(1);

    // 彻底退出清空本地 -> 全部清空且退回未登录
    await client.accounts.logoutToLocal(false);
    expect(client.isAvailable()).toBe(false);
    expect((await client.sync.getStatus()).pendingCount).toBe(0);
  });
});
