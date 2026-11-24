import React, { useEffect, useState } from 'react';
import { Check, Copy, ListTodo, Loader2, Pin, Plus, Save, Star, Trash2 } from 'lucide-react';
import { nativeClient } from '../../native/native-client';
import type { QuickNote } from '../../types/quick-note';
import { copyText, formatTimeLabel, titleFromContent } from '../notes/utils';

export const MobileQuickNotesView: React.FC = () => {
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [pinned, setPinned] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [todoNoticeId, setTodoNoticeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const state = await nativeClient.quickNotes.readState();
        if (!disposed) {
          setNotes(state.notes || []);
          setError(null);
        }
      } catch (err) {
        if (!disposed) {
          setError(`读取快捷记录失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      } finally {
        if (!disposed) setIsLoading(false);
      }
    };
    void load();

    const unsubscribeUpdated = nativeClient.quickNotes.onUpdated(state => {
      if (!disposed) {
        setNotes(state.notes || []);
      }
    });

    const unsubscribeAccount = nativeClient.accounts.onSessionChanged(() => {
      if (!disposed) {
        resetDraft();
        void load();
      }
    });

    return () => {
      disposed = true;
      unsubscribeUpdated?.();
      unsubscribeAccount?.();
    };
  }, []);

  const resetDraft = () => {
    setSelectedId(null);
    setTitle('');
    setContent('');
    setPinned(false);
    setFavorite(false);
  };

  const selectNote = (note: QuickNote) => {
    setSelectedId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setPinned(note.pinned);
    setFavorite(note.favorite);
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedContent = content.trim();
    const finalTitle = title.trim() || titleFromContent(trimmedContent);
    if (!finalTitle && !trimmedContent) return;

    setIsSaving(true);
    setError(null);
    try {
      const next = selectedId
        ? await nativeClient.quickNotes.updateNote({
            id: selectedId,
            title: finalTitle,
            content: trimmedContent,
            pinned,
            favorite
          })
        : await nativeClient.quickNotes.createNote({
            title: finalTitle,
            content: trimmedContent,
            pinned,
            favorite
          });
      setNotes(next.notes || []);
      resetDraft();
    } catch (err) {
      setError(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (noteId: string) => {
    try {
      const next = await nativeClient.quickNotes.deleteNote(noteId);
      setNotes(next.notes || []);
      if (selectedId === noteId) resetDraft();
    } catch (err) {
      setError(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCopy = async (note: QuickNote) => {
    const text = note.content.trim() || note.title;
    if (!text) return;
    try {
      await copyText(text);
      setCopiedId(note.id);
      window.setTimeout(() => setCopiedId(prev => (prev === note.id ? null : prev)), 1400);
    } catch (err) {
      setError(`复制失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleToTodo = async (note: QuickNote) => {
    try {
      await nativeClient.todos.createCard({
        title: note.title || titleFromContent(note.content),
        content: note.content,
        columnId: 'todo'
      });
      setTodoNoticeId(note.id);
      window.setTimeout(() => setTodoNoticeId(prev => (prev === note.id ? null : prev)), 1400);
    } catch (err) {
      setError(`转入待办失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-4 pb-20">
      <form
        onSubmit={event => void handleSave(event)}
        className="space-y-2.5 rounded-2xl border border-white/[0.08] bg-[#161925] p-3.5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-bold text-slate-100">
            {selectedId ? '编辑记录' : '新建云端速记'}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPinned(v => !v)}
              className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${
                pinned ? 'bg-amber-400/20 text-amber-200' : 'bg-white/[0.05] text-slate-400'
              }`}
            >
              <Pin size={12} className="mr-1 inline" />
              置顶
            </button>
            <button
              type="button"
              onClick={() => setFavorite(v => !v)}
              className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${
                favorite ? 'bg-fuchsia-400/20 text-fuchsia-200' : 'bg-white/[0.05] text-slate-400'
              }`}
            >
              <Star size={12} className="mr-1 inline" />
              收藏
            </button>
          </div>
        </div>
        <input
          value={title}
          onChange={event => setTitle(event.target.value)}
          placeholder="标题（留空取首行）..."
          className="h-9 w-full rounded-xl border border-white/[0.08] bg-white/[0.05] px-3 text-[13px] text-slate-100 outline-none placeholder:text-slate-500"
        />
        <textarea
          value={content}
          onChange={event => setContent(event.target.value)}
          rows={3}
          placeholder="记录灵感、片段、备忘，实时同步至桌面端..."
          className="w-full resize-y rounded-xl border border-white/[0.08] bg-white/[0.045] p-3 text-[12px] leading-5 text-slate-100 outline-none placeholder:text-slate-500"
        />
        <div className="flex justify-end gap-2">
          {selectedId && (
            <button
              type="button"
              onClick={resetDraft}
              className="rounded-xl border border-white/[0.08] bg-white/[0.05] px-3 py-1.5 text-[12px] text-slate-300"
            >
              取消编辑
            </button>
          )}
          <button
            type="submit"
            disabled={isSaving || (!title.trim() && !content.trim())}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500/25 px-3.5 py-1.5 text-[12px] font-bold text-sky-100 disabled:opacity-40"
          >
            {isSaving ? (
              <Loader2 size={13} className="animate-spin" />
            ) : selectedId ? (
              <Save size={13} />
            ) : (
              <Plus size={13} />
            )}
            {selectedId ? '保存修改' : '保存速记'}
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-3 rounded-xl border border-rose-400/25 bg-rose-500/15 px-3 py-2 text-[12px] text-rose-100">
          {error}
        </div>
      )}

      <div className="mt-4 space-y-2.5">
        {isLoading ? (
          <div className="rounded-2xl border border-dashed border-white/[0.1] p-6 text-center text-[12px] text-slate-500">
            正在同步快捷记录...
          </div>
        ) : notes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/[0.1] p-6 text-center text-[12px] text-slate-500">
            云端暂无快捷记录，可在上方新建并同步到电脑端
          </div>
        ) : (
          notes.map(note => (
            <div
              key={note.id}
              onClick={() => selectNote(note)}
              className={`rounded-2xl border p-3.5 transition-colors ${
                selectedId === note.id
                  ? 'border-sky-400/35 bg-sky-500/10'
                  : 'border-white/[0.08] bg-[#161925]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold text-slate-100">{note.title}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    {formatTimeLabel(note.updatedAt)}
                    {note.pinned ? ' · 已置顶' : ''}
                    {note.favorite ? ' · 已收藏' : ''}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={event => {
                      event.stopPropagation();
                      void handleToTodo(note);
                    }}
                    title="转为待办卡片"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100"
                  >
                    {todoNoticeId === note.id ? (
                      <Check size={14} className="text-emerald-300" />
                    ) : (
                      <ListTodo size={14} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={event => {
                      event.stopPropagation();
                      void handleCopy(note);
                    }}
                    title="复制内容"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100"
                  >
                    {copiedId === note.id ? (
                      <Check size={14} className="text-emerald-300" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={event => {
                      event.stopPropagation();
                      void handleDelete(note.id);
                    }}
                    title="删除"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-200"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              {note.content && (
                <div className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-5 text-slate-300">
                  {note.content}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
