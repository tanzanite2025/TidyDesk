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

export interface WebQuickNotesModule {
  client: NativeQuickNotesClient;
  applyPulledNotes: (notes?: QuickNote[], removedIds?: string[]) => void;
  clearAndEmitEmpty: () => void;
}

export function createWebQuickNotesModule(
  ctx: WebHttpContext,
  pullLatest: () => Promise<TodoState>
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
    emitQuickNotes(sortedSnapshot());
  };

  const pushMutation = async (
    note: QuickNote,
    operation: 'upsert' | 'delete'
  ): Promise<QuickNotesState> => {
    const active = ctx.requireSession();
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
            payload:
              operation === 'delete'
                ? { id: note.id, deletedAt: String(Date.now()) }
                : note
          }
        ]
      })
    });
    if (!res.ok) {
      throw new Error(`同步快捷记录失败 (${res.status})`);
    }
    const pushed = (await res.json()) as { nextCursor?: string };
    if (pushed.nextCursor) {
      ctx.recordSyncCursor(pushed.nextCursor);
    }
    if (operation === 'delete') {
      ctx.quickNotesById.delete(note.id);
    } else {
      ctx.quickNotesById.set(note.id, note);
    }
    const next = sortedSnapshot();
    emitQuickNotes(next);
    return next;
  };

  const client: NativeQuickNotesClient = {
    readState: async () => {
      if (!ctx.getSession()) return { notes: [] };
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
    clearAndEmitEmpty: () => emitQuickNotes({ notes: [] })
  };
}
