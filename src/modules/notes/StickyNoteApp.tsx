import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckSquare, Copy, ListChecks, ListTodo, Loader2, Pin, Square, X } from 'lucide-react';
import { nativeClient } from '../../native/native-client';
import type { QuickNote, StickyNoteColor, StickyNoteRecord } from '../../types/quick-note';
import {
  appendChecklistLine,
  copyText,
  formatTimeLabel,
  parseChecklistItems,
  parseStickyLocalDraft,
  stickyDraftStorageKey,
  timestampNumber,
  titleFromContent,
  toggleChecklistLine
} from './utils';

interface StickyTheme {
  shell: string;
  header: string;
  footer: string;
  dot: string;
  accentText: string;
}

const STICKY_THEMES: Record<StickyNoteColor, StickyTheme> = {
  amber: {
    shell: 'border-amber-300/30 bg-[#251f12] text-amber-50',
    header: 'border-amber-300/15 bg-[#312817]',
    footer: 'border-amber-300/15 bg-[#2c2415]',
    dot: 'bg-amber-400',
    accentText: 'text-amber-200/70'
  },
  slate: {
    shell: 'border-white/[0.14] bg-[#151824] text-slate-100',
    header: 'border-white/[0.08] bg-[#1b1f2e]',
    footer: 'border-white/[0.08] bg-[#181c29]',
    dot: 'bg-slate-400',
    accentText: 'text-slate-400'
  },
  sky: {
    shell: 'border-sky-300/30 bg-[#111e2e] text-sky-50',
    header: 'border-sky-300/15 bg-[#16283b]',
    footer: 'border-sky-300/15 bg-[#142334]',
    dot: 'bg-sky-400',
    accentText: 'text-sky-200/70'
  },
  mint: {
    shell: 'border-emerald-300/30 bg-[#11231d] text-emerald-50',
    header: 'border-emerald-300/15 bg-[#162e26]',
    footer: 'border-emerald-300/15 bg-[#142821]',
    dot: 'bg-emerald-400',
    accentText: 'text-emerald-200/70'
  }
};

const COLOR_OPTIONS: Array<{ id: StickyNoteColor; label: string }> = [
  { id: 'amber', label: '暖黄' },
  { id: 'slate', label: '深灰' },
  { id: 'sky', label: '晴蓝' },
  { id: 'mint', label: '薄荷' }
];

const AUTOSAVE_DELAY_MS = 450;

/**
 * Standalone floating sticky note window ("Windows Sticky Notes" style):
 * editable by default, 450ms debounced autosave + localStorage crash-recovery backup,
 * synced in real time with QuickNotes, checklist toggling, and Todo promotion.
 */
