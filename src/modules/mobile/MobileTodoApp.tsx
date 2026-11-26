import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ChevronDown,
  Loader2,
  LogOut,
  NotebookPen,
  Plus,
  RefreshCw,
  Users,
  X
} from 'lucide-react';
import { TodoProvider, useTodos } from '../../context/TodoContext';
import { nativeClient } from '../../native/native-client';
import { resolveDefaultMobileServerEndpoint } from '../../native/web-http-helpers';
import type { AccountSessionSnapshot, RemoteWorkspaceInfo } from '../../types/todo';
import { isAttachmentFileOversized, isImageFile } from '../todos/mediaUtils';
import { TodoCardModal } from '../todos/TodoCardModal';
import { clearCommentDraftCache } from '../todos/TodoCommentsSection';
import { TodoCardTile } from '../todos/TodoCardTile';
import { TodoCommentNotificationBanner, TodoUnreadBell } from '../todos/TodoUnreadBell';
import { MobileAuthGate } from './MobileAuthGate';
import { MobileQuickNotesView } from './MobileQuickNotesView';

interface CapacitorAppPluginLike {
  addListener?: (
    eventName: string,
    listener: (data: { isActive?: boolean }) => void
  ) => Promise<{ remove: () => Promise<void> }> | { remove: () => void };
  minimizeApp?: () => Promise<void>;
}

interface CapacitorStatusBarPluginLike {
  setStyle?: (options: { style: 'DARK' | 'LIGHT' }) => Promise<void>;
  setBackgroundColor?: (options: { color: string }) => Promise<void>;
  setOverlaysWebView?: (options: { overlay: boolean }) => Promise<void>;
}

function getCapacitorPlugins(): {
  App?: CapacitorAppPluginLike;
  StatusBar?: CapacitorStatusBarPluginLike;
} {
  if (typeof window === 'undefined') return {};
  const cap = (
    window as unknown as {
      Capacitor?: {
        Plugins?: { App?: CapacitorAppPluginLike; StatusBar?: CapacitorStatusBarPluginLike };
      };
    }
  ).Capacitor;
  return cap?.Plugins || {};
}

