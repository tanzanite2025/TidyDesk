import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Loader2, LogOut, NotebookPen, Plus, RefreshCw, X } from 'lucide-react';
import { TodoProvider, useTodos } from '../../context/TodoContext';
import { nativeClient } from '../../native/native-client';
import type { AccountSessionSnapshot } from '../../types/todo';
import { isAttachmentFileOversized, isImageFile } from '../todos/mediaUtils';
import { TodoCardModal } from '../todos/TodoCardModal';
import { TodoCardTile } from '../todos/TodoCardTile';
import { MobileAuthGate } from './MobileAuthGate';
import { MobileQuickNotesView } from './MobileQuickNotesView';

const MobileBoardContent: React.FC<{
  session: AccountSessionSnapshot;
  onLogout: () => Promise<void>;
}> = ({ session, onLogout }) => {
  const {
    board,
    cardsByColumn,
    counts,
    isLoading,
    isUploadingAttachment,
    error,
    refreshTodos,
    createCard,
    addAttachmentBytes,
    clearError
  } = useTodos();

  const [mobileView, setMobileView] = useState<'todos' | 'notes'>('todos');
  const [activeColumnId, setActiveColumnId] = useState('todo');
  const [quickTitle, setQuickTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [createModalColumnId, setCreateModalColumnId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const quickPhotoInputRef = useRef<HTMLInputElement | null>(null);

  const selectedCardSummary = useMemo(() => {
    if (!selectedCardId || !board) return null;
    return (
      board.columns
        .flatMap(column => cardsByColumn[column.id] || [])
        .find(card => card.id === selectedCardId) || null
    );
  }, [board, cardsByColumn, selectedCardId]);

  const activeCards = cardsByColumn[activeColumnId] || [];

  const handleQuickCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title || isCreating) return;
    setIsCreating(true);
    setLocalError(null);
    try {
      const created = await createCard({ title, content: '', columnId: activeColumnId });
      if (created) {
        setQuickTitle('');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleQuickPhotoCard = async (files: FileList | null) => {
    if (!files || files.length === 0 || isCreating || isUploadingAttachment) return;
    const file = files[0];
    if (!isImageFile(file)) {
      setLocalError(`不支持的图片格式：${file.name}`);
      return;
    }
    if (isAttachmentFileOversized(file)) {
      setLocalError('单张照片不能超过 20 MB');
      return;
    }
    setIsCreating(true);
    setLocalError(null);
    try {
      const title = quickTitle.trim() || `拍照待办 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
      const created = await createCard({ title, content: '', columnId: activeColumnId });
      if (!created) return;
      setQuickTitle('');
      const buffer = await file.arrayBuffer();
      await addAttachmentBytes({
        cardId: created.id,
        fileName: file.name || `mobile-${Date.now()}.jpg`,
        bytes: Array.from(new Uint8Array(buffer))
      });
      setSelectedCardId(created.id);
    } finally {
      setIsCreating(false);
    }
  };

  const visibleError = localError || error;

  return (
    <div className="flex min-h-[100dvh] w-full flex-col bg-[#0f131d] text-slate-100">
      <header className="sticky top-0 z-10 border-b border-white/[0.08] bg-[#131826]/95 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-[15px] font-black tracking-tight">
                TidyDesk 待办
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                {session.displayName || session.activeUserId}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-slate-400">
              <span>{counts.open} 未完成 · {counts.done} 已完成</span>
              <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-sky-200">
                {session.workspaceId === 'default' ? '共享看板 (default)' : session.workspaceId}
              </span>
              {session.activeUserId && (
                <button
                  type="button"
                  onClick={() => {
                    if (!session.activeUserId) return;
                    const nextWs =
                      session.workspaceId === 'default'
                        ? `private:${session.activeUserId}`
                        : 'default';
                    void nativeClient.accounts
                      .switchSession({
                        userId: session.activeUserId,
                        serverEndpoint: session.serverEndpoint || undefined,
                        workspaceId: nextWs
                      })
                      .catch(err => setLocalError(err instanceof Error ? err.message : String(err)));
                  }}
                  className="rounded border border-white/[0.1] px-1.5 py-0.5 text-[9px] text-slate-300 hover:bg-white/[0.08]"
                >
                  {session.workspaceId === 'default' ? '切到私人空间' : '切回共享看板'}
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void refreshTodos()}
              className="rounded-lg border border-white/[0.08] bg-white/[0.05] p-2 text-slate-300 hover:bg-white/[0.1]"
              title="刷新同步"
            >
              <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={() => void onLogout()}
              className="rounded-lg border border-white/[0.08] bg-white/[0.05] p-2 text-slate-300 hover:bg-rose-500/20 hover:text-rose-200"
              title="切换账号"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>

        {/* View Switcher: Todos vs QuickNotes */}
        <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-xl bg-black/30 p-1">
          <button
            type="button"
            onClick={() => setMobileView('todos')}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-bold transition-colors ${
              mobileView === 'todos'
                ? 'bg-white/[0.12] text-slate-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            待办看板
          </button>
          <button
            type="button"
            onClick={() => setMobileView('notes')}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-bold transition-colors ${
              mobileView === 'notes'
                ? 'bg-amber-500/20 text-amber-100'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <NotebookPen size={13} />
            快捷记录
          </button>
        </div>

        {/* Column Switcher Tabs */}
        {mobileView === 'todos' && (
          <div className="mt-2 grid grid-cols-3 gap-1.5 rounded-xl bg-black/25 p-1">
            {(board?.columns || []).map(col => {
              const count = (cardsByColumn[col.id] || []).length;
              const active = col.id === activeColumnId;
              return (
                <button
                  key={col.id}
                  type="button"
                  onClick={() => setActiveColumnId(col.id)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] font-bold transition-colors ${
                    active
                      ? 'bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/35'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>{col.title}</span>
                  <span className="font-mono text-[10px] opacity-80">{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </header>

      {mobileView === 'notes' ? (
        <MobileQuickNotesView />
      ) : (
        <>

      {/* Quick Create + Mobile Instant Camera Card */}
      <form
        onSubmit={event => void handleQuickCreate(event)}
        className="flex items-center gap-2 border-b border-white/[0.08] bg-[#121623] px-4 py-3"
      >
        <input
          value={quickTitle}
          onChange={event => setQuickTitle(event.target.value)}
          placeholder="输入待办标题..."
          className="h-10 min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-white/[0.05] px-3 text-[13px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
        />
        <input
          ref={quickPhotoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={event => {
            void handleQuickPhotoCard(event.target.files);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={isCreating || isUploadingAttachment}
          onClick={() => quickPhotoInputRef.current?.click()}
          className="inline-flex h-10 shrink-0 items-center gap-1 rounded-xl border border-sky-400/30 bg-sky-500/20 px-3 text-[12px] font-bold text-sky-100 disabled:opacity-45"
          title="拍照并直接建立待办卡片"
        >
          {isCreating || isUploadingAttachment ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Camera size={14} />
          )}
          拍照建卡
        </button>
        <button
          type="submit"
          disabled={isCreating || !quickTitle.trim()}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.08] text-slate-100 disabled:opacity-40"
          title="快速建卡"
        >
          <Plus size={16} />
        </button>
      </form>

      {visibleError && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-rose-400/25 bg-rose-500/15 px-3 py-2 text-[12px] text-rose-100">
          <span className="flex-1">{visibleError}</span>
          <button
            type="button"
            onClick={() => {
              setLocalError(null);
              clearError();
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Single-Column Card List */}
      <main className="flex-1 space-y-2.5 overflow-y-auto p-4 pb-20">
        {activeCards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/[0.1] px-4 py-10 text-center text-[12px] text-slate-500">
            {isLoading ? '正在从云端同步...' : '当前列暂无待办，可直接拍照或点击上方加号创建'}
          </div>
        ) : (
          activeCards.map(card => (
            <TodoCardTile
              key={card.id}
              card={card}
              isSelected={card.id === selectedCardId}
              onSelect={() => {
                setCreateModalColumnId(null);
                setSelectedCardId(card.id);
              }}
              onDragStart={event => event.preventDefault()}
            />
          ))
        )}
      </main>

      <button
        type="button"
        onClick={() => {
          setSelectedCardId(null);
          setCreateModalColumnId(activeColumnId);
        }}
        className="fixed bottom-5 right-5 z-20 inline-flex h-12 items-center gap-1.5 rounded-full bg-sky-500 px-4 text-[13px] font-bold text-white shadow-lg shadow-sky-500/30"
      >
        <Plus size={16} />
        详细新建
      </button>

      {(createModalColumnId !== null || selectedCardSummary !== null) && (
        <TodoCardModal
          mode={selectedCardSummary ? 'detail' : 'create'}
          defaultColumnId={createModalColumnId || activeColumnId}
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
        </>
      )}
    </div>
  );
};

export const MobileTodoApp: React.FC = () => {
  const [session, setSession] = useState<AccountSessionSnapshot | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [defaultEndpoint, setDefaultEndpoint] = useState(
    typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8787'
  );
  const [defaultWorkspaceId, setDefaultWorkspaceId] = useState('default');

  useEffect(() => {
    void nativeClient.accounts
      .getSession()
      .then(snap => {
        setSession(snap);
        if (snap.serverEndpoint) setDefaultEndpoint(snap.serverEndpoint);
        if (snap.workspaceId) setDefaultWorkspaceId(snap.workspaceId);
      })
      .finally(() => setCheckingSession(false));

    return nativeClient.accounts.onSessionChanged(next => {
      setSession(next);
    });
  }, []);

  if (checkingSession) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-[#0f131d] text-slate-300">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  if (!session || session.authMode !== 'account') {
    return (
      <MobileAuthGate
        initialEndpoint={defaultEndpoint}
        initialWorkspaceId={defaultWorkspaceId}
        onAuthenticated={setSession}
      />
    );
  }

  return (
    <TodoProvider client={nativeClient}>
      <MobileBoardContent
        session={session}
        onLogout={async () => {
          await nativeClient.accounts.logoutToLocal();
        }}
      />
    </TodoProvider>
  );
};
