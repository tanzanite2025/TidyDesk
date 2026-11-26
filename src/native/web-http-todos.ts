import type {
  AddTodoAttachmentBytesInput,
  AddTodoCommentInput,
  CreateTodoCardInput,
  DeleteTodoAttachmentInput,
  DeleteTodoCommentInput,
  MoveTodoCardInput,
  SetTodoCardCoverInput,
  TodoAttachment,
  TodoCard,
  TodoCardComment,
  TodoCommentNotificationPayload,
  TodoState,
  TodoSubtask,
  TodoUnreadCommentSummary,
  UpdateTodoAttachmentMetaInput,
  UpdateTodoCardInput
} from '../types/todo';
import { normalizeTodoPriority } from '../types/todo';
import { computeUnreadCommentSummary, truncateCommentPreview } from '../modules/todos/commentUtils';
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
import { createHttpStatusError, isTransientSyncError } from './web-offline-store';

export interface WebTodosModule {
  client: NativeTodosClient;
  applyPulledSync: (params: {
    cards?: TodoCard[];
    removedCardIds?: string[];
    cardComments?: TodoCardComment[];
    removedCardCommentIds?: string[];
  }) => Promise<TodoState>;
  buildLocalState: () => Promise<TodoState>;
  emitLocalState: (state: TodoState) => void;
  resetSessionFlags: () => void;
}

