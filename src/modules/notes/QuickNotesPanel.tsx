import React, { useMemo, useRef } from 'react';
import {
  CheckSquare,
  Clipboard,
  Copy,
  ListChecks,
  ListTodo,
  Loader2,
  Pin,
  Plus,
  Save,
  Search,
  Square,
  Star,
  StickyNote,
  Trash2
} from 'lucide-react';
import { useQuickNotes } from './useQuickNotes';
import {
  appendChecklistLine,
  formatTimeLabel,
  notePreview,
  parseChecklistItems,
  SortMode,
  toggleChecklistLine
} from './utils';

export const QuickNotesPanel: React.FC = () => {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const contentTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const {
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
    error,
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
  } = useQuickNotes();

  const isSelectedStuck = Boolean(selectedNote && stuckNoteIds.has(selectedNote.id));
  const checklistItems = useMemo(() => parseChecklistItems(draftContent), [draftContent]);

  return (
    <div
      className="grid flex-1 grid-cols-1 gap-4 md:min-h-0 md:grid-cols-[290px_minmax(0,1fr)]"
      onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          void saveNote();
        } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }
      }}
    >
      {/* 左侧：记录卡片列表 */}
      <aside className="order-2 flex min-h-0 min-w-0 flex-col rounded-2xl border border-white/[0.08] bg-[#161925] p-3.5 md:order-1">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="text-[13px] font-bold text-slate-100">记录卡片</div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
            {filteredNotes.length}/{notes.length}
          </div>
        </div>

        <div className="mb-3 grid grid-cols-[minmax(0,1fr)_96px] gap-2">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 text-slate-500" size={14} />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              className="h-9 w-full rounded-lg border border-white/[0.08] bg-white/[0.045] pl-8 pr-2.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-300/35"
              placeholder="搜索记录 (Ctrl+F)..."
            />
          </div>
          <select
            value={sortMode}
            onChange={event => setSortMode(event.target.value as SortMode)}
            className="h-9 w-full rounded-lg border border-white/[0.08] bg-[#1c2030] px-2.5 text-[11px] font-semibold text-slate-200 outline-none focus:border-sky-300/35"
          >
            <option value="updated">最近更新</option>
            <option value="created">创建时间</option>
            <option value="title">标题排序</option>
          </select>
        </div>

        {isLoading ? (
          <div className="grid min-h-[140px] flex-1 place-items-center rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-5 text-center text-[12px] leading-5 text-slate-500">
            <div className="flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              正在读取快捷记录...
            </div>
          </div>
        ) : notes.length === 0 ? (
          <div className="grid min-h-[140px] flex-1 place-items-center rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-5 text-center text-[12px] leading-5 text-slate-500">
            还没有快捷记录。
            <br />
            在右侧写一条并保存即可生成卡片。
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="grid min-h-[140px] flex-1 place-items-center rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-5 text-center text-[12px] leading-5 text-slate-500">
            没有匹配的记录，试试别的关键词。
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {noteSections.map(section => (
              <div key={section.key}>
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{section.label}</div>
                  <div className="text-[10px] text-slate-500">{section.notes.length}</div>
                </div>
                <div className="grid gap-2">
                  {section.notes.map(note => {
                    const isSelected = note.id === selectedNoteId;
                    const isStuck = stuckNoteIds.has(note.id);
                    return (
                      <button
                        key={note.id}
                        type="button"
                        onClick={() => selectNote(note)}
                        className={`w-full min-w-0 rounded-xl border px-3 py-2.5 text-left transition-all ${
                          isSelected
                            ? 'border-sky-300/35 bg-sky-400/14'
                            : 'border-white/[0.08] bg-white/[0.035] hover:bg-white/[0.07]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-bold text-slate-100">{note.title}</div>
                            <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                              {formatTimeLabel(note.updatedAt)}
                            </div>
                            {(note.pinned || note.favorite || isStuck) && (
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {isStuck && (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={event => {
                                      event.stopPropagation();
                                      void stickNoteToDesktop(note.id);
                                    }}
                                    onKeyDown={event => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        void stickNoteToDesktop(note.id);
                                      }
                                    }}
                                    title="点击置前聚焦桌面便签"
                                    className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-400/25"
                                  >
                                    <StickyNote size={10} />
                                    已贴桌面
                                  </span>
                                )}
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
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={event => {
                                event.stopPropagation();
                                if (isStuck) {
                                  void unstickNoteFromDesktop(note.id);
                                } else {
                                  void stickNoteToDesktop(note.id);
                                }
                              }}
                              onKeyDown={event => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  if (isStuck) {
                                    void unstickNoteFromDesktop(note.id);
                                  } else {
                                    void stickNoteToDesktop(note.id);
                                  }
                                }
                              }}
                              className={`rounded-md p-1.5 transition-colors ${
                                isStuck
                                  ? 'bg-emerald-400/15 text-emerald-200 hover:bg-rose-500/15 hover:text-rose-200'
                                  : 'text-slate-400 hover:bg-amber-400/15 hover:text-amber-200'
                              }`}
                              title={isStuck ? '从桌面收起便签' : '贴到桌面（独立便签）'}
                            >
                              <StickyNote size={13} />
                            </span>
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
                              className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100"
                              title="复制"
                            >
                              <Copy size={13} />
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
                              className="rounded-md p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-200"
                              title="删除"
                            >
                              <Trash2 size={13} />
                            </span>
                          </div>
                        </div>
                        <div className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-slate-400">
                          {notePreview(note.content) || '空白记录'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* 右侧：专注编辑区与紧凑分组工具条 */}
      <section className="order-1 flex min-h-0 min-w-0 flex-col rounded-2xl border border-white/[0.08] bg-[#161925] p-4 md:order-2">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.07] pb-3.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-bold text-slate-100">{selectedNote ? '编辑记录' : '新建记录'}</h2>
              {selectedNote && (
                <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-400">
                  {formatTimeLabel(selectedNote.updatedAt)}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] leading-4 text-slate-400">
              标题留空将自动截取首行，支持剪贴板带入与一键复制。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center gap-1 rounded-lg border border-white/[0.07] bg-white/[0.025] p-1">
              <button
                type="button"
                onClick={() => setDraftPinned(value => !value)}
                title={draftPinned ? '取消置顶' : '置顶记录'}
                className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[11px] font-semibold transition-colors ${
                  draftPinned
                    ? 'bg-amber-400/20 text-amber-100'
                    : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
                }`}
              >
                <Pin size={13} />
                {draftPinned ? '已置顶' : '置顶'}
              </button>
              <button
                type="button"
                onClick={() => setDraftFavorite(value => !value)}
                title={draftFavorite ? '取消收藏' : '收藏记录'}
                className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[11px] font-semibold transition-colors ${
                  draftFavorite
                    ? 'bg-fuchsia-400/20 text-fuchsia-100'
                    : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
                }`}
              >
                <Star size={13} className={draftFavorite ? 'fill-current' : ''} />
                {draftFavorite ? '已收藏' : '收藏'}
              </button>
            </div>

            <div className="hidden h-5 w-px bg-white/[0.08] sm:block" />

            <button
              type="button"
              onClick={() => void preloadClipboardDraft('manual')}
              className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 text-[11px] font-semibold text-slate-200 transition-colors hover:bg-white/[0.08]"
            >
              {isImportingClipboard ? <Loader2 size={13} className="animate-spin" /> : <Clipboard size={13} />}
              剪贴板
            </button>
            <button
              type="button"
              onClick={beginNewNote}
              className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 text-[11px] font-semibold text-slate-200 transition-colors hover:bg-white/[0.08]"
            >
              <Plus size={13} />
              新建
            </button>
            <button
              type="button"
              onClick={() => void stickCurrentDraftToDesktop()}
              disabled={!selectedNoteId && !draftTitle.trim() && !draftContent.trim()}
              title={isSelectedStuck ? '点击从桌面收起该便签' : '将当前记录作为可编辑便签贴到桌面'}
              className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                isSelectedStuck
                  ? 'border-emerald-400/35 bg-emerald-400/18 text-emerald-100 hover:bg-rose-500/20 hover:border-rose-300/35 hover:text-rose-100'
                  : 'border-amber-300/30 bg-amber-400/15 text-amber-100 hover:bg-amber-400/25'
              }`}
            >
              <StickyNote size={13} />
              {isSelectedStuck ? '已贴桌面' : '贴到桌面'}
            </button>
            <button
              type="button"
              onClick={saveNote}
              disabled={isSaving || (!draftTitle.trim() && !draftContent.trim())}
              className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-sky-300/30 bg-sky-500/20 px-3.5 text-[11px] font-bold text-sky-100 transition-colors hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.04] disabled:text-slate-500"
            >
              {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              保存
            </button>
          </div>
        </div>

        <div className="mt-3.5 flex min-h-0 flex-1 flex-col gap-3">
          <label className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold text-slate-400">标题</span>
              <span className="text-[10px] text-slate-500">留空时自动取内容首行</span>
            </div>
            <input
              value={draftTitle}
              onChange={event => setDraftTitle(event.target.value)}
              className="h-10 w-full min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.05] px-3.5 text-[13px] font-semibold text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-300/35"
              placeholder="记录标题"
            />
          </label>

          <label className="flex min-h-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-400">内容</span>
                <button
                  type="button"
                  onClick={() => {
                    setDraftContent(prev => appendChecklistLine(prev));
                    window.setTimeout(() => contentTextareaRef.current?.focus(), 0);
                  }}
                  title="在末尾插入可勾选清单项 (- [ ])"
                  className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-white/[0.035] px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/[0.08]"
                >
                  <ListChecks size={11} />
                  插入清单
                </button>
                <button
                  type="button"
                  onClick={() => void convertCurrentDraftToTodo()}
                  disabled={!draftTitle.trim() && !draftContent.trim()}
                  title="将当前记录复制为待办看板卡片"
                  className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-white/[0.035] px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/[0.08] disabled:opacity-40"
                >
                  <ListTodo size={11} />
                  转待办
                </button>
              </div>
              <span className="text-[10px] text-slate-500">
                {draftContent.trim() ? `${draftContent.trim().length} 字` : 'Ctrl+S 快速保存'}
              </span>
            </div>
            <textarea
              ref={contentTextareaRef}
              value={draftContent}
              onChange={event => setDraftContent(event.target.value)}
              className="min-h-[180px] w-full min-w-0 flex-1 resize-none rounded-xl border border-white/[0.08] bg-white/[0.045] p-3.5 text-[12px] leading-6 text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-300/35"
              placeholder="写下想法、待复制的文本、命令、备注，或用 - [ ] 创建清单..."
            />
          </label>

          {checklistItems.length > 0 && (
            <div className="max-h-28 shrink-0 space-y-1 overflow-y-auto rounded-xl border border-white/[0.08] bg-black/25 p-2.5">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                清单项（点击直接切换）
              </div>
              {checklistItems.map(item => (
                <button
                  key={item.lineIndex}
                  type="button"
                  onClick={() => setDraftContent(prev => toggleChecklistLine(prev, item.lineIndex))}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11px] hover:bg-white/[0.06]"
                >
                  {item.checked ? (
                    <CheckSquare size={13} className="shrink-0 text-emerald-300" />
                  ) : (
                    <Square size={13} className="shrink-0 text-slate-400" />
                  )}
                  <span className={`truncate ${item.checked ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                    {item.text || '（空清单项）'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {notice && <div className="mt-2.5 text-[11px] text-emerald-200">{notice}</div>}
        {error && <div className="mt-2.5 text-[11px] text-rose-200">{error}</div>}
      </section>
    </div>
  );
};
