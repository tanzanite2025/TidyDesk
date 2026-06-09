import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bold, Check, CheckSquare, Edit3, Eye, Heading1, Italic, Link, List, Loader2, Plus, RefreshCw, Table2, Trash2, X } from 'lucide-react';
import { TodoProvider, useTodos } from '../../context/TodoContext';
import { nativeClient } from '../../native/native-client';
import { TodoCard, TodoColumn } from '../../types/todo';
import { MarkdownPreview } from './MarkdownPreview';

type EditorMode = 'write' | 'preview';

function cardSummary(content: string) {
  return content
    .split(/\r?\n/)
    .map(line => line.replace(/^#+\s*/, '').replace(/^- \[[ xX]\]\s*/, '').trim())
    .find(Boolean) || '没有描述';
}

const TodoCardTile: React.FC<{
  card: TodoCard;
  isSelected: boolean;
  onSelect: () => void;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
}> = ({ card, isSelected, onSelect, onDragStart }) => (
  <button
    type="button"
    draggable
    onDragStart={onDragStart}
    onClick={onSelect}
    className={`w-full rounded-lg border p-3 text-left transition-all ${
      isSelected
        ? 'border-sky-300/35 bg-sky-400/14'
        : 'border-white/[0.07] bg-white/[0.055] hover:bg-white/[0.09]'
    }`}
  >
    <div className="line-clamp-2 text-[12px] font-bold leading-4 text-slate-100">{card.title}</div>
    <div className="mt-2 line-clamp-2 text-[10px] leading-4 text-slate-500">{cardSummary(card.content)}</div>
  </button>
);

const MarkdownToolbar: React.FC<{
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onInsert: (before: string, after?: string, placeholder?: string) => void;
}> = ({ mode, onModeChange, onInsert }) => (
  <div className="flex flex-wrap items-center gap-1 border-b border-white/[0.08] bg-white/[0.035] px-3 py-2">
    <button type="button" title="标题" onClick={() => onInsert('# ', '', '标题')} className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100">
      <Heading1 size={15} />
    </button>
    <button type="button" title="列表" onClick={() => onInsert('- ', '', '列表项')} className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100">
      <List size={15} />
    </button>
    <button type="button" title="任务项" onClick={() => onInsert('- [ ] ', '', '任务')} className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100">
      <CheckSquare size={15} />
    </button>
    <button type="button" title="加粗" onClick={() => onInsert('**', '**', '加粗')} className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100">
      <Bold size={15} />
    </button>
    <button type="button" title="斜体" onClick={() => onInsert('*', '*', '斜体')} className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100">
      <Italic size={15} />
    </button>
    <button type="button" title="链接" onClick={() => onInsert('[', '](https://)', '链接文字')} className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100">
      <Link size={15} />
    </button>
    <button type="button" title="表格" onClick={() => onInsert('\n| 项目 | 说明 |\n| --- | --- |\n| ', ' |  |\n', '内容')} className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100">
      <Table2 size={15} />
    </button>
    <div className="ml-auto flex rounded-md border border-white/[0.08] bg-black/15 p-0.5">
      <button type="button" title="编辑" onClick={() => onModeChange('write')} className={`rounded px-2 py-1 ${mode === 'write' ? 'bg-white/[0.12] text-slate-100' : 'text-slate-500 hover:text-slate-200'}`}>
        <Edit3 size={14} />
      </button>
      <button type="button" title="预览" onClick={() => onModeChange('preview')} className={`rounded px-2 py-1 ${mode === 'preview' ? 'bg-white/[0.12] text-slate-100' : 'text-slate-500 hover:text-slate-200'}`}>
        <Eye size={14} />
      </button>
    </div>
  </div>
);

const TodoPanelInner: React.FC = () => {
  const { board, cardsByColumn, counts, isLoading, error, refreshTodos, createCard, updateCard, deleteCard, moveCard, clearError } = useTodos();
  const [newCardTitle, setNewCardTitle] = useState('');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [editorMode, setEditorMode] = useState<EditorMode>('write');
  const [isDirty, setIsDirty] = useState(false);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedCard = useMemo(() => {
    if (!selectedCardId || !board) return null;
    return board.columns
      .flatMap(column => cardsByColumn[column.id] || [])
      .find(card => card.id === selectedCardId) || null;
  }, [board, cardsByColumn, selectedCardId]);

  useEffect(() => {
    if (!selectedCard) return;
    setDraftTitle(selectedCard.title);
    setDraftContent(selectedCard.content);
    setEditorMode('write');
    setIsDirty(false);
  }, [selectedCard?.id]);

  useEffect(() => {
    if (!selectedCard || !isDirty) return undefined;

    const timer = window.setTimeout(() => {
      updateCard({ id: selectedCard.id, title: draftTitle, content: draftContent });
      setIsDirty(false);
    }, 700);

    return () => window.clearTimeout(timer);
  }, [draftContent, draftTitle, isDirty, selectedCard, updateCard]);

  const submitNewCard = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = newCardTitle.trim();
    if (!title) return;

    const card = await createCard({ title, content: `# ${title}\n\n- [ ] `, columnId: 'todo' });
    setNewCardTitle('');
    if (card) setSelectedCardId(card.id);
  };

  const saveNow = async () => {
    if (!selectedCard) return;
    await updateCard({ id: selectedCard.id, title: draftTitle, content: draftContent });
    setIsDirty(false);
  };

  const insertMarkdown = (before: string, after = '', placeholder = '文本') => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setDraftContent(prev => `${prev}${before}${placeholder}${after}`);
      setIsDirty(true);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = draftContent.slice(start, end) || placeholder;
    const next = `${draftContent.slice(0, start)}${before}${selected}${after}${draftContent.slice(end)}`;
    setDraftContent(next);
    setIsDirty(true);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const dropOnColumn = (event: React.DragEvent, column: TodoColumn) => {
    event.preventDefault();
    const cardId = event.dataTransfer.getData('text/plain') || draggingCardId;
    if (!cardId) return;
    moveCard({ id: cardId, columnId: column.id });
    setDraggingCardId(null);
  };

  const handleDeleteSelected = async () => {
    if (!selectedCard) return;
    if (!confirm(`删除待办 "${selectedCard.title}"？`)) return;

    await deleteCard(selectedCard.id);
    setSelectedCardId(null);
  };

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#11131c]/98 text-slate-100 shadow-2xl">
      <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-black tracking-tight">{board?.title || '待办'}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-500">{counts.open} open / {counts.done} done</div>
        </div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button type="button" onClick={refreshTodos} title="刷新" className="rounded-md p-2 text-slate-500 hover:bg-white/[0.08] hover:text-slate-100">
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button type="button" onClick={() => nativeClient.isAvailable() && void nativeClient.toolWindows.closeTodo()} data-testid="todo-close" title="关闭" className="rounded-md p-2 text-slate-500 hover:bg-rose-500/15 hover:text-rose-200">
            <X size={14} />
          </button>
        </div>
      </div>

      <form onSubmit={submitNewCard} className="flex gap-2 border-b border-white/[0.08] px-5 py-3">
        <input
          value={newCardTitle}
          onChange={event => setNewCardTitle(event.target.value)}
          className="h-10 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.055] px-3 text-[12px] font-medium text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-300/35"
          placeholder="快速添加一条待办..."
        />
        <button type="submit" className="grid h-10 w-10 place-items-center rounded-lg bg-sky-400/18 text-sky-100 hover:bg-sky-400/26" title="添加">
          <Plus size={16} />
        </button>
      </form>

      {error && (
        <div className="mx-5 mt-3 flex items-center gap-2 rounded-lg border border-rose-400/20 bg-rose-500/10 p-3 text-[11px] text-rose-100">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={clearError}><X size={13} /></button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!board ? (
          <div className="grid h-full place-items-center text-[12px] text-slate-500">
            {isLoading ? <Loader2 className="animate-spin" size={24} /> : '待办数据不可用'}
          </div>
        ) : (
          <div className="grid min-h-full grid-cols-3 gap-3">
            {board.columns.map(column => {
              const columnCards = cardsByColumn[column.id] || [];
              return (
                <section
                  key={column.id}
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => dropOnColumn(event, column)}
                  className="min-w-0 rounded-lg border border-white/[0.08] bg-white/[0.035]"
                >
                  <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
                    <div className="truncate text-[12px] font-bold text-slate-200">{column.title}</div>
                    <div className="text-[10px] text-slate-500">{columnCards.length}</div>
                  </div>
                  <div className="space-y-2 p-2">
                    {columnCards.map(card => (
                      <TodoCardTile
                        key={card.id}
                        card={card}
                        isSelected={card.id === selectedCardId}
                        onSelect={() => setSelectedCardId(card.id)}
                        onDragStart={event => {
                          event.dataTransfer.setData('text/plain', card.id);
                          event.dataTransfer.effectAllowed = 'move';
                          setDraggingCardId(card.id);
                        }}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {selectedCard && (
        <aside className="absolute inset-y-0 right-0 z-20 flex w-[460px] max-w-[calc(100%-24px)] flex-col border-l border-white/[0.1] bg-[#151926] shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
            <input
              value={draftTitle}
              onChange={event => {
                setDraftTitle(event.target.value);
                setIsDirty(true);
              }}
              className="min-w-0 flex-1 bg-transparent text-[14px] font-black text-slate-100 outline-none"
            />
            <div className="flex items-center gap-1">
              <button type="button" title="保存" onClick={saveNow} className="rounded-md p-2 text-slate-500 hover:bg-emerald-500/15 hover:text-emerald-200">
                <Check size={14} />
              </button>
              <button type="button" title="删除" onClick={handleDeleteSelected} className="rounded-md p-2 text-slate-500 hover:bg-rose-500/15 hover:text-rose-200">
                <Trash2 size={14} />
              </button>
              <button type="button" title="关闭详情" onClick={() => setSelectedCardId(null)} className="rounded-md p-2 text-slate-500 hover:bg-white/[0.08] hover:text-slate-100">
                <X size={14} />
              </button>
            </div>
          </div>

          <MarkdownToolbar mode={editorMode} onModeChange={setEditorMode} onInsert={insertMarkdown} />

          <div className="min-h-0 flex-1 overflow-y-auto">
            {editorMode === 'write' ? (
              <textarea
                ref={textareaRef}
                value={draftContent}
                onChange={event => {
                  setDraftContent(event.target.value);
                  setIsDirty(true);
                }}
                onKeyDown={event => {
                  if (event.ctrlKey && event.key === 'Enter') {
                    event.preventDefault();
                    saveNow();
                  }
                }}
                className="h-full w-full resize-none bg-transparent p-4 text-[12px] leading-5 text-slate-100 outline-none placeholder:text-slate-600"
                placeholder="写 Markdown 描述、清单或链接..."
              />
            ) : (
              <div className="p-4">
                <MarkdownPreview content={draftContent || '没有内容'} />
              </div>
            )}
          </div>
          <div className="border-t border-white/[0.08] px-4 py-2 text-[10px] text-slate-500">
            {isDirty ? '正在等待自动保存' : '已保存'}
          </div>
        </aside>
      )}
    </div>
  );
};

export const TodoPanelApp: React.FC = () => (
  <TodoProvider client={nativeClient}>
    <TodoPanelInner />
  </TodoProvider>
);