export const StickyNoteApp: React.FC = () => {
  const noteId = new URLSearchParams(window.location.search).get('noteId')?.trim() || '';

  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [stickyRecord, setStickyRecord] = useState<StickyNoteRecord | null>(null);
  const [updatedAt, setUpdatedAt] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [copied, setCopied] = useState(false);
  const [convertedTodo, setConvertedTodo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noteMetaRef = useRef<{ pinned: boolean; favorite: boolean }>({
    pinned: false,
    favorite: false
  });
  const draftRef = useRef<{ title: string; content: string }>({ title: '', content: '' });
  const draftScopeRef = useRef('local:default');
  const dirtyRef = useRef(false);
  const editSequenceRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const inFlightSaveRef = useRef<Promise<void> | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const contentInputRef = useRef<HTMLTextAreaElement | null>(null);

  const checklistItems = useMemo(() => parseChecklistItems(draftContent), [draftContent]);

  const persistLocalDraft = useCallback(
    (title: string, content: string) => {
      if (!noteId) return;
      try {
        localStorage.setItem(
          stickyDraftStorageKey(noteId, draftScopeRef.current),
          JSON.stringify({
            noteId,
            title,
            content,
            savedAt: Date.now()
          })
        );
      } catch (err) {
        console.warn('[TIDYDESK][STICKY] Failed to write local draft backup:', err);
      }
    },
    [noteId]
  );

  const clearLocalDraft = useCallback(() => {
    if (!noteId) return;
    try {
      localStorage.removeItem(stickyDraftStorageKey(noteId, draftScopeRef.current));
    } catch (err) {
      console.warn('[TIDYDESK][STICKY] Failed to clear local draft backup:', err);
    }
  }, [noteId]);

  const applyRemoteNote = useCallback((note: QuickNote) => {
    noteMetaRef.current = { pinned: note.pinned, favorite: note.favorite };
    setUpdatedAt(note.updatedAt);

    if (dirtyRef.current) {
      return;
    }

    const activeElement = document.activeElement;
    if (activeElement !== titleInputRef.current) {
      setDraftTitle(note.title);
      draftRef.current.title = note.title;
    }
    if (activeElement !== contentInputRef.current) {
      setDraftContent(note.content);
      draftRef.current.content = note.content;
    }
  }, []);

  const flushSave = useCallback(async () => {
    if (!noteId) return;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (inFlightSaveRef.current) {
      await inFlightSaveRef.current;
    }

    if (!dirtyRef.current) return;

    const runSave = async () => {
      const sequenceAtStart = editSequenceRef.current;
      const { title, content } = draftRef.current;
      setIsSaving(true);
      setError(null);
      try {
        const nextState = await nativeClient.quickNotes.updateNote({
          id: noteId,
          title,
          content,
          pinned: noteMetaRef.current.pinned,
          favorite: noteMetaRef.current.favorite
        });
        const updatedNote = nextState.notes.find(item => item.id === noteId);
        if (updatedNote) {
          noteMetaRef.current = {
            pinned: updatedNote.pinned,
            favorite: updatedNote.favorite
          };
          setUpdatedAt(updatedNote.updatedAt);
        }
        if (editSequenceRef.current === sequenceAtStart) {
          dirtyRef.current = false;
          setIsDirty(false);
          clearLocalDraft();
          if (updatedNote && document.activeElement !== titleInputRef.current) {
            setDraftTitle(updatedNote.title);
            draftRef.current.title = updatedNote.title;
          }
        } else {
          dirtyRef.current = true;
          setIsDirty(true);
        }
      } catch (err) {
        setError(`自动保存失败: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsSaving(false);
      }
    };

    const promise = runSave();
    inFlightSaveRef.current = promise;
    try {
      await promise;
    } finally {
      if (inFlightSaveRef.current === promise) {
        inFlightSaveRef.current = null;
      }
    }

    if (dirtyRef.current) {
      await flushSave();
    }
  }, [clearLocalDraft, noteId]);

  const scheduleAutoSave = useCallback(() => {
    dirtyRef.current = true;
    editSequenceRef.current += 1;
    setIsDirty(true);
    persistLocalDraft(draftRef.current.title, draftRef.current.content);
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushSave();
    }, AUTOSAVE_DELAY_MS);
  }, [flushSave, persistLocalDraft]);

  useEffect(() => {
    if (!noteId) {
      setIsLoading(false);
      setError('[CRITICAL] 缺少便签 noteId 参数，无法加载桌面便签。');
      return;
    }

    let disposed = false;
    const loadInitial = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [notesState, stickiesState, sessionSnap] = await Promise.all([
          nativeClient.quickNotes.readState(),
          nativeClient.stickyNotes.list(),
          nativeClient.accounts.getSession()
        ]);
        if (disposed) return;

        draftScopeRef.current = `${sessionSnap.activeUserId || 'local'}:${sessionSnap.workspaceId || 'default'}`;
        const targetNote = notesState.notes.find(item => item.id === noteId);
        if (!targetNote) {
          clearLocalDraft();
          setError('未找到对应记录，可能已被删除。');
          return;
        }

        noteMetaRef.current = {
          pinned: targetNote.pinned,
          favorite: targetNote.favorite
        };

        let restoredTitle = targetNote.title;
        let restoredContent = targetNote.content;
        let hasUnsavedCrashDraft = false;
        try {
          const localDraft = parseStickyLocalDraft(
            localStorage.getItem(stickyDraftStorageKey(noteId, draftScopeRef.current)),
            noteId
          );
          if (
            localDraft &&
            localDraft.savedAt > timestampNumber(targetNote.updatedAt) &&
            (localDraft.title !== targetNote.title || localDraft.content !== targetNote.content)
          ) {
            restoredTitle = localDraft.title;
            restoredContent = localDraft.content;
            hasUnsavedCrashDraft = true;
          } else if (localDraft) {
            clearLocalDraft();
          }
        } catch (err) {
          console.warn('[TIDYDESK][STICKY] Discarding invalid local draft backup:', err);
          clearLocalDraft();
        }

        draftRef.current = {
          title: restoredTitle,
          content: restoredContent
        };
        setDraftTitle(restoredTitle);
        setDraftContent(restoredContent);
        setUpdatedAt(targetNote.updatedAt);

        const targetSticky = stickiesState.stickies.find(item => item.noteId === noteId) || null;
        setStickyRecord(targetSticky);

        if (hasUnsavedCrashDraft) {
          scheduleAutoSave();
        }
      } catch (err) {
        if (!disposed) {
          setError(`读取桌面便签失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      } finally {
        if (!disposed) {
          setIsLoading(false);
        }
      }
    };

    void loadInitial();

    const unsubscribeNotes = nativeClient.quickNotes.onUpdated(state => {
      if (disposed) return;
      const updated = state.notes.find(item => item.id === noteId);
      if (updated) {
        applyRemoteNote(updated);
      } else {
        clearLocalDraft();
        setError('该记录已在主列表中删除');
      }
    });

    const unsubscribeStickies = nativeClient.stickyNotes.onUpdated(state => {
      if (disposed) return;
      const updated = state.stickies.find(item => item.noteId === noteId) || null;
      if (updated) {
        setStickyRecord(updated);
      }
    });

    const handleBlur = () => {
      void flushSave();
    };
    window.addEventListener('blur', handleBlur);
    window.addEventListener('beforeunload', handleBlur);

    return () => {
      disposed = true;
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('beforeunload', handleBlur);
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      unsubscribeNotes?.();
      unsubscribeStickies?.();
    };
  }, [applyRemoteNote, clearLocalDraft, flushSave, noteId, scheduleAutoSave]);

  const activeColor: StickyNoteColor = stickyRecord?.color || 'amber';
  const theme = STICKY_THEMES[activeColor] || STICKY_THEMES.amber;
  const alwaysOnTop = Boolean(stickyRecord?.alwaysOnTop);

  const handleTitleChange = (value: string) => {
    setDraftTitle(value);
    draftRef.current.title = value;
    scheduleAutoSave();
  };

  const handleContentChange = (value: string) => {
    setDraftContent(value);
    draftRef.current.content = value;
    scheduleAutoSave();
  };

  const handleInsertChecklist = () => {
    const next = appendChecklistLine(draftRef.current.content);
    setDraftContent(next);
    draftRef.current.content = next;
    scheduleAutoSave();
    window.setTimeout(() => {
      contentInputRef.current?.focus();
    }, 0);
  };

  const handleToggleChecklist = (lineIndex: number) => {
    const next = toggleChecklistLine(draftRef.current.content, lineIndex);
    setDraftContent(next);
    draftRef.current.content = next;
    scheduleAutoSave();
  };

  const handleConvertToTodo = async () => {
    await flushSave();
    const content = draftRef.current.content.trim();
    const title = draftRef.current.title.trim() || titleFromContent(content);
    if (!title && !content) return;
    try {
      await nativeClient.todos.createCard({ title, content, columnId: 'todo' });
      setConvertedTodo(true);
      window.setTimeout(() => setConvertedTodo(false), 1600);
    } catch (err) {
      setError(`转入待办失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleToggleTop = async () => {
    if (!noteId) return;
    const nextTop = !alwaysOnTop;
    setStickyRecord(prev => (prev ? { ...prev, alwaysOnTop: nextTop } : prev));
    try {
      const next = await nativeClient.stickyNotes.updateOptions({
        noteId,
        alwaysOnTop: nextTop
      });
      const updated = next.stickies.find(item => item.noteId === noteId) || null;
      if (updated) setStickyRecord(updated);
    } catch (err) {
      setStickyRecord(prev => (prev ? { ...prev, alwaysOnTop: !nextTop } : prev));
      setError(`切换置顶失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleChangeColor = async (color: StickyNoteColor) => {
    if (!noteId || color === activeColor) return;
    const previousColor = activeColor;
    setStickyRecord(prev => (prev ? { ...prev, color } : prev));
    try {
      const next = await nativeClient.stickyNotes.updateOptions({ noteId, color });
      const updated = next.stickies.find(item => item.noteId === noteId) || null;
      if (updated) setStickyRecord(updated);
    } catch (err) {
      setStickyRecord(prev => (prev ? { ...prev, color: previousColor } : prev));
      setError(`切换配色失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCopy = async () => {
    await flushSave();
    const payload = draftRef.current.content.trim() || draftRef.current.title.trim();
    if (!payload) return;
    try {
      await copyText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch (err) {
      setError(`复制失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleUnpin = async () => {
    if (!noteId) return;
    await flushSave();
    clearLocalDraft();
    try {
      await nativeClient.stickyNotes.unpin(noteId);
    } catch (err) {
      setError(`收起便签失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const statusText = isSaving
    ? '保存中...'
    : isDirty
      ? '待保存'
      : updatedAt
        ? `已保存 · ${formatTimeLabel(updatedAt)}`
        : '实时同步';

  return (
    <div
      className={`flex h-screen w-full flex-col overflow-hidden rounded-xl border shadow-2xl ${theme.shell}`}
      onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          void flushSave();
        }
      }}
    >
      {/* 顶栏：可拖拽移动 + 配色点 + 图钉置顶 / 复制 / 收起 */}
      <header
        className={`flex shrink-0 select-none items-center justify-between gap-2 border-b px-3 py-2 ${theme.header}`}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div
          className="flex min-w-0 items-center gap-1.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {COLOR_OPTIONS.map(option => {
            const optionDot = STICKY_THEMES[option.id].dot;
            const isSelected = option.id === activeColor;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => void handleChangeColor(option.id)}
                title={`切换为${option.label}`}
                className={`h-3 w-3 rounded-full transition-transform ${optionDot} ${
                  isSelected
                    ? 'scale-110 ring-2 ring-white/75 ring-offset-1 ring-offset-transparent'
                    : 'opacity-55 hover:opacity-95'
                }`}
              />
            );
          })}
          <span className={`ml-1.5 truncate text-[10px] ${theme.accentText}`}>{statusText}</span>
        </div>

        <div
          className="flex shrink-0 items-center gap-0.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={() => void handleToggleTop()}
            title={alwaysOnTop ? '取消总在最前' : '总在最前（图钉）'}
            className={`rounded-md p-1.5 transition-colors ${
              alwaysOnTop
                ? 'bg-amber-400/25 text-amber-200'
                : 'text-slate-400 hover:bg-white/[0.08] hover:text-slate-100'
            }`}
          >
            <Pin size={13} className={alwaysOnTop ? 'fill-current' : ''} />
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            title="复制全文"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/[0.08] hover:text-slate-100"
          >
            {copied ? <Check size={13} className="text-emerald-300" /> : <Copy size={13} />}
          </button>
          <button
            type="button"
            onClick={() => void handleUnpin()}
            title="从桌面收起（保留快捷记录）"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-500/20 hover:text-rose-200"
          >
            <X size={13} />
          </button>
        </div>
      </header>

      {/* 默认可编辑主区 */}
      {isLoading ? (
        <div className="grid flex-1 place-items-center text-[12px] text-slate-400">
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            正在打开桌面便签...
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-3 pb-2">
          <input
            ref={titleInputRef}
            value={draftTitle}
            onChange={event => handleTitleChange(event.target.value)}
            onBlur={() => void flushSave()}
            placeholder="便签标题..."
            className="w-full min-w-0 shrink-0 rounded-lg bg-transparent px-1.5 py-1 text-[14px] font-bold tracking-tight outline-none placeholder:text-white/30 focus:bg-black/15"
          />
          <textarea
            ref={contentInputRef}
            value={draftContent}
            onChange={event => handleContentChange(event.target.value)}
            onBlur={() => void flushSave()}
            placeholder="直接在桌面便签输入内容，支持 - [ ] 清单项，自动实时保存..."
            className="min-h-0 w-full min-w-0 flex-1 resize-none rounded-lg bg-transparent px-1.5 py-1 text-[12.5px] leading-6 outline-none placeholder:text-white/30 focus:bg-black/15"
          />
          {checklistItems.length > 0 && (
            <div className="max-h-24 shrink-0 space-y-1 overflow-y-auto rounded-lg border border-white/[0.08] bg-black/20 p-2">
              {checklistItems.map(item => (
                <button
                  key={item.lineIndex}
                  type="button"
                  onClick={() => handleToggleChecklist(item.lineIndex)}
                  className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] hover:bg-white/[0.06]"
                >
                  {item.checked ? (
                    <CheckSquare size={12} className="shrink-0 text-emerald-300" />
                  ) : (
                    <Square size={12} className="shrink-0 text-white/50" />
                  )}
                  <span
                    className={`truncate ${
                      item.checked ? 'text-white/40 line-through' : 'text-white/85'
                    }`}
                  >
                    {item.text || '（空清单项）'}
                  </span>
                </button>
              ))}
            </div>
          )}
          {error && (
            <div className="shrink-0 rounded-md bg-rose-500/15 px-2 py-1 text-[11px] text-rose-200">
              {error}
            </div>
          )}
        </div>
      )}

      {/* 底部轻量动作条 */}
      <footer
        className={`flex shrink-0 items-center justify-between gap-2 border-t px-3 py-1.5 text-[10px] ${theme.footer}`}
      >
        <button
          type="button"
          onClick={handleInsertChecklist}
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-white/70 hover:bg-white/[0.08] hover:text-white"
          title="插入可勾选清单项 (- [ ])"
        >
          <ListChecks size={12} />
          清单项
        </button>
        <button
          type="button"
          onClick={() => void handleConvertToTodo()}
          disabled={!draftTitle.trim() && !draftContent.trim()}
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-white/70 hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
          title="复制一份到待办看板"
        >
          {convertedTodo ? (
            <>
              <Check size={12} className="text-emerald-300" />
              <span className="text-emerald-200">已转待办</span>
            </>
          ) : (
            <>
              <ListTodo size={12} />
              转待办
            </>
          )}
        </button>
      </footer>
    </div>
  );
};
