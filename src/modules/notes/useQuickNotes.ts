import { useEffect, useMemo, useState } from 'react';
import { nativeClient } from '../../native/native-client';
import type { QuickNote, QuickNotesState } from '../../types/quick-note';
import {
  SortMode,
  titleFromContent,
  copyText,
  noteMatchesQuery,
  buildSections
} from './utils';

export function useQuickNotes() {
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [draftPinned, setDraftPinned] = useState(false);
  const [draftFavorite, setDraftFavorite] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isImportingClipboard, setIsImportingClipboard] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('updated');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedNote = useMemo(
    () => notes.find(note => note.id === selectedNoteId) || null,
    [notes, selectedNoteId]
  );

  function applyState(state: QuickNotesState, preferredId?: string | null) {
    const nextNotes = [...(state.notes || [])];
    const activeId = preferredId === undefined ? selectedNoteId : preferredId;
    const activeNote = (activeId ? nextNotes.find(note => note.id === activeId) : null) || nextNotes[0] || null;
    setNotes(nextNotes);
    setSelectedNoteId(activeNote?.id || null);
    setDraftTitle(activeNote?.title || '');
    setDraftContent(activeNote?.content || '');
    setDraftPinned(activeNote?.pinned || false);
    setDraftFavorite(activeNote?.favorite || false);
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

      setSelectedNoteId(null);
      setDraftTitle(titleFromContent(text));
      setDraftContent(text);
      setDraftPinned(false);
      setDraftFavorite(false);
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
        const state = await nativeClient.quickNotes.readState();
        if (disposed) return;
        applyState(state, null);
        const clipboardText = (await nativeClient.clipboard.readText().catch(() => '')).trim();
        if (disposed || !clipboardText) return;
        setSelectedNoteId(null);
        setDraftTitle(titleFromContent(clipboardText));
        setDraftContent(clipboardText);
        setDraftPinned(false);
        setDraftFavorite(false);
        setNotice('已自动带入剪贴板内容，可直接保存成记录');
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
      setSelectedNoteId(null);
      setDraftTitle(titleFromContent(text));
      setDraftContent(text);
      setDraftPinned(false);
      setDraftFavorite(false);
      setError(null);
      setNotice('已带入当前剪贴板文本');
    });

    return () => {
      disposed = true;
      unsubscribeCaptureOpened?.();
    };
  }, []);

  const beginNewNote = () => {
    setSelectedNoteId(null);
    setDraftTitle('');
    setDraftContent('');
    setDraftPinned(false);
    setDraftFavorite(false);
    setError(null);
    setNotice(null);
    void preloadClipboardDraft('manual');
  };

  const selectNote = (note: QuickNote) => {
    setSelectedNoteId(note.id);
    setDraftTitle(note.title);
    setDraftContent(note.content);
    setDraftPinned(note.pinned);
    setDraftFavorite(note.favorite);
    setNotice(null);
    setError(null);
  };

  const saveNote = async () => {
    const title = draftTitle.trim() || titleFromContent(draftContent);
    const content = draftContent.trim();
    if (!title && !content) return;

    setIsSaving(true);
    setError(null);
    try {
      const state = selectedNoteId
        ? await nativeClient.quickNotes.updateNote({ id: selectedNoteId, title, content, pinned: draftPinned, favorite: draftFavorite })
        : await nativeClient.quickNotes.createNote({ title, content, pinned: draftPinned, favorite: draftFavorite });
      const nextSelectedId = selectedNoteId || state.notes[0]?.id || null;
      applyState(state, nextSelectedId);
      setNotice(selectedNoteId ? '记录已保存' : '记录已创建');
    } catch (err) {
      setError(`保存记录失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const removeNote = async (noteId: string) => {
    try {
      const state = await nativeClient.quickNotes.deleteNote(noteId);
      applyState(state, selectedNoteId === noteId ? null : selectedNoteId);
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
    copyNote
  };
}
