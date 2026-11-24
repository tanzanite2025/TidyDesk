import type {
  AccountSessionSnapshot,
  AddTodoAttachmentBytesInput,
  CreateTodoCardInput,
  DeleteTodoAttachmentInput,
  MoveTodoCardInput,
  RemoteAuthSessionInfo,
  RemoteWorkspaceInfo,
  SetTodoCardCoverInput,
  SyncStatusSnapshot,
  TodoAttachment,
  TodoCard,
  TodoCounts,
  TodoState,
  TodoSubtask,
  UpdateTodoAttachmentMetaInput,
  UpdateTodoCardInput
} from '../types/todo';
import type { NativeCapabilities, NativeClient, SyncRealtimeAppliedPayload } from './types';
import {
  compareCardsByPosition,
  computePositionForColumn,
  computeSha256Hex,
  computeTodoCounts,
  createDesktopUnsupportedStubs,
  createThumbAndDimensions,
  createUuid,
  DEFAULT_MOBILE_BOARD,
  findFallbackCoverId,
  parseSseSyncCursor,
  readStoredWebSession,
  summarizeMarkdown,
  writeStoredWebSession,
  type StoredWebSession
} from './web-http-helpers';

const MOBILE_WEB_CAPABILITIES: NativeCapabilities = {
  canScreenSnip: false,
  canUseNativeFileDialog: false,
  canUseGlobalHotkeys: false,
  platformLayout: 'mobile'
};

/**
 * Web/Mobile HTTP adapter speaking directly to the TidyDesk Sync Server (`/api/v1`)
 * so mobile browsers share the same `TodoContext`, media pipeline, and SSE push loop.
 */
