import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCw, X } from 'lucide-react';
import { TodoProvider, useTodos } from '../../context/TodoContext';
import { nativeClient } from '../../native/native-client';
import type { TodoColumn } from '../../types/todo';
import { TodoCardModal } from './TodoCardModal';
import { TodoCardTile } from './TodoCardTile';

const TodoPanelInner: React.FC = () => {
  const {
    board,
    cards,
    cardsByColumn,
    counts,
    isLoading,
    error,
    refreshTodos,
    createCard,
    moveCard,
    clearError
  } = useTodos();

  const [quickTitle, setQuickTitle] = useState('');
  const [isCreatingQuick, setIsCreatingQuick] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [createModalColumnId, setCreateModalColumnId] = useState<string | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);

  const selectedCardSummary = useMemo(() => {
    if (!selectedCardId || !board) return null;
    return (
      board.columns
        .flatMap(column => cardsByColumn[column.id] || [])
        .find(card => card.id === selectedCardId) || null
    );
  }, [board, cardsByColumn, selectedCardId]);

  useEffect(() => {
    if (!nativeClient.isAvailable()) return undefined;
    return nativeClient.accounts.onSessionChanged(() => {
      setSelectedCardId(null);
      setCreateModalColumnId(null);
    });
  }, []);

  const submitQuickCard = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title || isCreatingQuick) return;

    setIsCreatingQuick(true);
    try {
      const created = await createCard({ title, content: '', columnId: 'todo' });
      if (created) {
        setQuickTitle('');
      }
    } finally {
      setIsCreatingQuick(false);
    }
  };

  const dropOnColumn = (event: React.DragEvent, column: TodoColumn) => {
    event.preventDefault();
    const cardId = event.dataTransfer.getData('text/plain') || draggingCardId;
    setDraggingCardId(null);
    if (!cardId) return;
    const sourceCard = cards.find(card => card.id === cardId);
    if (sourceCard?.columnId === column.id) return;
    void moveCard({ id: cardId, columnId: column.id });
  };

  const preventExternalFileNavigation = (event: React.DragEvent) => {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
    }
  };

  return (
    <div
      onDragOver={preventExternalFileNavigation}
      onDrop={preventExternalFileNavigation}
      className="relative flex h-screen w-full flex-col overflow-hidden bg-[#11131c] text-slate-100"
    >
      {/* Top Window Header */}
      <div
        className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3.5"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="min-w-0">
          <div className="truncate text-[14px] font-black tracking-tight">{board?.title || '待办'}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-500">
            {counts.open} open / {counts.done} done
          </div>
        </div>
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={refreshTodos}
            title="刷新"
            className="rounded-md p-2 text-slate-500 hover:bg-white/[0.08] hover:text-slate-100"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={() => nativeClient.isAvailable() && void nativeClient.toolWindows.closeTodo()}
            data-testid="todo-close"
            title="关闭"
            className="rounded-md p-2 text-slate-500 hover:bg-rose-500/15 hover:text-rose-200"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Quick Create Bar + Detailed Modal Create Button (bounded max width for 2K/4K) */}
      <div className="border-b border-white/[0.08]">
        <form
          onSubmit={submitQuickCard}
          className="mx-auto flex w-full max-w-[1680px] flex-wrap items-center gap-2 px-5 py-3"
        >
          <input
            value={quickTitle}
            onChange={event => setQuickTitle(event.target.value)}
            className="h-10 min-w-[200px] flex-1 rounded-lg border border-white/[0.08] bg-white/[0.055] px-3 text-[12px] font-medium text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-300/35"
            placeholder="快速添加一条待办（回车立即建立）..."
          />
          <button
            type="submit"
            disabled={isCreatingQuick || !quickTitle.trim()}
            className="grid h-10 w-10 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.06] text-slate-200 hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
            title="快速添加"
          >
            {isCreatingQuick ? <Loader2 size={15} className="animate-spin" /> : <Plus size={16} />}
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedCardId(null);
              setCreateModalColumnId('todo');
            }}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-sky-400/20 px-3.5 text-[12px] font-bold text-sky-100 hover:bg-sky-400/25"
          >
            <Plus size={15} />
            新建任务
          </button>
        </form>
      </div>

      {error && (
        <div className="mx-auto mt-3 flex w-full max-w-[1680px] items-center gap-2 px-5">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-rose-400/20 bg-rose-500/10 p-3 text-[11px] text-rose-100">
            <span className="flex-1">{error}</span>
            <button type="button" onClick={clearError}>
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Responsive Kanban Board Container */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        {!board ? (
          <div className="grid h-full place-items-center text-[12px] text-slate-500">
            {isLoading ? <Loader2 className="animate-spin" size={24} /> : '待办数据不可用'}
          </div>
        ) : (
          <div className="mx-auto grid min-h-full w-full max-w-[1680px] grid-cols-3 gap-3.5">
            {board.columns.map(column => {
              const columnCards = cardsByColumn[column.id] || [];
              return (
                <section
                  key={column.id}
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => dropOnColumn(event, column)}
                  className="flex min-w-0 flex-col rounded-xl border border-white/[0.08] bg-white/[0.03]"
                >
                  <div className="flex items-center justify-between border-b border-white/[0.06] px-3.5 py-2.5">
                    <div className="truncate text-[12px] font-bold text-slate-200">{column.title}</div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-slate-500">{columnCards.length}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCardId(null);
                          setCreateModalColumnId(column.id);
                        }}
                        className="rounded p-0.5 text-slate-500 hover:bg-white/[0.08] hover:text-slate-200"
                        title={`在「${column.title}」中新建任务`}
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2.5 p-2.5">
                    {columnCards.map(card => (
                      <TodoCardTile
                        key={card.id}
                        card={card}
                        isSelected={card.id === selectedCardId}
                        onSelect={() => {
                          setCreateModalColumnId(null);
                          setSelectedCardId(card.id);
                        }}
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

      {/* Unified Create / Detail Centered Modal */}
      {(createModalColumnId !== null || selectedCardSummary !== null) && (
        <TodoCardModal
          mode={selectedCardSummary ? 'detail' : 'create'}
          defaultColumnId={createModalColumnId || 'todo'}
          selectedCardSummary={selectedCardSummary}
          onSwitchToDetail={cardId => {
            setCreateModalColumnId(null);
            setSelectedCardId(cardId);
          }}
          onClose={() => {
            setCreateModalColumnId(null);
            setSelectedCardId(null);
          }}
        />
      )}
    </div>
  );
};

export const TodoPanelApp: React.FC = () => (
  <TodoProvider client={nativeClient}>
    <TodoPanelInner />
  </TodoProvider>
);
