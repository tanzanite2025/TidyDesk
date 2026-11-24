import { useEffect, useMemo, useRef, useState } from 'react';
import { nativeClient } from '../../native/native-client';
import type { QuickNote, QuickNotesState, StickyNotesState } from '../../types/quick-note';
import {
  SortMode,
  titleFromContent,
  copyText,
  noteMatchesQuery,
  buildSections
} from './utils';

export function useQuickNotes() {
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [stuckNoteIds, setStuckNoteIds] = useState<Set<string>>(() => new Set());
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [draftTitle, setDraftTitleState] = useState('');
  const [draftContent, setDraftContentState] = useState('');
  const [draftPinned, setDraftPinnedState] = useState(false);
  const [draftFavorite, setDraftFavoriteState] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isImportingClipboard, setIsImportingClipboard] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('updated');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const draftRef = useRef({ title: '', content: '' });
  const selectedNoteIdRef = useRef<string | null>(null);
  const panelDirtyRef = useRef(false);

  const selectedNote = useMemo(
    () => notes.find(note => note.id === selectedNoteId) || null,
    [notes, selectedNoteId]
  );

  const setDraftTitle = (value: string | ((prev: string) => string)) => {
    panelDirtyRef.current = true;
    setDraftTitleState(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      draftRef.current.title = next;
      return next;
    });
  };

  const setDraftContent = (value: string | ((prev: string) => string)) => {
    panelDirtyRef.current = true;
    setDraftContentState(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      draftRef.current.content = next;
      return next;
    });
  };

  const setDraftPinned = (value: boolean | ((prev: boolean) => boolean)) => {
    panelDirtyRef.current = true;
    setDraftPinnedState(value);
  };

  const setDraftFavorite = (value: boolean | ((prev: boolean) => boolean)) => {
    panelDirtyRef.current = true;
    setDraftFavoriteState(value);
  };

  function applyStickiesState(state: StickyNotesState) {
    setStuckNoteIds(new Set((state.stickies || []).map(item => item.noteId)));
  }

  function applyState(state: QuickNotesState, preferredId?: string | null) {
    const nextNotes = [...(state.notes || [])];
    const activeId = preferredId === undefined ? selectedNoteIdRef.current : preferredId;
    const activeNote = (activeId ? nextNotes.find(note => note.id === activeId) : null) || nextNotes[0] || null;
    const nextSelectedId = activeNote?.id || null;
    selectedNoteIdRef.current = nextSelectedId;
    panelDirtyRef.current = false;
    draftRef.current = {
      title: activeNote?.title || '',
      content: activeNote?.content || ''
    };
    setNotes(nextNotes);
    setSelectedNoteId(nextSelectedId);
    setDraftTitleState(activeNote?.title || '');
    setDraftContentState(activeNote?.content || '');
    setDraftPinnedState(activeNote?.pinned || false);
    setDraftFavoriteState(activeNote?.favorite || false);
  }

  async function preloadClipboardDraft(mode: 'auto' | 'manual' = 'manual') {
    setIsImportingClipboard(true);
    try {
      const text = (await nativeClient.clipboard.readText()).trim();
      if (!text) {
        if (mode === 'manual') {
          setNotice('当前剪贴板没有可用文本');
          setError(null);
        }
        return false;
      }

      const nextTitle = titleFromContent(text);
      selectedNoteIdRef.current = null;
      panelDirtyRef.current = true;
      draftRef.current = { title: nextTitle, content: text };
      setSelectedNoteId(null);
      setDraftTitleState(nextTitle);
      setDraftContentState(text);
      setDraftPinnedState(false);
      setDraftFavoriteState(false);
      setError(null);
      setNotice(mode === 'auto' ? '已自动带入剪贴板内容，可直接保存成记录' : '已带入当前剪贴板文本');
      return true;
    } catch (err) {
      if (mode === 'manual') {
        setError(`读取剪贴板失败: ${err instanceof Error ? err.message : String(err)}`);
      }
      return false;
    } finally {
      setIsImportingClipboard(false);
    }
  }

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [notesState, stickiesState] = await Promise.all([
          nativeClient.quickNotes.readState(),
          nativeClient.stickyNotes.list()
        ]);
        if (disposed) return;
        applyState(notesState, null);
        applyStickiesState(stickiesState);
      } catch (err) {
        if (disposed) return;
        setError(`读取快捷记录失败: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (!disposed) setIsLoading(false);
      }
    };

    void load();

    const unsubscribeCaptureOpened = nativeClient.capture.onOpened(payload => {
      if (disposed) return;
      const text = (payload.clipboardText || '').trim();
      if (!text) return;
      if (draftRef.current.title.trim() || draftRef.current.content.trim()) {
        setNotice('检测到剪贴板文本，未自动覆盖当前草稿；点击“剪贴板”可导入。');
        return;
      }
      const nextTitle = titleFromContent(text);
      selectedNoteIdRef.current = null;
      panelDirtyRef.current = true;
      draftRef.current = { title: nextTitle, content: text };
      setSelectedNoteId(null);
      setDraftTitleState(nextTitle);
      setDraftContentState(text);
      setDraftPinnedState(false);
      setDraftFavoriteState(false);
      setError(null);
      setNotice('已带入当前剪贴板文本');
    });

    const unsubscribeNotesUpdated = nativeClient.quickNotes.onUpdated(state => {
      if (disposed) return;
      const nextNotes = [...(state.notes || [])];
      setNotes(nextNotes);
      const currentId = selectedNoteIdRef.current;
      if (!currentId) return;
      const updatedCurrent = nextNotes.find(note => note.id === currentId);
      if (!updatedCurrent) {
        applyState(state, null);
        return;
      }
      if (!panelDirtyRef.current) {
        draftRef.current = {
          title: updatedCurrent.title,
          content: updatedCurrent.content
        };
        setDraftTitleState(updatedCurrent.title);
        setDraftContentState(updatedCurrent.content);
        setDraftPinnedState(updatedCurrent.pinned);
        setDraftFavoriteState(updatedCurrent.favorite);
      }
    });

    const unsubscribeStickiesUpdated = nativeClient.stickyNotes.onUpdated(state => {
      if (disposed) return;
      applyStickiesState(state);
    });

    const unsubscribeAccountChanged = nativeClient.isAvailable()
      ? nativeClient.accounts.onSessionChanged(() => {
          if (disposed) return;
          setNotice(null);
          setError(null);
          void load();
        })
      : undefined;

    return () => {
      disposed = true;
      unsubscribeCaptureOpened?.();
      unsubscribeNotesUpdated?.();
      unsubscribeStickiesUpdated?.();
      unsubscribeAccountChanged?.();
    };
  }, []);

  const beginNewNote = () => {
    selectedNoteIdRef.current = null;
    panelDirtyRef.current = false;
    draftRef.current = { title: '', content: '' };
    setSelectedNoteId(null);
    setDraftTitleState('');
    setDraftContentState('');
    setDraftPinnedState(false);
    setDraftFavoriteState(false);
    setError(null);
    setNotice(null);
  };

  const selectNote = (note: QuickNote) => {
    selectedNoteIdRef.current = note.id;
    panelDirtyRef.current = false;
    draftRef.current = { title: note.title, content: note.content };
    setSelectedNoteId(note.id);
    setDraftTitleState(note.title);
    setDraftContentState(note.content);
    setDraftPinnedState(note.pinned);
    setDraftFavoriteState(note.favorite);
    setNotice(null);
    setError(null);
  };

  const saveNote = async (): Promise<QuickNote | null> => {
    const title = draftTitle.trim() || titleFromContent(draftContent);
    const content = draftContent.trim();
    if (!title && !content) return null;

    setIsSaving(true);
    setError(null);
    try {
      const currentSelectedId = selectedNoteIdRef.current;
      const beforeIds = new Set(notes.map(item => item.id));
      const state = currentSelectedId
        ? await nativeClient.quickNotes.updateNote({
            id: currentSelectedId,
            title,
            content,
            pinned: draftPinned,
            favorite: draftFavorite
          })
        : await nativeClient.quickNotes.createNote({
            title,
            content,
            pinned: draftPinned,
            favorite: draftFavorite
          });
      const createdNote = !currentSelectedId
        ? state.notes.find(item => !beforeIds.has(item.id)) || state.notes[0]
        : null;
      const nextSelectedId = currentSelectedId || createdNote?.id || null;
      applyState(state, nextSelectedId);
      setNotice(currentSelectedId ? '记录已保存' : '记录已创建');
      return state.notes.find(item => item.id === nextSelectedId) || null;
    } catch (err) {
      setError(`保存记录失败: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const removeNote = async (noteId: string) => {
    try {
      const state = await nativeClient.quickNotes.deleteNote(noteId);
      applyState(state, selectedNoteIdRef.current === noteId ? null : selectedNoteIdRef.current);
      setNotice('记录已删除');
      setError(null);
    } catch (err) {
      setError(`删除记录失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const copyNote = async (note: QuickNote) => {
    const payload = note.content.trim() || note.title;
    if (!payload) return;

    try {
      await copyText(payload);
      setNotice(`已复制：${note.title}`);
      setError(null);
    } catch (err) {
      setError(`复制失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const stickNoteToDesktop = async (noteId: string) => {
    try {
      const nextState = await nativeClient.stickyNotes.open(noteId);
      applyStickiesState(nextState);
      setNotice('已贴到桌面（支持直接编辑，重启自动恢复）');
      setError(null);
    } catch (err) {
      setError(`贴到桌面失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const unstickNoteFromDesktop = async (noteId: string) => {
    try {
      const nextState = await nativeClient.stickyNotes.unpin(noteId);
      applyStickiesState(nextState);
      setNotice('已从桌面收起，记录保留在列表中');
      setError(null);
    } catch (err) {
      setError(`收起桌面便签失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const stickCurrentDraftToDesktop = async () => {
    const currentId = selectedNoteIdRef.current;
    if (currentId && !panelDirtyRef.current) {
      if (stuckNoteIds.has(currentId)) {
        await unstickNoteFromDesktop(currentId);
      } else {
        await stickNoteToDesktop(currentId);
      }
      return;
    }

    const saved = await saveNote();
    if (saved) {
      await stickNoteToDesktop(saved.id);
    }
  };

  const convertCurrentDraftToTodo = async () => {
    const content = draftRef.current.content.trim();
    const title = draftRef.current.title.trim() || titleFromContent(content);
    if (!title && !content) return;
    try {
      await nativeClient.todos.createCard({ title, content, columnId: 'todo' });
      setNotice(`已转入待办看板：${title}`);
      setError(null);
    } catch (err) {
      setError(`转入待办失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const filteredNotes = useMemo(
    () => notes.filter(note => noteMatchesQuery(note, searchQuery)),
    [notes, searchQuery]
  );

  const noteSections = useMemo(
    () => buildSections(filteredNotes, sortMode),
    [filteredNotes, sortMode]
  );

  return {
    notes,
    stuckNoteIds,
    selectedNoteId,
    selectedNote,
    draftTitle,
    setDraftTitle,
    draftContent,
    setDraftContent,
    draftPinned,
    setDraftPinned,
    draftFavorite,
    setDraftFavorite,
    isLoading,
    isSaving,
    isImportingClipboard,
    searchQuery,
    setSearchQuery,
    sortMode,
    setSortMode,
    notice,
    setNotice,
    error,
    setError,
    filteredNotes,
    noteSections,
    preloadClipboardDraft,
    beginNewNote,
    selectNote,
    saveNote,
    removeNote,
    copyNote,
    stickNoteToDesktop,
    unstickNoteFromDesktop,
    stickCurrentDraftToDesktop,
    convertCurrentDraftToTodo
  };
}
