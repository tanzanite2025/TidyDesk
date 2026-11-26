import type {
  CreateQuickNoteInput,
  QuickNote,
  QuickNotesState,
  UpdateQuickNoteInput
} from '../types/quick-note';
import type { TodoState } from '../types/todo';
import { sortNotes, titleFromContent } from '../modules/notes/utils';
import type { NativeQuickNotesClient } from './types';
import type { WebHttpContext } from './web-http-context';
import { createUuid } from './web-http-helpers';
import { createHttpStatusError, isTransientSyncError } from './web-offline-store';

export interface WebQuickNotesModule {
  client: NativeQuickNotesClient;
  applyPulledNotes: (notes?: QuickNote[], removedIds?: string[]) => void;
  emitLocalNotes: () => void;
  clearAndEmitEmpty: () => void;
}

export function createWebQuickNotesModule(
  ctx: WebHttpContext,
  pullLatest: () => Promise<TodoState>,
  onUnauthorized?: () => void
): WebQuickNotesModule {
  const sortedSnapshot = (): QuickNotesState => {
    const notes = sortNotes(Array.from(ctx.quickNotesById.values()), 'updated').sort((left, right) => {
      if (left.pinned !== right.pinned) return Number(right.pinned) - Number(left.pinned);
      if (left.favorite !== right.favorite) return Number(right.favorite) - Number(left.favorite);
      return 0;
    });
    return { notes };
  };

  const emitQuickNotes = (state: QuickNotesState) => {
    for (const cb of ctx.quickNoteListeners) cb(state);
  };

  const applyPulledNotes = (notes?: QuickNote[], removedIds?: string[]) => {
    ctx.quickNotesById.clear();
    for (const rawNote of notes || []) {
      if (rawNote && rawNote.id) {
        ctx.quickNotesById.set(rawNote.id, {
          id: rawNote.id,
          title: rawNote.title || 'Untitled Note',
          content: rawNote.content || '',
          pinned: Boolean(rawNote.pinned),
          favorite: Boolean(rawNote.favorite),
          createdAt: rawNote.createdAt || String(Date.now()),
          updatedAt: rawNote.updatedAt || String(Date.now())
        });
      }
    }
    for (const rid of removedIds || []) {
      ctx.quickNotesById.delete(rid);
    }
    for (const pending of ctx.getOutboxEntries()) {
      if (pending.entityKind !== 'quickNote') continue;
      if (pending.operation === 'delete') {
        ctx.quickNotesById.delete(pending.entityId);
      } else {
        const note = pending.payload as unknown as QuickNote;
        if (note?.id) ctx.quickNotesById.set(note.id, note);
      }
    }
    emitQuickNotes(sortedSnapshot());
  };

  const pushMutation = (note: QuickNote, operation: 'upsert' | 'delete'): Promise<QuickNotesState> =>
    ctx.runSerializedSync(async () => {
      ctx.requireActiveOrDetachedScope();
      const active = ctx.getSession();
      const mutatedAt = String(Date.now());
      const entryPayload =
        operation === 'delete'
          ? { id: note.id, deletedAt: mutatedAt }
          : (note as unknown as Record<string, unknown>);

      const commitLocal = (queueOffline: boolean) => {
        if (operation === 'delete') {
          ctx.quickNotesById.delete(note.id);
        } else {
          ctx.quickNotesById.set(note.id, note);
        }
        if (queueOffline) {
          ctx.enqueueOfflineMutation({
            entityKind: 'quickNote',
            entityId: note.id,
            operation,
            payload: entryPayload,
            updatedAt: note.updatedAt || mutatedAt
          });
        } else {
          ctx.persistScopeSnapshot();
        }
        const next = sortedSnapshot();
        emitQuickNotes(next);
        return next;
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
                entityKind: 'quickNote',
                entityId: note.id,
                operation,
                payload: entryPayload
              }
            ]
          })
        });
        if (res.status === 401) {
          onUnauthorized?.();
          throw createHttpStatusError('登录凭证已失效或被吊销，请重新登录 (401)', 401);
        }
        if (!res.ok) {
          throw createHttpStatusError(`同步快捷记录失败 (${res.status})`, res.status);
        }
        const pushed = (await res.json()) as { nextCursor?: string };
        if (pushed.nextCursor) {
          ctx.recordSyncCursor(pushed.nextCursor);
        }
        return commitLocal(false);
      } catch (err) {
        if (isTransientSyncError(err)) {
          return commitLocal(true);
        }
        throw err;
      }
    });

  const client: NativeQuickNotesClient = {
    readState: async () => {
      if (!ctx.getCurrentScope()) return { notes: [] };
      await pullLatest();
      return sortedSnapshot();
    },
    createNote: async (payload: CreateQuickNoteInput) => {
      const now = String(Date.now());
      const content = payload.content || '';
      const title = (payload.title || '').replace(/\s+/g, ' ').trim() || titleFromContent(content);
      const created: QuickNote = {
        id: `note-${now}-${createUuid().slice(0, 8)}`,
        title: title.slice(0, 80),
        content,
        pinned: Boolean(payload.pinned),
        favorite: Boolean(payload.favorite),
        createdAt: now,
        updatedAt: now
      };
      return pushMutation(created, 'upsert');
    },
    updateNote: async (payload: UpdateQuickNoteInput) => {
      const existing = ctx.quickNotesById.get(payload.id);
      if (!existing) {
        throw new Error('[CRITICAL] Quick note not found in mobile sync cache');
      }
      const nextContent = payload.content !== undefined ? payload.content : existing.content;
      const nextTitle =
        payload.title !== undefined
          ? payload.title.replace(/\s+/g, ' ').trim() || titleFromContent(nextContent)
          : existing.title;
      const updated: QuickNote = {
        ...existing,
        title: nextTitle.slice(0, 80),
        content: nextContent,
        pinned: payload.pinned !== undefined ? payload.pinned : existing.pinned,
        favorite: payload.favorite !== undefined ? payload.favorite : existing.favorite,
        updatedAt: String(Date.now())
      };
      return pushMutation(updated, 'upsert');
    },
    deleteNote: async noteId =>
      pushMutation(
        {
          id: noteId,
          title: '',
          content: '',
          pinned: false,
          favorite: false,
          createdAt: '',
          updatedAt: ''
        },
        'delete'
      ),
    onUpdated: cb => {
      ctx.quickNoteListeners.add(cb);
      return () => ctx.quickNoteListeners.delete(cb);
    }
  };

  return {
    client,
    applyPulledNotes,
    emitLocalNotes: () => emitQuickNotes(sortedSnapshot()),
    clearAndEmitEmpty: () => emitQuickNotes({ notes: [] })
  };
}