export function createWebTodosModule(
  ctx: WebHttpContext,
  pullLatest: () => Promise<TodoState>,
  onUnauthorized?: () => void,
  pullLatestUnlocked: () => Promise<TodoState> = pullLatest
): WebTodosModule {
  const handleUnauthorizedResponse = (res: Response, message: string): never => {
    if (res.status === 401) {
      onUnauthorized?.();
      throw createHttpStatusError('登录凭证已失效或被吊销，请重新登录 (401)', 401);
    }
    throw createHttpStatusError(message, res.status);
  };
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

    const active = ctx.getSession();
    const activeComments = (ctx.commentsByCardId.get(raw.id) || []).filter(c => !c.deletedAt);
    const readMap = readCommentReadMap();
    const readTs = Number(readMap[raw.id] || 0);
    const actorId = active?.userId || '';
    let unreadCommentCount = 0;
    let unreadMentionCount = 0;
    if (actorId && actorId !== 'local') {
      for (const cmt of activeComments) {
        if (cmt.authorId === 'local' || cmt.authorId === actorId) continue;
        if (Number(cmt.createdAt || 0) > readTs) {
          unreadCommentCount += 1;
          if (cmt.mentions?.includes(actorId)) unreadMentionCount += 1;
        }
      }
    }

    return {
      ...raw,
      boardId: DEFAULT_MOBILE_BOARD.id,
      priority: normalizeTodoPriority(raw.priority),
      summaryText: summarizeMarkdown(raw.content || ''),
      subtasks: enrichedSubs,
      subtaskTotal: enrichedSubs.length,
      subtaskCompleted: enrichedSubs.filter(s => s.completed).length,
      attachments: cardAtts,
      previewAttachments: previews,
      attachmentCount: allAtts.length,
      extraAttachmentCount: Math.max(0, allAtts.length - previews.length),
      commentCount: activeComments.length,
      unreadCommentCount,
      unreadMentionCount
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

  const readStorageKey = () => {
    const active = ctx.getSession();
    if (!active) return null;
    return `tidydesk_comment_reads:${active.userId}:${ctx.resolveWorkspaceId(active)}`;
  };

  const readCommentReadMap = (): Record<string, number> => {
    if (typeof window === 'undefined') return {};
    const key = readStorageKey();
    if (!key) return {};
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
    } catch {
      return {};
    }
  };

  const writeCommentReadMap = (next: Record<string, number>) => {
    if (typeof window === 'undefined') return;
    const key = readStorageKey();
    if (!key) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch (err) {
      console.warn('[TIDYDESK][MOBILE] Failed to persist comment read map:', err);
    }
  };

  const computeCurrentUnreadSummary = (): TodoUnreadCommentSummary => {
    const active = ctx.getSession();
    return computeUnreadCommentSummary({
      cardsById: ctx.cardsById,
      commentsByCardId: ctx.commentsByCardId,
      readTimestamps: readCommentReadMap(),
      currentUserId: active?.userId ?? null
    });
  };

  const emitUnreadSummary = (): TodoUnreadCommentSummary => {
    const summary = computeCurrentUnreadSummary();
    for (const cb of ctx.unreadListeners) cb(summary);
    return summary;
  };

  const emitState = (state: TodoState) => {
    for (const cb of ctx.countListeners) cb(state.counts);
    for (const cb of ctx.stateListeners) cb(state);
  };

  const areCommentListsEqual = (
    left: TodoCardComment[] = [],
    right: TodoCardComment[] = []
  ): boolean => {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      const a = left[i];
      const b = right[i];
      if (
        a.id !== b.id ||
        a.updatedAt !== b.updatedAt ||
        a.body !== b.body ||
        (a.parentId ?? null) !== (b.parentId ?? null) ||
        (a.deletedAt ?? null) !== (b.deletedAt ?? null) ||
        JSON.stringify(a.mentions || []) !== JSON.stringify(b.mentions || [])
      ) {
        return false;
      }
    }
    return true;
  };

  let hadPulledCommentsOnce = false;

  const applyPulledComments = (
    comments: TodoCardComment[] = [],
    removedCommentIds: string[] = []
  ) => {
    const active = ctx.getSession();
    const actorId = active?.userId || '';
    const prevCommentIds = new Set<string>();
    for (const list of ctx.commentsByCardId.values()) {
      for (const c of list) prevCommentIds.add(c.id);
    }
    const readMap = readCommentReadMap();

    const grouped = new Map<string, TodoCardComment[]>();
    const removedSet = new Set(removedCommentIds || []);
    const changedCards = new Set<string>();
    const newlyArrivedAlerts: TodoCardComment[] = [];

    for (const cmt of comments || []) {
      if (!cmt?.cardId || cmt.deletedAt || removedSet.has(cmt.id)) continue;
      const list = grouped.get(cmt.cardId) || [];
      list.push(cmt);
      grouped.set(cmt.cardId, list);

      const targetCard = ctx.cardsById.get(cmt.cardId);
      if (
        hadPulledCommentsOnce &&
        targetCard &&
        !targetCard.deletedAt &&
        !targetCard.archived &&
        !prevCommentIds.has(cmt.id) &&
        actorId &&
        cmt.authorId !== 'local' &&
        cmt.authorId !== actorId &&
        Number(cmt.createdAt || 0) > Number(readMap[cmt.cardId] || 0)
      ) {
        newlyArrivedAlerts.push(cmt);
      }
    }
    for (const [cid, list] of grouped.entries()) {
      list.sort(
        (a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0) || a.id.localeCompare(b.id)
      );
      const prevList = ctx.commentsByCardId.get(cid) || [];
      if (!areCommentListsEqual(prevList, list)) {
        changedCards.add(cid);
      }
      ctx.commentsByCardId.set(cid, list);
    }
    for (const oldCid of Array.from(ctx.commentsByCardId.keys())) {
      if (!grouped.has(oldCid)) {
        const prevList = ctx.commentsByCardId.get(oldCid) || [];
        ctx.commentsByCardId.delete(oldCid);
        if (prevList.length > 0) {
          changedCards.add(oldCid);
        }
      }
    }
    hadPulledCommentsOnce = true;

    const summary = emitUnreadSummary();
    if (changedCards.size > 0) {
      const cardIds = Array.from(changedCards);
      for (const cb of ctx.commentListeners) cb({ cardIds });
    }
    if (newlyArrivedAlerts.length > 0) {
      const mentionAlerts = newlyArrivedAlerts.filter(c => c.mentions?.includes(actorId));
      const lead = mentionAlerts[0] || newlyArrivedAlerts[0];
      const leadTitle = ctx.cardsById.get(lead.cardId)?.title?.trim() || '未命名待办';
      const notif: TodoCommentNotificationPayload =
        newlyArrivedAlerts.length === 1
          ? {
              title: mentionAlerts.length > 0
                ? `${lead.authorName || lead.authorId} 在「${leadTitle}」@了你`
                : `${lead.authorName || lead.authorId} 评论了「${leadTitle}」`,
              body: truncateCommentPreview(lead.body, 72),
              cardId: lead.cardId,
              mentionCount: mentionAlerts.length,
              commentCount: 1,
              unreadTotal: summary.unreadTotal,
              mentionTotal: summary.mentionTotal
            }
          : {
              title:
                mentionAlerts.length > 0
                  ? `收到 ${newlyArrivedAlerts.length} 条新评论（含 ${mentionAlerts.length} 条 @提及）`
                  : `收到 ${newlyArrivedAlerts.length} 条新待办评论`,
              body: `${leadTitle}（${lead.authorName || lead.authorId}）: ${truncateCommentPreview(lead.body, 60)}`,
              cardId: lead.cardId,
              mentionCount: mentionAlerts.length,
              commentCount: newlyArrivedAlerts.length,
              unreadTotal: summary.unreadTotal,
              mentionTotal: summary.mentionTotal
            };
      for (const cb of ctx.notificationListeners) cb(notif);
    }
  };

  const applyPulledSync = async (params: {
    cards?: TodoCard[];
    removedCardIds?: string[];
    cardComments?: TodoCardComment[];
    removedCardCommentIds?: string[];
  }): Promise<TodoState> => {
    ctx.cardsById.clear();
    for (const card of params.cards || []) {
      ctx.cardsById.set(card.id, card);
    }
    for (const rid of params.removedCardIds || []) {
      ctx.cardsById.delete(rid);
    }

    const mergedComments = [...(params.cardComments || [])];
    const removedCommentIds = new Set(params.removedCardCommentIds || []);
    for (const pending of ctx.getOutboxEntries()) {
      if (pending.entityKind === 'card') {
        if (pending.operation === 'delete') {
          ctx.cardsById.delete(pending.entityId);
        } else {
          ctx.cardsById.set(pending.entityId, pending.payload as unknown as TodoCard);
        }
      } else if (pending.entityKind === 'cardComment') {
        if (pending.operation === 'delete') {
          removedCommentIds.add(pending.entityId);
        } else {
          const comment = pending.payload as unknown as TodoCardComment;
          const idx = mergedComments.findIndex(item => item.id === pending.entityId);
          if (idx >= 0) mergedComments[idx] = comment;
          else mergedComments.push(comment);
        }
      }
    }

    // Apply comments AFTER cardsById is updated so unread summary and notifications resolve exact card titles.
    applyPulledComments(mergedComments, Array.from(removedCommentIds));
    const state = await buildTodoStateSnapshot();
    emitState(state);
    return state;
  };

  const resetSessionFlags = () => {
    hadPulledCommentsOnce = false;
  };

  const pushCardMutation = (
    card: TodoCard,
    operation: 'upsert' | 'delete' = 'upsert'
  ): Promise<TodoState> =>
    ctx.runSerializedSync(async () => {
      ctx.requireActiveOrDetachedScope();
      const active = ctx.getSession();
      const cardPayload = {
        ...card,
        baseRevision: card.revision ?? 0
      };

      const commitLocal = async (queueOffline: boolean, mergedCard?: TodoCard) => {
        if (operation === 'delete') {
          ctx.cardsById.delete(card.id);
        } else if (mergedCard) {
          ctx.cardsById.set(card.id, mergedCard);
        } else {
          ctx.cardsById.set(card.id, card);
        }
        if (queueOffline) {
          ctx.enqueueOfflineMutation({
            entityKind: 'card',
            entityId: card.id,
            operation,
            payload: cardPayload,
            updatedAt: card.updatedAt || String(Date.now())
          });
        } else {
          ctx.persistScopeSnapshot();
        }
        const state = await buildTodoStateSnapshot();
        emitState(state);
        return state;
      };

      if (!active) {
        return commitLocal(true);
      }

      try {
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
                payload: cardPayload
              }
            ]
          })
        });
        if (!res.ok) {
          handleUnauthorizedResponse(res, `提交云端变更失败 (${res.status})`);
        }
        const pushed = (await res.json()) as {
          nextCursor?: string;
          mergedCards?: TodoCard[];
        };
        if (pushed.nextCursor) {
          ctx.recordSyncCursor(pushed.nextCursor);
        }
        return commitLocal(false, pushed.mergedCards?.[0]);
      } catch (err) {
        if (isTransientSyncError(err)) {
          return commitLocal(true);
        }
        throw err;
      }
    });

  const client: NativeTodosClient = {
    readState: () => pullLatest(),
    getCounts: async () => computeTodoCounts(Array.from(ctx.cardsById.values())),
    createCard: async (payload: CreateTodoCardInput) => {
      const scope = ctx.requireActiveOrDetachedScope();
      const now = String(Date.now());
      const existing = Array.from(ctx.cardsById.values());
      const colId = payload.columnId || 'todo';
      const card: TodoCard = {
        id: createUuid(),
        boardId: DEFAULT_MOBILE_BOARD.id,
        columnId: colId,
        title: (payload.title || '').trim() || '新待办',
        priority: normalizeTodoPriority(payload.priority),
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
        updatedBy: scope.userId,
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
        priority: payload.priority !== undefined
          ? normalizeTodoPriority(payload.priority)
          : normalizeTodoPriority(existing.priority),
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
      const active = ctx.getSession();
      if (!active) {
        throw new Error('当前处于离线连续模式，图片附件暂不支持离线上传，请联网重登后再试');
      }
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
      if (!presignRes.ok) {
        handleUnauthorizedResponse(presignRes, `媒体上传预检失败 (${presignRes.status})`);
      }
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
          if (!up.ok) handleUnauthorizedResponse(up, `上传媒体文件失败 (${up.status})`);
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
    listCardComments: async (cardId: string) => {
      await pullLatest();
      return (ctx.commentsByCardId.get(cardId) || []).filter(c => !c.deletedAt);
    },
    getUnreadCommentSummary: async () => computeCurrentUnreadSummary(),
    markCardCommentsRead: async (cardId: string) => {
      const readMap = readCommentReadMap();
      const comments = ctx.commentsByCardId.get(cardId) || [];
      const latestTs = comments.reduce(
        (max, cmt) => Math.max(max, Number(cmt.createdAt || 0)),
        0
      );
      readMap[cardId] = Math.max(Number(readMap[cardId] || 0), latestTs, Date.now());
      writeCommentReadMap(readMap);
      const summary = emitUnreadSummary();
      const state = await buildTodoStateSnapshot();
      emitState(state);
      return summary;
    },
    markAllCommentsRead: async () => {
      const readMap = readCommentReadMap();
      const now = Date.now();
      for (const [cid, comments] of ctx.commentsByCardId.entries()) {
        const latestTs = comments.reduce(
          (max, cmt) => Math.max(max, Number(cmt.createdAt || 0)),
          0
        );
        readMap[cid] = Math.max(Number(readMap[cid] || 0), latestTs, now);
      }
      writeCommentReadMap(readMap);
      const summary = emitUnreadSummary();
      const state = await buildTodoStateSnapshot();
      emitState(state);
      return summary;
    },
    addCardComment: (payload: AddTodoCommentInput) =>
      ctx.runSerializedSync(async () => {
        const scope = ctx.requireActiveOrDetachedScope();
        const active = ctx.getSession();
        const body = payload.body.trim();
        if (!body) throw new Error('评论内容不能为空');
        const now = String(Date.now());
        const id = createUuid();
        const draft: TodoCardComment = {
          id,
          cardId: payload.cardId,
          parentId: payload.parentId ?? null,
          authorId: scope.userId,
          authorName: scope.displayName || scope.userId,
          body,
          mentions: [],
          createdAt: now,
          updatedAt: now,
          deletedAt: null
        };

        const queueOfflineComment = async () => {
          const currentList = ctx.commentsByCardId.get(payload.cardId) || [];
          ctx.commentsByCardId.set(payload.cardId, [...currentList, draft]);
          ctx.enqueueOfflineMutation({
            entityKind: 'cardComment',
            entityId: id,
            operation: 'upsert',
            payload: draft as unknown as Record<string, unknown>,
            updatedAt: now
          });
          emitUnreadSummary();
          for (const cb of ctx.commentListeners) cb({ cardIds: [payload.cardId] });
          emitState(await buildTodoStateSnapshot());
          return draft;
        };

        if (!active) {
          return queueOfflineComment();
        }

        try {
          const res = await fetch(`${active.serverEndpoint}/api/v1/sync/push`, {
            method: 'POST',
            headers: ctx.authHeaders(active, 'application/json'),
            body: JSON.stringify({
              workspaceId: ctx.resolveWorkspaceId(active),
              entries: [
                {
                  entityKind: 'cardComment',
                  entityId: id,
                  operation: 'upsert',
                  payload: draft
                }
              ]
            })
          });
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            handleUnauthorizedResponse(res, `提交评论失败 (${res.status}): ${text}`);
          }
          await pullLatestUnlocked();
          const created = (ctx.commentsByCardId.get(payload.cardId) || []).find(c => c.id === id);
          return created || draft;
        } catch (err) {
          if (isTransientSyncError(err)) {
            return queueOfflineComment();
          }
          throw err;
        }
      }),
    deleteCardComment: (payload: DeleteTodoCommentInput) =>
      ctx.runSerializedSync(async () => {
        ctx.requireActiveOrDetachedScope();
        const active = ctx.getSession();
        const now = String(Date.now());
        const deletePayload = {
          id: payload.commentId,
          cardId: payload.cardId,
          deletedAt: now,
          updatedAt: now
        };

        const queueOfflineDelete = async () => {
          const currentList = (ctx.commentsByCardId.get(payload.cardId) || []).filter(
            c => c.id !== payload.commentId
          );
          ctx.commentsByCardId.set(payload.cardId, currentList);
          ctx.enqueueOfflineMutation({
            entityKind: 'cardComment',
            entityId: payload.commentId,
            operation: 'delete',
            payload: deletePayload,
            updatedAt: now
          });
          emitUnreadSummary();
          for (const cb of ctx.commentListeners) cb({ cardIds: [payload.cardId] });
          emitState(await buildTodoStateSnapshot());
          return currentList.filter(c => !c.deletedAt);
        };

        if (!active) {
          return queueOfflineDelete();
        }

        try {
          const res = await fetch(`${active.serverEndpoint}/api/v1/sync/push`, {
            method: 'POST',
            headers: ctx.authHeaders(active, 'application/json'),
            body: JSON.stringify({
              workspaceId: ctx.resolveWorkspaceId(active),
              entries: [
                {
                  entityKind: 'cardComment',
                  entityId: payload.commentId,
                  operation: 'delete',
                  payload: deletePayload
                }
              ]
            })
          });
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            handleUnauthorizedResponse(res, `删除评论失败 (${res.status}): ${text}`);
          }
          await pullLatestUnlocked();
          return (ctx.commentsByCardId.get(payload.cardId) || []).filter(c => !c.deletedAt);
        } catch (err) {
          if (isTransientSyncError(err)) {
            return queueOfflineDelete();
          }
          throw err;
        }
      }),
    onCountsUpdated: cb => {
      ctx.countListeners.add(cb);
      return () => ctx.countListeners.delete(cb);
    },
    onUpdated: cb => {
      ctx.stateListeners.add(cb);
      return () => ctx.stateListeners.delete(cb);
    },
    onCommentsUpdated: cb => {
      ctx.commentListeners.add(cb);
      return () => ctx.commentListeners.delete(cb);
    },
    onUnreadCommentsUpdated: cb => {
      ctx.unreadListeners.add(cb);
      return () => ctx.unreadListeners.delete(cb);
    },
    onCommentNotification: cb => {
      ctx.notificationListeners.add(cb);
      return () => ctx.notificationListeners.delete(cb);
    }
  };

  return {
    client,
    applyPulledSync,
    buildLocalState: buildTodoStateSnapshot,
    emitLocalState: emitState,
    resetSessionFlags
  };
}
