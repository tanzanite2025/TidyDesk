import React from 'react';
import { Clipboard, Copy, Loader2, NotebookPen, Pin, Plus, Save, Search, Star, Trash2 } from 'lucide-react';
import { useQuickNotes } from './useQuickNotes';
import { formatTimeLabel, notePreview, SortMode } from './utils';

export const QuickNotesPanel: React.FC = () => {
  const {
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
    error,
    filteredNotes,
    noteSections,
    preloadClipboardDraft,
    beginNewNote,
    selectNote,
    saveNote,
    removeNote,
    copyNote
  } = useQuickNotes();

  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pb-4">
      <div className="rounded-lg border border-sky-400/15 bg-sky-400/10 p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-sky-400/15 text-sky-100">
            <NotebookPen size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold text-slate-100">快捷记录</div>
            <div className="mt-1 text-[11px] leading-4 text-slate-400">写临时想法、命令片段、项目备注。每条记录都会保存成卡片，并支持一键复制。</div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-white/[0.08] bg-white/[0.04] p-4">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold text-slate-100">{selectedNote ? '编辑记录' : '新建记录'}</div>
              <div className="mt-1 text-[11px] leading-5 text-slate-400">先整理标题，再补充内容；支持剪贴板带入、置顶收藏和一键保存。</div>
            </div>
            {selectedNote && (
              <div className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] text-slate-400">
                {formatTimeLabel(selectedNote.updatedAt)}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => void preloadClipboardDraft('manual')}
              className="flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-2 text-[12px] font-semibold text-slate-200 transition-colors hover:bg-white/[0.08]"
            >
              {isImportingClipboard ? <Loader2 size={14} className="animate-spin" /> : <Clipboard size={14} />}
              剪贴板
            </button>
            <button
              type="button"
              onClick={beginNewNote}
              className="flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-2 text-[12px] font-semibold text-slate-200 transition-colors hover:bg-white/[0.08]"
            >
              <Plus size={14} />
              新建
            </button>
            <button
              type="button"
              onClick={saveNote}
              disabled={isSaving || (!draftTitle.trim() && !draftContent.trim())}
              className="flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-sky-400/18 px-2.5 py-2 text-[12px] font-bold text-sky-100 transition-colors hover:bg-sky-400/26 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              保存
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDraftPinned(value => !value)}
              className={`flex items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-all ${
                draftPinned
                  ? 'border-amber-300/30 bg-amber-400/15 text-amber-100'
                  : 'border-white/[0.08] bg-white/[0.05] text-slate-300 hover:bg-white/[0.08]'
              }`}
            >
              <Pin size={14} />
              {draftPinned ? '已置顶' : '置顶'}
            </button>
            <button
              type="button"
              onClick={() => setDraftFavorite(value => !value)}
              className={`flex items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-all ${
                draftFavorite
                  ? 'border-fuchsia-300/30 bg-fuchsia-400/15 text-fuchsia-100'
                  : 'border-white/[0.08] bg-white/[0.05] text-slate-300 hover:bg-white/[0.08]'
              }`}
            >
              <Star size={14} className={draftFavorite ? 'fill-current' : ''} />
              {draftFavorite ? '已收藏' : '收藏'}
            </button>
          </div>

          <div className="grid gap-3">
            <label className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-semibold text-slate-400">标题</span>
                <span className="text-[10px] text-slate-500">留空时自动取内容首行</span>
              </div>
              <input
                value={draftTitle}
                onChange={event => setDraftTitle(event.target.value)}
                className="h-11 rounded-2xl border border-white/[0.08] bg-white/[0.055] px-4 text-[13px] font-semibold text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-300/35"
                placeholder="记录标题"
              />
            </label>

            <label className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-semibold text-slate-400">内容</span>
                <span className="text-[10px] text-slate-500">
                  {draftContent.trim() ? `${draftContent.trim().length} 字` : '支持粘贴多行文本'}
                </span>
              </div>
              <textarea
                value={draftContent}
                onChange={event => setDraftContent(event.target.value)}
                className="min-h-[160px] resize-y rounded-[22px] border border-white/[0.08] bg-white/[0.045] p-4 text-[12px] leading-5 text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-300/35"
                placeholder="写下想法、待复制的文本、命令、备注..."
              />
            </label>
          </div>
        </div>

        {notice && <div className="mt-3 text-[11px] text-emerald-200">{notice}</div>}
        {error && <div className="mt-3 text-[11px] text-rose-200">{error}</div>}
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[13px] font-bold text-slate-100">记录卡片</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{filteredNotes.length}/{notes.length} visible</div>
        </div>

        <div className="mb-3 grid gap-2 md:grid-cols-[1fr,140px]">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-500" size={14} />
            <input
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              className="h-9 w-full rounded-lg border border-white/[0.08] bg-white/[0.045] pl-9 pr-3 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-300/35"
              placeholder="搜索记录标题或内容..."
            />
          </div>
          <div className="relative">
            <select
              value={sortMode}
              onChange={event => setSortMode(event.target.value as SortMode)}
              className="h-9 w-full appearance-none rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 text-[12px] font-semibold text-slate-200 outline-none focus:border-sky-300/35"
            >
              <option value="updated">最近更新</option>
              <option value="created">创建时间</option>
              <option value="title">标题排序</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-white/[0.08] bg-white/[0.025] p-6 text-center text-[12px] leading-5 text-slate-500">
            <div className="flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              正在读取快捷记录...
            </div>
          </div>
        ) : notes.length === 0 ? (
          <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-white/[0.08] bg-white/[0.025] p-6 text-center text-[12px] leading-5 text-slate-500">
            还没有快捷记录。先在上面写一条，然后保存成卡片。
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-white/[0.08] bg-white/[0.025] p-6 text-center text-[12px] leading-5 text-slate-500">
            没有匹配的记录，试试别的关键词。
          </div>
        ) : (
          <div className="space-y-3 overflow-y-auto pr-1">
            {noteSections.map(section => (
              <div key={section.key}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{section.label}</div>
                  <div className="text-[10px] text-slate-500">{section.notes.length}</div>
                </div>
                <div className="grid gap-2">
                  {section.notes.map(note => {
                    const isSelected = note.id === selectedNoteId;
                    return (
                      <button
                        key={note.id}
                        type="button"
                        onClick={() => selectNote(note)}
                        className={`rounded-[24px] border px-3 py-3 text-left transition-all ${
                          isSelected
                            ? 'border-sky-300/35 bg-sky-400/14'
                            : 'border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.07]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-bold text-slate-100">{note.title}</div>
                            <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-500">{formatTimeLabel(note.updatedAt)}</div>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {note.pinned && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] text-amber-100">
                                  <Pin size={10} />
                                  置顶
                                </span>
                              )}
                              {note.favorite && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-fuchsia-400/15 px-2 py-0.5 text-[10px] text-fuchsia-100">
                                  <Star size={10} className="fill-current" />
                                  收藏
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <span
                               role="button"
                               tabIndex={0}
                               onClick={event => {
                                 event.stopPropagation();
                                 void copyNote(note);
                               }}
                               onKeyDown={event => {
                                 if (event.key === 'Enter' || event.key === ' ') {
                                   event.preventDefault();
                                   event.stopPropagation();
                                   void copyNote(note);
                                 }
                               }}
                               className="rounded-full p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100"
                               title="复制"
                            >
                              <Copy size={14} />
                            </span>
                            <span
                               role="button"
                               tabIndex={0}
                               onClick={event => {
                                 event.stopPropagation();
                                 void removeNote(note.id);
                               }}
                               onKeyDown={event => {
                                 if (event.key === 'Enter' || event.key === ' ') {
                                   event.preventDefault();
                                   event.stopPropagation();
                                   void removeNote(note.id);
                                 }
                               }}
                               className="rounded-full p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-200"
                               title="删除"
                            >
                              <Trash2 size={14} />
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 line-clamp-2 text-[11px] leading-4 text-slate-400">{notePreview(note.content) || '空白记录'}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