const MobileBoardContent: React.FC<{
  session: AccountSessionSnapshot;
  pendingCount: number;
  onSyncStatusRefresh: () => void;
  onOpenReconnectAuth: () => void;
  onLogout: (keepLocalContinuity: boolean) => Promise<void>;
}> = ({ session, pendingCount, onSyncStatusRefresh, onOpenReconnectAuth, onLogout }) => {
  const isAccountMode = session.authMode === 'account';
  const {
    board,
    cards,
    cardsByColumn,
    counts,
    unreadSummary,
    latestCommentNotification,
    isLoading,
    isUploadingAttachment,
    error,
    refreshTodos,
    createCard,
    addAttachmentBytes,
    markCardCommentsRead,
    markAllCommentsRead,
    dismissCommentNotification,
    clearError
  } = useTodos();

  const [mobileView, setMobileView] = useState<'todos' | 'notes'>('todos');
  const [activeColumnId, setActiveColumnId] = useState('todo');
  const [quickTitle, setQuickTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [createModalColumnId, setCreateModalColumnId] = useState<string | null>(null);
  const [showWorkspaceSheet, setShowWorkspaceSheet] = useState(false);
  const [workspaces, setWorkspaces] = useState<RemoteWorkspaceInfo[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [newWorkspaceTitle, setNewWorkspaceTitle] = useState('');
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [workspaceActionBusy, setWorkspaceActionBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const quickPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const uiStateRef = useRef({
    createModalColumnId,
    selectedCardId,
    showWorkspaceSheet,
    mobileView
  });
  uiStateRef.current = {
    createModalColumnId,
    selectedCardId,
    showWorkspaceSheet,
    mobileView
  };

  useEffect(() => {
    if (board && board.columns.length > 0 && !board.columns.some(col => col.id === activeColumnId)) {
      setActiveColumnId(board.columns[0].id);
    }
  }, [activeColumnId, board]);

  useEffect(() => {
    onSyncStatusRefresh();
  }, [cards, onSyncStatusRefresh, session]);

  useEffect(() => {
    const unsubNotes = nativeClient.quickNotes.onUpdated(() => onSyncStatusRefresh());
    const unsubRealtime = nativeClient.sync.onRealtimeApplied?.(() => onSyncStatusRefresh());
    return () => {
      unsubNotes?.();
      unsubRealtime?.();
    };
  }, [onSyncStatusRefresh]);

  const loadWorkspaces = useCallback(async () => {
    if (!isAccountMode || !nativeClient.accounts.listWorkspaces) return;
    setLoadingWorkspaces(true);
    try {
      const list = await nativeClient.accounts.listWorkspaces();
      setWorkspaces(list);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingWorkspaces(false);
    }
  }, [isAccountMode]);

  const switchTargetWorkspace = async (workspaceId: string) => {
    if (!session.activeUserId) return;
    setWorkspaceActionBusy(true);
    setLocalError(null);
    try {
      await nativeClient.accounts.switchSession({
        userId: session.activeUserId,
        serverEndpoint: session.serverEndpoint || undefined,
        workspaceId
      });
      clearCommentDraftCache();
      setSelectedCardId(null);
      setCreateModalColumnId(null);
      setShowWorkspaceSheet(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkspaceActionBusy(false);
    }
  };

  const handleCreateWorkspace = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = newWorkspaceTitle.trim();
    if (!title || !nativeClient.accounts.createWorkspace || workspaceActionBusy) return;
    setWorkspaceActionBusy(true);
    setLocalError(null);
    try {
      const created = await nativeClient.accounts.createWorkspace(title);
      setNewWorkspaceTitle('');
      await switchTargetWorkspace(created.workspaceId);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkspaceActionBusy(false);
    }
  };

  const handleJoinByInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    const code = inviteCodeInput.trim();
    if (!code || !nativeClient.accounts.joinWorkspaceByInvite || workspaceActionBusy) return;
    setWorkspaceActionBusy(true);
    setLocalError(null);
    try {
      const joined = await nativeClient.accounts.joinWorkspaceByInvite(code);
      setInviteCodeInput('');
      await switchTargetWorkspace(joined.workspaceId);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkspaceActionBusy(false);
    }
  };

  useEffect(() => {
    const plugins = getCapacitorPlugins();
    let active = true;
    const handles: Array<{ remove: () => Promise<void> | void }> = [];

    if (plugins.App?.addListener) {
      void Promise.resolve(
        plugins.App.addListener('backButton', () => {
          const ui = uiStateRef.current;
          if (ui.createModalColumnId !== null || ui.selectedCardId !== null) {
            setCreateModalColumnId(null);
            setSelectedCardId(null);
            return;
          }
          if (ui.showWorkspaceSheet) {
            setShowWorkspaceSheet(false);
            return;
          }
          if (ui.mobileView === 'notes') {
            setMobileView('todos');
            return;
          }
          void plugins.App?.minimizeApp?.();
        })
      ).then(handle => {
        if (!active) void handle.remove();
        else handles.push(handle);
      });

      void Promise.resolve(
        plugins.App.addListener('appStateChange', state => {
          if (state?.isActive) {
            void nativeClient.sync.setRealtimeEnabled?.(true).catch(err => {
              console.warn('[TIDYDESK][MOBILE] Foreground SSE resume error:', err);
            });
            void refreshTodos();
          }
        })
      ).then(handle => {
        if (!active) void handle.remove();
        else handles.push(handle);
      });
    }

    const onOnline = () => {
      void refreshTodos();
    };
    window.addEventListener('online', onOnline);

    return () => {
      active = false;
      window.removeEventListener('online', onOnline);
      for (const h of handles) void h.remove();
    };
  }, [refreshTodos]);

  const openCardSafely = (cardId: string) => {
    const target = cards.find(card => card.id === cardId && !card.deletedAt && !card.archived);
    if (!target) {
      setLocalError('该待办卡片已被删除或归档，已自动清理失效提醒。');
      void markCardCommentsRead(cardId);
      return;
    }
    setLocalError(null);
    setMobileView('todos');
    if (target.columnId) setActiveColumnId(target.columnId);
    setCreateModalColumnId(null);
    setSelectedCardId(cardId);
  };

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
      <header className="sticky top-0 z-10 border-b border-white/[0.08] bg-[#131826]/95 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur-md">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-[15px] font-black tracking-tight">
                TidyDesk 待办
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  isAccountMode
                    ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200'
                    : 'border-amber-400/30 bg-amber-500/15 text-amber-200'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isAccountMode ? 'animate-pulse bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                {isAccountMode
                  ? session.displayName || session.activeUserId
                  : `离线连续 · ${session.detachedUserId}`}
              </span>
              {pendingCount > 0 && (
                <span className="inline-flex items-center rounded-full border border-sky-400/30 bg-sky-500/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-sky-200">
                  待传 {pendingCount}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-slate-400">
              <span>{counts.open} 未完成 · {counts.done} 已完成</span>
              <button
                type="button"
                onClick={() => {
                  if (!isAccountMode) {
                    setLocalError('当前处于离线连续模式，重连登录原账号后即可切换工作区。');
                    return;
                  }
                  setShowWorkspaceSheet(true);
                  void loadWorkspaces();
                }}
                className="inline-flex items-center gap-1 rounded border border-white/[0.1] bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-sky-200 hover:bg-white/[0.12]"
              >
                <span>
                  {session.workspaceId === 'default'
                    ? '共享看板 (default)'
                    : session.workspaceId.startsWith('private:')
                      ? '私人空间'
                      : session.workspaceId}
                </span>
                <ChevronDown size={10} />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <TodoUnreadBell
              unreadSummary={unreadSummary}
              onOpenCard={openCardSafely}
              onMarkAllRead={() => void markAllCommentsRead()}
            />
            <button
              type="button"
              onClick={() => {
                if (!isAccountMode) {
                  onOpenReconnectAuth();
                  return;
                }
                void refreshTodos().finally(onSyncStatusRefresh);
              }}
              className="rounded-lg border border-white/[0.08] bg-white/[0.05] p-2 text-slate-300 hover:bg-white/[0.1]"
              title={isAccountMode ? '立即同步待传队列与云端最新' : '重连登录并同步'}
            >
              <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={() => void onLogout(isAccountMode)}
              className="rounded-lg border border-white/[0.08] bg-white/[0.05] p-2 text-slate-300 hover:bg-rose-500/20 hover:text-rose-200"
              title={isAccountMode ? '退出账号（保留本地离线继续编辑）' : '彻底退出并清空本地离线缓存'}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>

        {!isAccountMode && session.detachedUserId && (
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
            <span>
              已退出账号并保留离线编辑（{pendingCount} 条待上传）；联网重登原账号即可同步上云
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onOpenReconnectAuth}
                className="rounded-lg bg-sky-500/25 px-2.5 py-1 text-[10px] font-bold text-sky-100"
              >
                重连登录同步
              </button>
              <button
                type="button"
                onClick={() => void onLogout(false)}
                className="rounded-lg border border-rose-400/30 bg-rose-500/15 px-2 py-1 text-[10px] font-semibold text-rose-100"
              >
                彻底清空
              </button>
            </div>
          </div>
        )}

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

      <TodoCommentNotificationBanner
        notification={latestCommentNotification}
        onOpenCard={openCardSafely}
        onDismiss={dismissCommentNotification}
      />

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
      <main className="flex-1 space-y-2.5 overflow-y-auto p-4 pb-[calc(5rem+env(safe-area-inset-bottom))]">
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
        className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-5 z-20 inline-flex h-12 items-center gap-1.5 rounded-full bg-sky-500 px-4 text-[13px] font-bold text-white shadow-lg shadow-sky-500/30"
      >
        <Plus size={16} />
        详细新建
      </button>

      {showWorkspaceSheet && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setShowWorkspaceSheet(false)}
        >
          <div
            className="w-full max-w-[460px] space-y-4 rounded-t-2xl border border-white/[0.12] bg-[#151a29] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-[12px] shadow-2xl sm:rounded-2xl sm:pb-5"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-sky-300" />
                <span className="text-[14px] font-black">工作区管理与切换</span>
              </div>
              <button
                type="button"
                onClick={() => setShowWorkspaceSheet(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {loadingWorkspaces ? (
                <div className="flex items-center justify-center py-6 text-slate-400">
                  <Loader2 size={16} className="animate-spin" />
                </div>
              ) : (
                workspaces.map(ws => {
                  const active = ws.workspaceId === session.workspaceId;
                  return (
                    <button
                      key={ws.workspaceId}
                      type="button"
                      disabled={workspaceActionBusy}
                      onClick={() => void switchTargetWorkspace(ws.workspaceId)}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        active
                          ? 'border-sky-400/45 bg-sky-500/15 text-sky-100'
                          : 'border-white/[0.08] bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{ws.title || ws.workspaceId}</div>
                        <div className="truncate font-mono text-[10px] text-slate-400">
                          {ws.workspaceId} · {ws.role}
                        </div>
                      </div>
                      {active && <Check size={15} className="shrink-0 text-sky-300" />}
                    </button>
                  );
                })
              )}
            </div>

            <form onSubmit={event => void handleCreateWorkspace(event)} className="flex gap-2">
              <input
                value={newWorkspaceTitle}
                onChange={event => setNewWorkspaceTitle(event.target.value)}
                placeholder="新建共享工作区名称..."
                className="h-10 min-w-0 flex-1 rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 text-slate-100 outline-none focus:border-sky-400/50"
              />
              <button
                type="submit"
                disabled={workspaceActionBusy || !newWorkspaceTitle.trim()}
                className="h-10 shrink-0 rounded-xl bg-sky-500 px-3.5 font-bold text-white disabled:opacity-45"
              >
                新建
              </button>
            </form>

            <form onSubmit={event => void handleJoinByInvite(event)} className="flex gap-2">
              <input
                value={inviteCodeInput}
                onChange={event => setInviteCodeInput(event.target.value)}
                placeholder="输入团队工作区邀请码..."
                autoCapitalize="none"
                autoCorrect="off"
                className="h-10 min-w-0 flex-1 rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 font-mono text-slate-100 outline-none focus:border-sky-400/50"
              />
              <button
                type="submit"
                disabled={workspaceActionBusy || !inviteCodeInput.trim()}
                className="h-10 shrink-0 rounded-xl border border-emerald-400/35 bg-emerald-500/20 px-3.5 font-bold text-emerald-100 disabled:opacity-45"
              >
                加入
              </button>
            </form>
          </div>
        </div>
      )}

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
  const [showReconnectAuth, setShowReconnectAuth] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [defaultEndpoint, setDefaultEndpoint] = useState(() => resolveDefaultMobileServerEndpoint());
  const [defaultWorkspaceId, setDefaultWorkspaceId] = useState('default');

  const refreshPendingCount = useCallback(() => {
    void nativeClient.sync
      .getStatus()
      .then(status => setPendingCount(status.pendingCount || 0))
      .catch(err => {
        console.warn('[TIDYDESK][MOBILE] Failed reading sync pending count:', err);
      });
  }, []);

  useEffect(() => {
    const plugins = getCapacitorPlugins();
    void plugins.StatusBar?.setOverlaysWebView?.({ overlay: false });
    void plugins.StatusBar?.setStyle?.({ style: 'DARK' });
    void plugins.StatusBar?.setBackgroundColor?.({ color: '#0f131d' });

    void nativeClient.accounts
      .getSession()
      .then(snap => {
        setSession(snap);
        setDefaultEndpoint(snap.serverEndpoint || resolveDefaultMobileServerEndpoint());
        if (snap.workspaceId) setDefaultWorkspaceId(snap.workspaceId);
        refreshPendingCount();
      })
      .catch(err => {
        console.error('[CRITICAL] Failed to initialize mobile session:', err);
      })
      .finally(() => setCheckingSession(false));

    return nativeClient.accounts.onSessionChanged(next => {
      setSession(next);
      if (next.authMode === 'account') {
        setShowReconnectAuth(false);
      }
      if (next.serverEndpoint) {
        setDefaultEndpoint(next.serverEndpoint);
      }
      if (next.workspaceId) {
        setDefaultWorkspaceId(next.workspaceId);
      }
      refreshPendingCount();
    });
  }, [refreshPendingCount]);

  if (checkingSession) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-[#0f131d] text-slate-300">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  const hasAccountSession = session?.authMode === 'account';
  const hasDetachedContinuity = Boolean(session?.detachedUserId);

  if (!session || (!hasAccountSession && !hasDetachedContinuity) || showReconnectAuth) {
    return (
      <MobileAuthGate
        initialEndpoint={defaultEndpoint}
        initialWorkspaceId={defaultWorkspaceId}
        initialUserId={session?.detachedUserId || ''}
        detachedScope={
          session?.detachedUserId
            ? {
                userId: session.detachedUserId,
                workspaceId: session.detachedWorkspaceId || session.workspaceId || 'default',
                pendingCount
              }
            : null
        }
        onAuthenticated={next => {
          setShowReconnectAuth(false);
          setSession(next);
          refreshPendingCount();
        }}
        onCancelOffline={
          hasDetachedContinuity ? () => setShowReconnectAuth(false) : undefined
        }
        onWipeDetachedLocal={
          hasDetachedContinuity
            ? async () => {
                clearCommentDraftCache();
                await nativeClient.accounts.logoutToLocal(false);
                setShowReconnectAuth(false);
                refreshPendingCount();
              }
            : undefined
        }
      />
    );
  }

  return (
    <TodoProvider client={nativeClient}>
      <MobileBoardContent
        session={session}
        pendingCount={pendingCount}
        onSyncStatusRefresh={refreshPendingCount}
        onOpenReconnectAuth={() => setShowReconnectAuth(true)}
        onLogout={async keepLocalContinuity => {
          clearCommentDraftCache();
          await nativeClient.accounts.logoutToLocal(keepLocalContinuity);
          refreshPendingCount();
        }}
      />
    </TodoProvider>
  );
};
