import type {
  AccountSessionSnapshot,
  AddTodoAttachmentBytesInput,
  CreateTodoCardInput,
  DeleteTodoAttachmentInput,
  MoveTodoCardInput,
  SetTodoCardCoverInput,
  SyncStatusSnapshot,
  TodoAttachment,
  TodoBoard,
  TodoCard,
  TodoCounts,
  TodoState,
  TodoSubtask,
  UpdateTodoAttachmentMetaInput,
  UpdateTodoCardInput
} from '../types/todo';
import type { NativeCapabilities, NativeClient, SyncRealtimeAppliedPayload } from './types';

const WEB_SESSION_STORAGE_KEY = 'tidydesk_mobile_session_v1';
const THUMB_MAX_EDGE = 480;

interface StoredWebSession {
  userId: string;
  displayName?: string;
  serverEndpoint: string;
  token: string;
  lastSyncCursor?: string | null;
  lastSyncAt?: string | null;
}

const DEFAULT_BOARD: TodoBoard = {
  id: 'default-board',
  title: '待办',
  columns: [
    { id: 'todo', title: '待处理' },
    { id: 'doing', title: '进行中' },
    { id: 'done', title: '已完成' }
  ],
  cardOrder: { todo: [], doing: [], done: [] },
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
};

function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mob-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('当前浏览器不支持 WebCrypto SHA-256（需 HTTPS 或 localhost）');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function createThumbAndDimensions(
  bytes: Uint8Array,
  mimeType: string
): Promise<{ width: number; height: number; thumbBytes: Uint8Array }> {
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('无法解析所选图片格式'));
      el.src = objectUrl;
    });
    const width = img.naturalWidth || 1;
    const height = img.naturalHeight || 1;
    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(width, height));
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { width, height, thumbBytes: bytes };
    }
    ctx.drawImage(img, 0, 0, tw, th);
    const thumbBlob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/png')
    );
    if (!thumbBlob) {
      return { width, height, thumbBytes: bytes };
    }
    return {
      width,
      height,
      thumbBytes: new Uint8Array(await thumbBlob.arrayBuffer())
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function summarizeMarkdown(content: string): string {
  for (const line of content.split(/\r?\n/)) {
    const stripped = line
      .trim()
      .replace(/^#+\s*/, '')
      .replace(/^- \[[ xX]\]\s*/, '')
      .trim();
    if (stripped) return stripped.slice(0, 140);
  }
  return '';
}

function defaultPositionBefore(existingCards: TodoCard[], columnId: string): string {
  const colPositions = existingCards
    .filter(c => !c.deletedAt && c.columnId === columnId && c.position)
    .map(c => c.position as string)
    .sort();
  if (colPositions.length === 0) return '000G';
  const first = colPositions[0];
  return `0${first}`.slice(0, 16);
}

function computeCounts(cards: TodoCard[]): TodoCounts {
  let total = 0;
  let open = 0;
  let done = 0;
  for (const card of cards) {
    if (card.deletedAt || card.archived) continue;
    total += 1;
    if (card.columnId === 'done') done += 1;
    else open += 1;
  }
  return { total, open, done };
}

function readStoredWebSession(): StoredWebSession | null {
  try {
    const raw = sessionStorage.getItem(WEB_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredWebSession;
    if (!parsed.userId || !parsed.serverEndpoint || !parsed.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredWebSession(session: StoredWebSession | null) {
  try {
    if (!session) {
      sessionStorage.removeItem(WEB_SESSION_STORAGE_KEY);
    } else {
      sessionStorage.setItem(WEB_SESSION_STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignore storage quota issues in private browsing contexts
  }
}

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

  function toSessionSnapshot(s: StoredWebSession | null): AccountSessionSnapshot {
    if (!s) {
      return {
        authMode: 'local',
        activeUserId: null,
        displayName: null,
        serverEndpoint:
          typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8787',
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
      hasToken: Boolean(s.token),
      lastSyncCursor: s.lastSyncCursor ?? null,
      lastSyncAt: s.lastSyncAt ?? null,
      syncEnabled: true
    };
  }

  function requireSession(): StoredWebSession {
    if (!session) {
      throw new Error('请先输入服务端地址、账号 ID 与 Token 登录同步工作区');
    }
    return session;
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
          {
            headers: {
              Authorization: `Bearer ${currentSession.token}`,
              'X-TidyDesk-User': currentSession.userId
            }
          }
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

  async function enrichSummaryCard(
    raw: TodoCard,
    includeOriginals = false
  ): Promise<TodoCard> {
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
      boardId: DEFAULT_BOARD.id,
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
    for (const col of DEFAULT_BOARD.columns) {
      cardOrder[col.id] = enriched
        .filter(c => c.columnId === col.id)
        .sort((a, b) => (a.position || '').localeCompare(b.position || ''))
        .map(c => c.id);
    }
    return {
      activeBoardId: DEFAULT_BOARD.id,
      boards: [{ ...DEFAULT_BOARD, cardOrder }],
      cards: enriched,
      counts: computeCounts(enriched)
    };
  }

  function emitState(state: TodoState) {
    for (const cb of countListeners) cb(state.counts);
    for (const cb of stateListeners) cb(state);
  }

  async function pullLatest(): Promise<TodoState> {
    const active = requireSession();
    const res = await fetch(`${active.serverEndpoint}/api/v1/sync/pull?cursor=0`, {
      headers: {
        Authorization: `Bearer ${active.token}`,
        'X-TidyDesk-User': active.userId
      }
    });
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${active.token}`,
        'X-TidyDesk-User': active.userId
      },
      body: JSON.stringify({
        workspaceId: 'default',
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
          const res = await fetch(`${active.serverEndpoint}/api/v1/sync/events?workspaceId=default`, {
            headers: {
              Authorization: `Bearer ${active.token}`,
              'X-TidyDesk-User': active.userId
            },
            signal: controller.signal
          });
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
                if (frame.includes('event: sync-changed')) {
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

  if (session) {
    startSseLoop();
  }

  const unsupportedDesktop = (name: string): never => {
    throw new Error(`${name} 仅在 Windows 桌面端可用`);
  };

  return {
    isAvailable: () => Boolean(session),
    capabilities: MOBILE_WEB_CAPABILITIES,
    todos: {
      readState: () => pullLatest(),
      getCounts: async () => computeCounts(Array.from(cardsById.values())),
      createCard: async (payload: CreateTodoCardInput) => {
        const active = requireSession();
        const now = String(Date.now());
        const existing = Array.from(cardsById.values());
        const colId = payload.columnId || 'todo';
        const card: TodoCard = {
          id: createUuid(),
          boardId: DEFAULT_BOARD.id,
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
          position: defaultPositionBefore(existing, colId),
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
        return pushCardMutation(
          { ...existing, deletedAt: String(Date.now()) },
          'delete'
        );
      },
      moveCard: async (payload: MoveTodoCardInput) => {
        const existing = cardsById.get(payload.id);
        if (!existing) throw new Error('Todo card not found');
        const pos = defaultPositionBefore(Array.from(cardsById.values()), payload.columnId);
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
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${active.token}`,
            'X-TidyDesk-User': active.userId
          },
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
                Authorization: `Bearer ${active.token}`,
                'X-TidyDesk-User': active.userId,
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
          cloned.coverAttachmentId = cloned.attachments?.[0]?.id ?? null;
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
        const list = payload.subtaskId
          ? (cloned.subtasks || []).find(s => s.id === payload.subtaskId)?.attachments || []
          : cloned.attachments || [];
        const target = list.find(a => a.id === payload.attachmentId);
        if (!target) throw new Error('Todo attachment not found');
        if (payload.focalPoint) target.focalPoint = payload.focalPoint;
        if (payload.previewMode) target.previewMode = payload.previewMode;
        cloned.updatedAt = now;
        return pushCardMutation(cloned, 'upsert');
      },
      startSnipForCard: async () => unsupportedDesktop('区域框选截屏'),
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
        const token = (payload.token || '').trim();
        if (!userId || !token) {
          throw new Error('请输入账号 ID 与访问 Token');
        }
        // Strictly verify User ID + Token without coupling business data pull
        const res = await fetch(`${endpoint}/api/v1/auth/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'X-TidyDesk-User': userId
          },
          body: JSON.stringify({ userId, workspaceId: 'default' })
        });
        if (!res.ok) {
          const msg = await res.text().catch(() => '');
          throw new Error(`账号验证失败 (${res.status}): ${msg}`);
        }
        clearBlobCache();
        cardsById.clear();
        session = {
          userId,
          displayName: payload.displayName?.trim() || userId,
          serverEndpoint: endpoint,
          token
        };
        writeStoredWebSession(session);
        const snap = toSessionSnapshot(session);
        for (const cb of sessionListeners) cb(snap);
        startSseLoop();
        return snap;
      },
      logoutToLocal: async () => {
        stopSseLoop();
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
      getStatus: async (): Promise<SyncStatusSnapshot> => ({
        authMode: session ? 'account' : 'local',
        activeUserId: session?.userId ?? null,
        syncEnabled: Boolean(session),
        serverEndpoint: session?.serverEndpoint ?? null,
        pendingCount: 0,
        lastSyncCursor: session?.lastSyncCursor ?? null,
        lastSyncAt: session?.lastSyncAt ?? null,
        realtimeActive: Boolean(session && realtimeEnabled),
        statusMessage: session
          ? realtimeEnabled
            ? '移动端 SSE 实时协同连接已就绪'
            : '移动端已登录（手动同步模式）'
          : '未登录云端工作区'
      }),
      clearOutbox: async () => unsupportedDesktop('本地 Outbox 管理'),
      runOnce: async () => {
        await pullLatest();
        return {
          authMode: 'account',
          activeUserId: session?.userId ?? null,
          syncEnabled: Boolean(session),
          serverEndpoint: session?.serverEndpoint ?? null,
          pendingCount: 0,
          lastSyncCursor: session?.lastSyncCursor ?? null,
          lastSyncAt: session?.lastSyncAt ?? null,
          realtimeActive: Boolean(session && realtimeEnabled),
          statusMessage: '已拉取最新云端协同状态'
        };
      },
      setRealtimeEnabled: async enabled => {
        realtimeEnabled = enabled;
        if (enabled) startSseLoop();
        else stopSseLoop();
        return {
          authMode: session ? 'account' : 'local',
          activeUserId: session?.userId ?? null,
          syncEnabled: Boolean(session),
          serverEndpoint: session?.serverEndpoint ?? null,
          pendingCount: 0,
          lastSyncCursor: session?.lastSyncCursor ?? null,
          lastSyncAt: session?.lastSyncAt ?? null,
          realtimeActive: Boolean(session && realtimeEnabled),
          statusMessage: enabled ? '已开启实时同步推送' : '已暂停实时同步推送'
        };
      },
      onRealtimeApplied: cb => {
        realtimeListeners.add(cb);
        return () => realtimeListeners.delete(cb);
      }
    },
    quickNotes: {
      readState: async () => ({ notes: [] }),
      createNote: () => unsupportedDesktop('quickNotes'),
      updateNote: () => unsupportedDesktop('quickNotes'),
      deleteNote: () => unsupportedDesktop('quickNotes')
    },
    files: {
      readDesktopFiles: () => unsupportedDesktop('files'),
      readIcons: () => unsupportedDesktop('files'),
      importExternalFiles: () => unsupportedDesktop('files'),
      open: () => unsupportedDesktop('files'),
      restoreToDesktop: () => unsupportedDesktop('files')
    },
    drawers: {
      create: () => unsupportedDesktop('drawers'),
      renameItem: () => unsupportedDesktop('drawers'),
      deleteItem: () => unsupportedDesktop('drawers')
    },
    shortcuts: {
      validateAll: () => unsupportedDesktop('shortcuts'),
      repair: () => unsupportedDesktop('shortcuts'),
      onTargetFileDeleted: () => undefined,
      onTargetFileRestored: () => undefined,
      onValidated: () => undefined
    },
    apps: {
      scanInstalled: () => unsupportedDesktop('apps'),
      refresh: () => unsupportedDesktop('apps'),
      getCacheInfo: () => unsupportedDesktop('apps'),
      openPicker: () => unsupportedDesktop('apps'),
      closePicker: () => unsupportedDesktop('apps'),
      getPickerTarget: () => unsupportedDesktop('apps'),
      onSetTargetFolder: () => undefined,
      onIconsUpdated: () => undefined,
      addToDrawer: () => unsupportedDesktop('apps')
    },
    windows: {
      control: () => undefined,
      getPathForFile: () => '',
      onDrawerState: () => undefined,
      onModuleState: () => undefined
    },
    toolWindows: {
      openTodo: () => unsupportedDesktop('toolWindows'),
      closeTodo: () => unsupportedDesktop('toolWindows')
    },
    resident: {
      getSettings: () => unsupportedDesktop('resident'),
      updateSettings: () => unsupportedDesktop('resident'),
      showHandle: () => unsupportedDesktop('resident'),
      hideHandle: () => unsupportedDesktop('resident'),
      openSettings: () => unsupportedDesktop('resident'),
      onOpenSettings: () => undefined
    },
    hotkeys: {
      getSettings: () => unsupportedDesktop('hotkeys'),
      validateBinding: () => unsupportedDesktop('hotkeys'),
      updateBinding: () => unsupportedDesktop('hotkeys'),
      resetDefaults: () => unsupportedDesktop('hotkeys')
    },
    clipboard: {
      readText: async () => ''
    },
    capture: {
      onOpened: () => undefined,
      completeSnipSelection: () => unsupportedDesktop('capture'),
      cancelSnip: () => unsupportedDesktop('capture'),
      getBackgroundImage: () => unsupportedDesktop('capture')
    },
    stickers: {
      get: async () => null,
      togglePin: () => unsupportedDesktop('stickers'),
      copy: () => unsupportedDesktop('stickers'),
      saveAs: () => unsupportedDesktop('stickers'),
      close: () => unsupportedDesktop('stickers'),
      onUpdated: () => undefined
    },
    updates: {
      getMetadata: () => unsupportedDesktop('updates'),
      getState: () => unsupportedDesktop('updates'),
      check: () => unsupportedDesktop('updates'),
      download: () => unsupportedDesktop('updates'),
      install: () => unsupportedDesktop('updates'),
      onChange: () => undefined
    },
    events: {
      send: () => undefined
    }
  };
}
