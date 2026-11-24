import type {
  AddTodoAttachmentBytesInput,
  CreateTodoCardInput,
  DeleteTodoAttachmentInput,
  MoveTodoCardInput,
  SetTodoCardCoverInput,
  TodoAttachment,
  TodoCard,
  TodoState,
  TodoSubtask,
  UpdateTodoAttachmentMetaInput,
  UpdateTodoCardInput
} from '../types/todo';
import type { NativeTodosClient } from './types';
import type { WebHttpContext } from './web-http-context';
import {
  compareCardsByPosition,
  computePositionForColumn,
  computeSha256Hex,
  computeTodoCounts,
  createThumbAndDimensions,
  createUuid,
  DEFAULT_MOBILE_BOARD,
  findFallbackCoverId,
  summarizeMarkdown
} from './web-http-helpers';

export interface WebTodosModule {
  client: NativeTodosClient;
  applyPulledCards: (cards: TodoCard[], removedCardIds: string[]) => Promise<TodoState>;
}

export function createWebTodosModule(
  ctx: WebHttpContext,
  pullLatest: () => Promise<TodoState>
): WebTodosModule {
  const resolveAuthorizedBlobUrl = async (
    kind: 'thumb' | 'original',
    key?: string
  ): Promise<string | undefined> => {
    const active = ctx.getSession();
    if (!key || !active) return undefined;
    const wsId = ctx.resolveWorkspaceId(active);
    const cacheKey = `${active.userId}:${wsId}:${kind}:${key}`;
    const cached = ctx.blobUrlCache.get(cacheKey);
    if (cached) return cached;

    const existingPromise = ctx.pendingBlobFetches.get(cacheKey);
    if (existingPromise) return existingPromise;

    const promise = (async () => {
      try {
        const res = await fetch(
          `${active.serverEndpoint}/api/v1/media/blob/${kind}/${encodeURIComponent(key)}?workspaceId=${encodeURIComponent(wsId)}`,
          { headers: ctx.authHeaders(active) }
        );
        if (!res.ok) return undefined;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        ctx.blobUrlCache.set(cacheKey, url);
        return url;
      } catch (err) {
        console.warn('[TIDYDESK][MOBILE] Failed to fetch authorized media blob:', err);
        return undefined;
      } finally {
        ctx.pendingBlobFetches.delete(cacheKey);
      }
    })();

    ctx.pendingBlobFetches.set(cacheKey, promise);
    return promise;
  };

  const hydrateAttachmentUrls = async (
    att: TodoAttachment,
    includeOriginals: boolean
  ): Promise<TodoAttachment> => {
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
      thumbUrl: thumbUrl || att.thumbUrl,
      assetUrl: includeOriginals ? assetUrl || att.assetUrl || thumbUrl : att.assetUrl
    };
  };

  const enrichSummaryCard = async (
    raw: TodoCard,
    includeOriginals = false
  ): Promise<TodoCard> => {
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
  };

  const buildTodoStateSnapshot = async (): Promise<TodoState> => {
    const all = Array.from(ctx.cardsById.values()).filter(c => !c.deletedAt);
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
  };

  const emitState = (state: TodoState) => {
    for (const cb of ctx.countListeners) cb(state.counts);
    for (const cb of ctx.stateListeners) cb(state);
  };

  const applyPulledCards = async (
    cards: TodoCard[],
    removedCardIds: string[]
  ): Promise<TodoState> => {
    ctx.cardsById.clear();
    for (const card of cards || []) {
      ctx.cardsById.set(card.id, card);
    }
    for (const rid of removedCardIds || []) {
      ctx.cardsById.delete(rid);
    }
    const state = await buildTodoStateSnapshot();
    emitState(state);
    return state;
  };

  const pushCardMutation = async (
    card: TodoCard,
    operation: 'upsert' | 'delete' = 'upsert'
  ): Promise<TodoState> => {
    const active = ctx.requireSession();
    const res = await fetch(`${active.serverEndpoint}/api/v1/sync/push`, {
      method: 'POST',
      headers: ctx.authHeaders(active, 'application/json'),
      body: JSON.stringify({
        workspaceId: ctx.resolveWorkspaceId(active),
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
      ctx.recordSyncCursor(pushed.nextCursor);
    }
    if (operation === 'delete') {
      ctx.cardsById.delete(card.id);
    } else if (pushed.mergedCards && pushed.mergedCards[0]) {
      ctx.cardsById.set(card.id, pushed.mergedCards[0]);
    } else {
      ctx.cardsById.set(card.id, card);
    }
    const state = await buildTodoStateSnapshot();
    emitState(state);
    return state;
  };

  const client: NativeTodosClient = {
    readState: () => pullLatest(),
    getCounts: async () => computeTodoCounts(Array.from(ctx.cardsById.values())),
    createCard: async (payload: CreateTodoCardInput) => {
      const active = ctx.requireSession();
      const now = String(Date.now());
      const existing = Array.from(ctx.cardsById.values());
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
      const existing = ctx.cardsById.get(payload.id);
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
      const existing = ctx.cardsById.get(cardId);
      if (!existing) return buildTodoStateSnapshot();
      return pushCardMutation({ ...existing, deletedAt: String(Date.now()) }, 'delete');
    },
    moveCard: async (payload: MoveTodoCardInput) => {
      const existing = ctx.cardsById.get(payload.id);
      if (!existing) throw new Error('Todo card not found');
      const pos = computePositionForColumn(
        Array.from(ctx.cardsById.values()),
        payload.columnId,
        payload.beforeId
      );
      return pushCardMutation(
        { ...existing, columnId: payload.columnId, position: pos, updatedAt: String(Date.now()) },
        'upsert'
      );
    },
    getCardDetail: async (cardId: string) => {
      const card = ctx.cardsById.get(cardId);
      if (!card) throw new Error('Todo card not found');
      return enrichSummaryCard(card, true);
    },
    addAttachmentBytes: async (payload: AddTodoAttachmentBytesInput) => {
      const active = ctx.requireSession();
      const existing = ctx.cardsById.get(payload.cardId);
      if (!existing) throw new Error('Todo card not found');
      const rawBytes = new Uint8Array(payload.bytes);
      const ext = payload.fileName.toLowerCase();
      const mimeType =
        ext.endsWith('.jpg') || ext.endsWith('.jpeg')
          ? 'image/jpeg'
          : ext.endsWith('.webp')
            ? 'image/webp'
            : 'image/png';
      const [sha256, dims] = await Promise.all([
        computeSha256Hex(rawBytes),
        createThumbAndDimensions(rawBytes, mimeType)
      ]);

      const wsId = ctx.resolveWorkspaceId(active);
      const wsQuery = `?workspaceId=${encodeURIComponent(wsId)}`;
      const presignRes = await fetch(`${active.serverEndpoint}/api/v1/media/presign${wsQuery}`, {
        method: 'POST',
        headers: ctx.authHeaders(active, 'application/json'),
        body: JSON.stringify({ sha256, mimeType, workspaceId: wsId })
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
          const separator = pathOrUrl.includes('?') ? '&' : '?';
          const up = await fetch(
            `${active.serverEndpoint}${pathOrUrl}${separator}workspaceId=${encodeURIComponent(wsId)}`,
            {
              method: 'PUT',
              headers: {
                ...ctx.authHeaders(active),
                'x-tidydesk-sha256': sha256
              },
              body: bodyBytes.buffer.slice(
                bodyBytes.byteOffset,
                bodyBytes.byteOffset + bodyBytes.byteLength
              ) as ArrayBuffer
            }
          );
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
      const existing = ctx.cardsById.get(payload.cardId);
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
      const existing = ctx.cardsById.get(payload.cardId);
      if (!existing) throw new Error('Todo card not found');
      return pushCardMutation(
        { ...existing, coverAttachmentId: payload.attachmentId, updatedAt: String(Date.now()) },
        'upsert'
      );
    },
    updateAttachmentMeta: async (payload: UpdateTodoAttachmentMetaInput) => {
      const existing = ctx.cardsById.get(payload.cardId);
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
      ctx.countListeners.add(cb);
      return () => ctx.countListeners.delete(cb);
    },
    onUpdated: cb => {
      ctx.stateListeners.add(cb);
      return () => ctx.stateListeners.delete(cb);
    }
  };

  return { client, applyPulledCards };
}