export function createWebHttpNativeClient(): NativeClient {
  let session: StoredWebSession | null = readStoredWebSession();
  const cardsById = new Map<string, TodoCard>();
  const blobUrlCache = new Map<string, string>();
  const pendingBlobFetches = new Map<string, Promise<string | undefined>>();

  const sessionListeners = new Set<(payload: AccountSessionSnapshot) => void>();
  const stateListeners = new Set<(payload: TodoState) => void>();
  const countListeners = new Set<(payload: TodoCounts) => void>();
  const realtimeListeners = new Set<(payload: SyncRealtimeAppliedPayload) => void>();

  let realtimeAbort: AbortController | null = null;
  let realtimeEnabled = true;
  let realtimeGeneration = 0;
  let visibilityCleanup: (() => void) | null = null;
  let wakeupReconnect: (() => void) | null = null;

  function resolveWorkspaceId(s: StoredWebSession | null): string {
    return (s?.workspaceId || '').trim() || 'default';
  }

  function toSessionSnapshot(s: StoredWebSession | null): AccountSessionSnapshot {
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
  }

  function buildSyncStatus(statusMessage: string): SyncStatusSnapshot {
    return {
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
    };
  }

  function requireSession(): StoredWebSession {
    if (!session) {
      throw new Error('请先输入服务端地址、账号 ID 与凭据登录同步工作区');
    }
    return session;
  }

  function authHeaders(active: StoredWebSession, contentType?: string): Record<string, string> {
    return {
      ...(contentType ? { 'Content-Type': contentType } : {}),
      Authorization: `Bearer ${active.token}`,
      'X-TidyDesk-User': active.userId
    };
  }

  function clearBlobCache() {
    for (const url of blobUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    blobUrlCache.clear();
    pendingBlobFetches.clear();
  }

  async function resolveAuthorizedBlobUrl(
    kind: 'thumb' | 'original',
    key?: string
  ): Promise<string | undefined> {
    if (!key || !session) return undefined;
    const cacheKey = `${session.userId}:${kind}:${key}`;
    const cached = blobUrlCache.get(cacheKey);
    if (cached) return cached;

    const existingPromise = pendingBlobFetches.get(cacheKey);
    if (existingPromise) return existingPromise;

    const currentSession = session;
    const promise = (async () => {
      try {
        const res = await fetch(
          `${currentSession.serverEndpoint}/api/v1/media/blob/${kind}/${encodeURIComponent(key)}`,
          { headers: authHeaders(currentSession) }
        );
        if (!res.ok) return undefined;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        blobUrlCache.set(cacheKey, url);
        return url;
      } catch {
        return undefined;
      } finally {
        pendingBlobFetches.delete(cacheKey);
      }
    })();

    pendingBlobFetches.set(cacheKey, promise);
    return promise;
  }

  async function hydrateAttachmentUrls(
    att: TodoAttachment,
    includeOriginals: boolean
  ): Promise<TodoAttachment> {
    const thumbKey = att.remoteThumbKey;
    const origKey = att.remoteOriginalKey;
    const thumbPromise = thumbKey
      ? resolveAuthorizedBlobUrl('thumb', thumbKey)
      : includeOriginals || !origKey
        ? Promise.resolve(undefined)
        : resolveAuthorizedBlobUrl('original', origKey);
    const origPromise =
      includeOriginals && origKey
        ? resolveAuthorizedBlobUrl('original', origKey)
        : Promise.resolve(undefined);

    const [thumbUrl, assetUrl] = await Promise.all([thumbPromise, origPromise]);
    return {
      ...att,
      thumbUrl: thumbUrl || att.thumbUrl || assetUrl,
      assetUrl: includeOriginals ? assetUrl || att.assetUrl || thumbUrl : att.assetUrl
    };
  }

  async function enrichSummaryCard(raw: TodoCard, includeOriginals = false): Promise<TodoCard> {
    const activeSubtasks = (raw.subtasks || []).filter(sub => !sub.deletedAt);
    const enrichedSubs = await Promise.all(
      activeSubtasks.map(async sub => ({
        ...sub,
        attachments: await Promise.all(
          (sub.attachments || []).map(att => hydrateAttachmentUrls(att, includeOriginals))
        )
      }))
    );
    const cardAtts = await Promise.all(
      (raw.attachments || []).map(att => hydrateAttachmentUrls(att, includeOriginals))
    );
    const allAtts = [...cardAtts, ...enrichedSubs.flatMap(s => s.attachments || [])];

    const previews: TodoAttachment[] = [];
    if (raw.coverAttachmentId) {
      const cover = allAtts.find(a => a.id === raw.coverAttachmentId);
      if (cover) previews.push(cover);
    }
    for (const att of allAtts) {
      if (previews.length >= 2) break;
      if (!previews.some(p => p.id === att.id)) previews.push(att);
    }

    return {
      ...raw,
      boardId: DEFAULT_MOBILE_BOARD.id,
      summaryText: summarizeMarkdown(raw.content || ''),
      subtasks: enrichedSubs,
      subtaskTotal: enrichedSubs.length,
      subtaskCompleted: enrichedSubs.filter(s => s.completed).length,
      attachments: cardAtts,
      previewAttachments: previews,
      attachmentCount: allAtts.length,
      extraAttachmentCount: Math.max(0, allAtts.length - previews.length)
    };
  }

  async function buildTodoStateSnapshot(): Promise<TodoState> {
    const all = Array.from(cardsById.values()).filter(c => !c.deletedAt);
    const enriched = await Promise.all(all.map(card => enrichSummaryCard(card, false)));
    const cardOrder: Record<string, string[]> = { todo: [], doing: [], done: [] };
    for (const col of DEFAULT_MOBILE_BOARD.columns) {
      cardOrder[col.id] = enriched
        .filter(c => c.columnId === col.id)
        .sort(compareCardsByPosition)
        .map(c => c.id);
    }
    return {
      activeBoardId: DEFAULT_MOBILE_BOARD.id,
      boards: [{ ...DEFAULT_MOBILE_BOARD, cardOrder }],
      cards: enriched,
      counts: computeTodoCounts(enriched)
    };
  }

  function emitState(state: TodoState) {
    for (const cb of countListeners) cb(state.counts);
    for (const cb of stateListeners) cb(state);
  }

  async function pullLatest(): Promise<TodoState> {
    const active = requireSession();
    const wsId = resolveWorkspaceId(active);
    const res = await fetch(
      `${active.serverEndpoint}/api/v1/sync/pull?workspaceId=${encodeURIComponent(wsId)}&cursor=0`,
      { headers: authHeaders(active) }
    );
    if (!res.ok) {
      throw new Error(`拉取云端数据失败 (${res.status})`);
    }
    const pulled = (await res.json()) as {
      nextCursor: string;
      cards: TodoCard[];
      removedCardIds: string[];
    };

    cardsById.clear();
    for (const card of pulled.cards || []) {
      cardsById.set(card.id, card);
    }
    for (const rid of pulled.removedCardIds || []) {
      cardsById.delete(rid);
    }

    active.lastSyncCursor = pulled.nextCursor;
    active.lastSyncAt = String(Date.now());
    writeStoredWebSession(active);

    const state = await buildTodoStateSnapshot();
    emitState(state);
    return state;
  }

  async function pushCardMutation(
    card: TodoCard,
    operation: 'upsert' | 'delete' = 'upsert'
  ): Promise<TodoState> {
    const active = requireSession();
    const res = await fetch(`${active.serverEndpoint}/api/v1/sync/push`, {
      method: 'POST',
      headers: authHeaders(active, 'application/json'),
      body: JSON.stringify({
        workspaceId: resolveWorkspaceId(active),
        entries: [
          {
            entityKind: 'card',
            entityId: card.id,
            operation,
            payload: {
              ...card,
              baseRevision: card.revision ?? 0
            }
          }
        ]
      })
    });
    if (!res.ok) {
      throw new Error(`提交云端变更失败 (${res.status})`);
    }
    const pushed = (await res.json()) as {
      nextCursor?: string;
      mergedCards?: TodoCard[];
    };
    if (pushed.nextCursor) {
      active.lastSyncCursor = pushed.nextCursor;
      active.lastSyncAt = String(Date.now());
      writeStoredWebSession(active);
    }
    if (operation === 'delete') {
      cardsById.delete(card.id);
    } else if (pushed.mergedCards && pushed.mergedCards[0]) {
      cardsById.set(card.id, pushed.mergedCards[0]);
    } else {
      cardsById.set(card.id, card);
    }
    const state = await buildTodoStateSnapshot();
    emitState(state);
    return state;
  }

  function stopSseLoop() {
    realtimeGeneration += 1;
    if (realtimeAbort) {
      realtimeAbort.abort();
      realtimeAbort = null;
    }
    if (wakeupReconnect) {
      wakeupReconnect();
      wakeupReconnect = null;
    }
    if (visibilityCleanup) {
      visibilityCleanup();
      visibilityCleanup = null;
    }
  }

  function startSseLoop() {
    stopSseLoop();
    if (!session || !realtimeEnabled) return;
    const myGen = realtimeGeneration;

    if (typeof document !== 'undefined') {
      const handleVisibility = () => {
        if (
          document.visibilityState === 'visible' &&
          session &&
          realtimeEnabled &&
          realtimeGeneration === myGen
        ) {
          void pullLatest().catch(err =>
            console.warn('[TIDYDESK][MOBILE] Foreground catch-up pull error:', err)
          );
          wakeupReconnect?.();
        }
      };
      document.addEventListener('visibilitychange', handleVisibility);
      visibilityCleanup = () => document.removeEventListener('visibilitychange', handleVisibility);
    }

    const backoffMsList = [2000, 4000, 8000, 15000, 30000];
    void (async () => {
      let attempt = 0;
      while (session && realtimeEnabled && realtimeGeneration === myGen) {
        const active = session;
        const controller = new AbortController();
        realtimeAbort = controller;
        try {
          const wsId = resolveWorkspaceId(active);
          const res = await fetch(
            `${active.serverEndpoint}/api/v1/sync/events?workspaceId=${encodeURIComponent(wsId)}`,
            { headers: authHeaders(active), signal: controller.signal }
          );
          if (res.ok && res.body) {
            attempt = 0;
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (!controller.signal.aborted && realtimeGeneration === myGen) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const frames = buffer.split(/\r?\n\r?\n/);
              buffer = frames.pop() || '';
              for (const frame of frames) {
                if (!frame.includes('event: sync-changed')) continue;
                const remoteCursor = parseSseSyncCursor(frame);
                if (remoteCursor && session?.lastSyncCursor === remoteCursor) {
                  continue;
                }
                await pullLatest()
                  .then(nextState => {
                    for (const cb of realtimeListeners) {
                      cb({
                        pulledCards: nextState.cards.length,
                        pulledNotes: 0,
                        cursor: session?.lastSyncCursor || ''
                      });
                    }
                  })
                  .catch(err =>
                    console.warn('[TIDYDESK][MOBILE] Realtime pull error:', err)
                  );
              }
            }
          } else if (!controller.signal.aborted) {
            console.warn(`[TIDYDESK][MOBILE] SSE endpoint returned status ${res.status}`);
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            console.warn('[TIDYDESK][MOBILE] SSE disconnected:', err);
          }
        }

        if (!session || !realtimeEnabled || realtimeGeneration !== myGen) {
          break;
        }
        const delayMs = backoffMsList[Math.min(attempt, backoffMsList.length - 1)];
        attempt += 1;
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => {
            wakeupReconnect = null;
            resolve();
          }, delayMs);
          wakeupReconnect = () => {
            clearTimeout(timer);
            wakeupReconnect = null;
            resolve();
          };
        });
      }
    })();
  }

  async function verifyAndActivateSession(params: {
    userId: string;
    displayName?: string;
    endpoint: string;
    workspaceId: string;
    token: string;
  }): Promise<AccountSessionSnapshot> {
    const verifyRes = await fetch(`${params.endpoint}/api/v1/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.token}`,
        'X-TidyDesk-User': params.userId
      },
      body: JSON.stringify({ userId: params.userId, workspaceId: params.workspaceId })
    });
    if (!verifyRes.ok) {
      const msg = await verifyRes.text().catch(() => '');
      const err = new Error(`工作区鉴权验证失败 (${verifyRes.status}): ${msg}`) as Error & {
        status?: number;
      };
      err.status = verifyRes.status;
      throw err;
    }
    const verified = (await verifyRes.json().catch(() => ({}))) as { displayName?: string };
    const sameActiveUser = Boolean(session && session.userId === params.userId);
    clearBlobCache();
    cardsById.clear();
    session = {
      userId: params.userId,
      displayName:
        params.displayName?.trim() ||
        (sameActiveUser ? session?.displayName : undefined) ||
        verified.displayName ||
        params.userId,
      serverEndpoint: params.endpoint,
      workspaceId: params.workspaceId,
      token: params.token
    };
    writeStoredWebSession(session);
    const snap = toSessionSnapshot(session);
    for (const cb of sessionListeners) cb(snap);
    startSseLoop();
    return snap;
  }

  if (session) {
    startSseLoop();
  }

  return {
    isAvailable: () => Boolean(session),
    capabilities: MOBILE_WEB_CAPABILITIES,
    todos: {
      readState: () => pullLatest(),
      getCounts: async () => computeTodoCounts(Array.from(cardsById.values())),
      createCard: async (payload: CreateTodoCardInput) => {
        const active = requireSession();
        const now = String(Date.now());
        const existing = Array.from(cardsById.values());
        const colId = payload.columnId || 'todo';
        const card: TodoCard = {
          id: createUuid(),
          boardId: DEFAULT_MOBILE_BOARD.id,
          columnId: colId,
          title: (payload.title || '').trim() || '新待办',
          content: payload.content || '',
          tags: [],
          archived: false,
          subtasks: (payload.subtasks || []).map((s, idx) => ({
            id: s.id || createUuid(),
            title: s.title,
            completed: Boolean(s.completed),
            position: s.position || String(idx).padStart(4, '0'),
            attachments: [],
            createdAt: s.createdAt || now,
            updatedAt: s.updatedAt || now
          })),
          attachments: [],
          coverAttachmentId: null,
          position: computePositionForColumn(existing, colId),
          revision: 0,
          updatedBy: active.userId,
          deletedAt: null,
          createdAt: now,
          updatedAt: now
        };
        return pushCardMutation(card, 'upsert');
      },
      updateCard: async (payload: UpdateTodoCardInput) => {
        const existing = cardsById.get(payload.id);
        if (!existing) throw new Error('Todo card not found');
        const now = String(Date.now());
        const existingSubs = existing.subtasks || [];
        let nextSubs: TodoSubtask[] | undefined;
        if (payload.subtasks) {
          const retainedIds = new Set<string>();
          nextSubs = payload.subtasks.map((s, idx) => {
            const id = s.id || createUuid();
            retainedIds.add(id);
            const matched = existingSubs.find(e => e.id === id);
            return {
              id,
              title: s.title,
              completed: Boolean(s.completed),
              position: s.position || String(idx).padStart(4, '0'),
              attachments: matched?.attachments || [],
              createdAt: s.createdAt || matched?.createdAt || now,
              updatedAt: now,
              deletedAt: null
            };
          });
          for (const prevSub of existingSubs) {
            if (!retainedIds.has(prevSub.id)) {
              nextSubs.push({
                ...prevSub,
                deletedAt: prevSub.deletedAt || now,
                updatedAt: now,
                attachments: []
              });
            }
          }
        }

        const updated: TodoCard = {
          ...existing,
          title: payload.title !== undefined ? payload.title.trim() || '未命名待办' : existing.title,
          content: payload.content !== undefined ? payload.content : existing.content,
          columnId: payload.columnId ?? existing.columnId,
          tags: payload.tags ?? existing.tags,
          archived: payload.archived ?? existing.archived,
          subtasks: nextSubs ?? existing.subtasks,
          updatedAt: now
        };
        return pushCardMutation(updated, 'upsert');
      },
      deleteCard: async (cardId: string) => {
        const existing = cardsById.get(cardId);
        if (!existing) return buildTodoStateSnapshot();
        return pushCardMutation({ ...existing, deletedAt: String(Date.now()) }, 'delete');
      },
      moveCard: async (payload: MoveTodoCardInput) => {
        const existing = cardsById.get(payload.id);
        if (!existing) throw new Error('Todo card not found');
        const pos = computePositionForColumn(
          Array.from(cardsById.values()),
          payload.columnId,
          payload.beforeId
        );
        return pushCardMutation(
          { ...existing, columnId: payload.columnId, position: pos, updatedAt: String(Date.now()) },
          'upsert'
        );
      },
      getCardDetail: async (cardId: string) => {
        const card = cardsById.get(cardId);
        if (!card) throw new Error('Todo card not found');
        return enrichSummaryCard(card, true);
      },
      addAttachmentBytes: async (payload: AddTodoAttachmentBytesInput) => {
        const active = requireSession();
        const existing = cardsById.get(payload.cardId);
        if (!existing) throw new Error('Todo card not found');
        const rawBytes = new Uint8Array(payload.bytes);
        const ext = payload.fileName.toLowerCase();
        const mimeType = ext.endsWith('.jpg') || ext.endsWith('.jpeg')
          ? 'image/jpeg'
          : ext.endsWith('.webp')
            ? 'image/webp'
            : 'image/png';
        const [sha256, dims] = await Promise.all([
          computeSha256Hex(rawBytes),
          createThumbAndDimensions(rawBytes, mimeType)
        ]);

        const presignRes = await fetch(`${active.serverEndpoint}/api/v1/media/presign`, {
          method: 'POST',
          headers: authHeaders(active, 'application/json'),
          body: JSON.stringify({ sha256, mimeType })
        });
        if (!presignRes.ok) throw new Error(`媒体上传预检失败 (${presignRes.status})`);
        const presigned = (await presignRes.json()) as {
          deduplicated: boolean;
          thumbKey: string;
          originalKey: string;
          thumbUploadPath: string;
          originalUploadPath: string;
        };

        if (!presigned.deduplicated) {
          const uploadPart = async (pathOrUrl: string, bodyBytes: Uint8Array) => {
            const up = await fetch(`${active.serverEndpoint}${pathOrUrl}`, {
              method: 'PUT',
              headers: {
                ...authHeaders(active),
                'x-tidydesk-sha256': sha256
              },
              body: bodyBytes.buffer.slice(
                bodyBytes.byteOffset,
                bodyBytes.byteOffset + bodyBytes.byteLength
              ) as ArrayBuffer
            });
            if (!up.ok) throw new Error(`上传媒体文件失败 (${up.status})`);
          };
          await uploadPart(presigned.thumbUploadPath, dims.thumbBytes);
          await uploadPart(presigned.originalUploadPath, rawBytes);
        }

        const now = String(Date.now());
        const orientation =
          dims.height > dims.width ? 'portrait' : dims.width > dims.height ? 'landscape' : 'square';
        const att: TodoAttachment = {
          id: createUuid(),
          kind: 'image',
          originalName: payload.fileName,
          fileName: presigned.originalKey,
          thumbFileName: presigned.thumbKey,
          width: dims.width,
          height: dims.height,
          aspectRatio: Number((dims.width / dims.height).toFixed(4)),
          orientation,
          focalPoint: orientation === 'portrait' ? { x: 0.5, y: 0.36 } : { x: 0.5, y: 0.5 },
          previewMode: 'cover',
          sha256,
          syncState: 'synced',
          remoteThumbKey: presigned.thumbKey,
          remoteOriginalKey: presigned.originalKey,
          sizeBytes: rawBytes.length,
          mimeType,
          createdAt: now
        };

        const cloned: TodoCard = structuredClone(existing);
        if (payload.subtaskId) {
          const target = (cloned.subtasks || []).find(
            s => s.id === payload.subtaskId && !s.deletedAt
          );
          if (!target) throw new Error('Todo subtask not found');
          target.attachments = [...(target.attachments || []), att];
          target.updatedAt = now;
        } else {
          cloned.attachments = [...(cloned.attachments || []), att];
        }
        if (!cloned.coverAttachmentId) cloned.coverAttachmentId = att.id;
        cloned.updatedAt = now;
        return pushCardMutation(cloned, 'upsert');
      },
      pickAndAddAttachment: async () => ({ canceled: true }),
      deleteAttachment: async (payload: DeleteTodoAttachmentInput) => {
        const existing = cardsById.get(payload.cardId);
        if (!existing) throw new Error('Todo card not found');
        const now = String(Date.now());
        const cloned: TodoCard = structuredClone(existing);
        if (payload.subtaskId) {
          const sub = (cloned.subtasks || []).find(s => s.id === payload.subtaskId);
          if (!sub) throw new Error('Todo subtask not found');
          sub.attachments = (sub.attachments || []).filter(a => a.id !== payload.attachmentId);
          sub.updatedAt = now;
        } else {
          cloned.attachments = (cloned.attachments || []).filter(
            a => a.id !== payload.attachmentId
          );
        }
        if (cloned.coverAttachmentId === payload.attachmentId) {
          cloned.coverAttachmentId = findFallbackCoverId(cloned);
        }
        cloned.updatedAt = now;
        return pushCardMutation(cloned, 'upsert');
      },
      setCardCover: async (payload: SetTodoCardCoverInput) => {
        const existing = cardsById.get(payload.cardId);
        if (!existing) throw new Error('Todo card not found');
        return pushCardMutation(
          { ...existing, coverAttachmentId: payload.attachmentId, updatedAt: String(Date.now()) },
          'upsert'
        );
      },
      updateAttachmentMeta: async (payload: UpdateTodoAttachmentMetaInput) => {
        const existing = cardsById.get(payload.cardId);
        if (!existing) throw new Error('Todo card not found');
        const now = String(Date.now());
        const cloned: TodoCard = structuredClone(existing);
        const parentSub = payload.subtaskId
          ? (cloned.subtasks || []).find(s => s.id === payload.subtaskId)
          : undefined;
        const list = payload.subtaskId ? parentSub?.attachments || [] : cloned.attachments || [];
        const target = list.find(a => a.id === payload.attachmentId);
        if (!target) throw new Error('Todo attachment not found');
        if (payload.focalPoint) target.focalPoint = payload.focalPoint;
        if (payload.previewMode) target.previewMode = payload.previewMode;
        target.updatedAt = now;
        if (parentSub) parentSub.updatedAt = now;
        cloned.updatedAt = now;
        return pushCardMutation(cloned, 'upsert');
      },
      startSnipForCard: async () => {
        throw new Error('移动端不支持桌面端屏幕区域截图，请直接拍照或从相册选择图片');
      },
      onCountsUpdated: cb => {
        countListeners.add(cb);
        return () => countListeners.delete(cb);
      },
      onUpdated: cb => {
        stateListeners.add(cb);
        return () => stateListeners.delete(cb);
      }
    },
    accounts: {
      getSession: async () => toSessionSnapshot(session),
      switchSession: async payload => {
        const userId = payload.userId.trim();
        const endpoint = (payload.serverEndpoint || window.location.origin).trim().replace(/\/+$/, '');
        const sameActiveUser = Boolean(session && session.userId === userId);
        const token = (payload.token || (sameActiveUser ? session?.token : '') || '').trim();
        const workspaceId = (payload.workspaceId || '').trim() || 'default';
        if (!userId || !token) {
          throw new Error('请输入账号 ID 与访问 Token');
        }
        return verifyAndActivateSession({
          userId,
          displayName: payload.displayName,
          endpoint,
          workspaceId,
          token
        });
      },
      loginWithPassword: async payload => {
        const userId = payload.userId.trim();
        const endpoint = (payload.serverEndpoint || window.location.origin).trim().replace(/\/+$/, '');
        const workspaceId = (payload.workspaceId || '').trim() || 'default';
        if (!userId || !payload.password) {
          throw new Error('请输入账号 ID 与密码');
        }
        const loginRes = await fetch(`${endpoint}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            password: payload.password,
            deviceLabel: payload.deviceLabel || 'Mobile Web'
          })
        });
        if (!loginRes.ok) {
          const msg = await loginRes.text().catch(() => '');
          throw new Error(`账号密码验证失败 (${loginRes.status}): ${msg}`);
        }
        const issued = (await loginRes.json()) as {
          userId: string;
          displayName?: string;
          token: string;
        };

        try {
          return await verifyAndActivateSession({
            userId: issued.userId,
            displayName: issued.displayName,
            endpoint,
            workspaceId,
            token: issued.token
          });
        } catch (err) {
          await fetch(`${endpoint}/api/v1/auth/logout`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${issued.token}`,
              'X-TidyDesk-User': issued.userId
            }
          }).catch(cleanupErr =>
            console.warn('[TIDYDESK][MOBILE] Failed to cleanup denied login token:', cleanupErr)
          );
          throw err;
        }
      },
      changePassword: async payload => {
        const active = requireSession();
        const res = await fetch(`${active.serverEndpoint}/api/v1/auth/password`, {
          method: 'POST',
          headers: authHeaders(active, 'application/json'),
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const msg = await res.text().catch(() => '');
          throw new Error(`修改密码失败 (${res.status}): ${msg}`);
        }
      },
      listRemoteSessions: async (): Promise<RemoteAuthSessionInfo[]> => {
        const active = requireSession();
        const res = await fetch(`${active.serverEndpoint}/api/v1/auth/sessions`, {
          headers: authHeaders(active)
        });
        if (!res.ok) {
          throw new Error(`读取设备会话失败 (${res.status})`);
        }
        const data = (await res.json()) as { sessions?: RemoteAuthSessionInfo[] };
        return data.sessions || [];
      },
      revokeRemoteSession: async tokenId => {
        const active = requireSession();
        const res = await fetch(`${active.serverEndpoint}/api/v1/auth/sessions/revoke`, {
          method: 'POST',
          headers: authHeaders(active, 'application/json'),
          body: JSON.stringify({ tokenId })
        });
        if (!res.ok) {
          throw new Error(`吊销设备会话失败 (${res.status})`);
        }
      },
      listWorkspaces: async (): Promise<RemoteWorkspaceInfo[]> => {
        const active = requireSession();
        const res = await fetch(`${active.serverEndpoint}/api/v1/workspaces`, {
          headers: authHeaders(active)
        });
        if (!res.ok) {
          throw new Error(`获取工作区列表失败 (${res.status})`);
        }
        const data = (await res.json()) as { workspaces?: RemoteWorkspaceInfo[] };
        return data.workspaces || [];
      },
      logoutToLocal: async () => {
        const prev = session;
        stopSseLoop();
        if (prev) {
          await fetch(`${prev.serverEndpoint}/api/v1/auth/logout`, {
            method: 'POST',
            headers: authHeaders(prev)
          }).catch(err => {
            console.warn('[TIDYDESK][MOBILE] Failed to revoke server session on logout:', err);
          });
        }
        clearBlobCache();
        cardsById.clear();
        session = null;
        writeStoredWebSession(null);
        const snap = toSessionSnapshot(null);
        for (const cb of sessionListeners) cb(snap);
        return snap;
      },
      importLocalTodos: async () => ({ importedCards: 0 }),
      onSessionChanged: cb => {
        sessionListeners.add(cb);
        return () => sessionListeners.delete(cb);
      }
    },
    sync: {
      getStatus: async () =>
        buildSyncStatus(
          session
            ? realtimeEnabled
              ? '移动端 SSE 实时协同连接已就绪'
              : '移动端已登录（手动同步模式）'
            : '未登录云端工作区'
        ),
      clearOutbox: async () => {
        throw new Error('本地 Outbox 管理 仅在 Windows 桌面端可用');
      },
      runOnce: async () => {
        await pullLatest();
        return buildSyncStatus('已拉取最新云端协同状态');
      },
      setRealtimeEnabled: async enabled => {
        realtimeEnabled = enabled;
        if (enabled) startSseLoop();
        else stopSseLoop();
        return buildSyncStatus(enabled ? '已开启实时同步推送' : '已暂停实时同步推送');
      },
      onRealtimeApplied: cb => {
        realtimeListeners.add(cb);
        return () => realtimeListeners.delete(cb);
      }
    },
    ...createDesktopUnsupportedStubs()
  };
}
