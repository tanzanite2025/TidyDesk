import React, { useEffect, useState } from 'react';
import { ListTodo, PencilLine, Scissors, Settings } from 'lucide-react';
import { nativeClient } from '../../native/native-client';
import type { TodoCounts, TodoUnreadCommentSummary } from '../../types/todo';
import type { RailModule, WindowAction } from '../../types/tidydesk-api';
import type { UpdateSnapshot } from '../../types/update';

function formatBadge(count: number) {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

const EMPTY_UNREAD: TodoUnreadCommentSummary = {
  unreadTotal: 0,
  mentionTotal: 0,
  items: []
};

function isUpdateHighlight(snapshot: UpdateSnapshot | null): boolean {
  return (
    snapshot?.state === 'available' ||
    snapshot?.state === 'ready-to-install' ||
    snapshot?.state === 'ready-to-restart'
  );
}

/**
 * Compact 102x126 always-on-top floating launcher dock with a 24px top grip bar and 2x2 grid.
 */
export const RailBar: React.FC = () => {
  const [activeModule, setActiveModule] = useState<RailModule>(null);
  const [todoCounts, setTodoCounts] = useState<TodoCounts>({ total: 0, open: 0, done: 0 });
  const [unreadSummary, setUnreadSummary] = useState<TodoUnreadCommentSummary>(EMPTY_UNREAD);
  const [hasPendingUpdate, setHasPendingUpdate] = useState(false);

  useEffect(() => {
    let disposed = false;

    const syncCounts = () => {
      if (!nativeClient.isAvailable()) {
        setTodoCounts({ total: 0, open: 0, done: 0 });
        setUnreadSummary(EMPTY_UNREAD);
        setHasPendingUpdate(false);
        return;
      }
      nativeClient.todos
        .getCounts()
        .then(next => {
          if (!disposed) setTodoCounts(next);
        })
        .catch(err => {
          console.error('[TIDYDESK] Failed to load todo counts for handle badge:', err);
        });
      nativeClient.todos
        .getUnreadCommentSummary()
        .then(next => {
          if (!disposed) setUnreadSummary(next);
        })
        .catch(err => {
          console.error('[TIDYDESK] Failed to load comment unread summary for handle badge:', err);
        });
      nativeClient.updates
        .getState()
        .then(snap => {
          if (!disposed) setHasPendingUpdate(isUpdateHighlight(snap));
        })
        .catch(() => undefined);
    };

    syncCounts();

    const unsubscribeCounts = nativeClient.todos.onCountsUpdated(next => {
      if (!disposed) setTodoCounts(next);
    });
    const unsubscribeTodos = nativeClient.todos.onUpdated(state => {
      if (!disposed && state?.counts) setTodoCounts(state.counts);
    });
    const unsubscribeUnread = nativeClient.todos.onUnreadCommentsUpdated?.(summary => {
      if (!disposed) setUnreadSummary(summary || EMPTY_UNREAD);
    });
    const unsubscribeSession = nativeClient.accounts.onSessionChanged(() => {
      syncCounts();
    });
    const unsubscribeModule = nativeClient.windows.onModuleState(payload => {
      if (!disposed) setActiveModule(payload.activeModule || null);
    });
    const unsubscribeUpdates = nativeClient.updates.onChange(snap => {
      if (!disposed) setHasPendingUpdate(isUpdateHighlight(snap));
    });
    const handleVisibilityOrFocus = () => {
      if (!document.hidden) syncCounts();
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      disposed = true;
      unsubscribeCounts?.();
      unsubscribeTodos?.();
      unsubscribeUnread?.();
      unsubscribeSession?.();
      unsubscribeModule?.();
      unsubscribeUpdates?.();
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, []);

  const openModule = (action: WindowAction) => {
    if (action === 'open-todos') {
      const leadUnreadCardId =
        activeModule !== 'todos' && unreadSummary.unreadTotal > 0
          ? unreadSummary.items[0]?.cardId
          : undefined;
      void nativeClient.toolWindows.openTodo(leadUnreadCardId);
      return;
    }

    nativeClient.windows.control(action);
  };

  const unreadCommentBadge = formatBadge(unreadSummary.unreadTotal);
  const hasUnreadMentions = unreadSummary.mentionTotal > 0;
  const todoTitle = unreadSummary.unreadTotal > 0
    ? hasUnreadMentions
      ? `待办 ${todoCounts.open} 个未完成 · ${unreadSummary.unreadTotal} 条新评论（${unreadSummary.mentionTotal} 条 @你，点击直达）`
      : `待办 ${todoCounts.open} 个未完成 · ${unreadSummary.unreadTotal} 条新评论（点击查看）`
    : `待办 ${todoCounts.open} 个未完成`;

  const items: Array<{
    id: Exclude<RailModule, null> | 'screenshot';
    title: string;
    action: WindowAction;
    icon: React.ReactNode;
    badge?: string;
    commentBadge?: string;
    hasMention?: boolean;
    hasUpdateDot?: boolean;
  }> = [
    {
      id: 'todos',
      title: todoTitle,
      action: 'open-todos',
      icon: <ListTodo size={18} strokeWidth={1.9} />,
      badge: formatBadge(todoCounts.open),
      commentBadge: unreadCommentBadge,
      hasMention: hasUnreadMentions
    },
    {
      id: 'capture',
      title: '快捷记录',
      action: 'open-capture',
      icon: <PencilLine size={18} strokeWidth={1.9} />
    },
    {
      id: 'screenshot',
      title: '截图贴纸',
      action: 'start-screenshot',
      icon: <Scissors size={18} strokeWidth={1.9} />
    },
    {
      id: 'settings',
      title: hasPendingUpdate ? '系统设置（有新版本可用）' : '系统设置',
      action: 'open-settings',
      icon: <Settings size={17} strokeWidth={1.9} />,
      hasUpdateDot: hasPendingUpdate
    }
  ];

  return (
    <div
      className="flex h-screen w-full select-none flex-col overflow-hidden rounded-[18px] border border-white/[0.14] bg-[#11131c]/95 text-slate-100"
      style={{
        WebkitAppRegion: 'drag',
        WebkitMaskImage: '-webkit-radial-gradient(white, white)',
        boxShadow:
          'inset 0 1px 0 rgba(255, 255, 255, 0.11), inset 0 -1px 0 rgba(0, 0, 0, 0.45)'
      } as React.CSSProperties}
    >
      <div
        title="按住拖动悬浮把手位置"
        data-testid="handle-drag-bar"
        className="group/drag flex h-6 w-full shrink-0 cursor-grab items-center justify-center border-b border-white/[0.07] bg-white/[0.03] transition-colors hover:bg-white/[0.06] active:cursor-grabbing"
      >
        <span className="h-1 w-7 rounded-full bg-slate-400/45 transition-all duration-150 group-hover/drag:w-9 group-hover/drag:bg-sky-300/80" />
      </div>

      <div
        className="grid flex-1 grid-cols-2 gap-1.5 p-[7px]"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {items.map(item => {
          const isActive = activeModule === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => openModule(item.action)}
              data-testid={`rail-${item.id}`}
              className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-[11px] border transition-all duration-150 active:scale-[0.95] ${
                isActive
                  ? 'border-sky-300/45 bg-sky-400/20 text-sky-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]'
                  : 'border-white/[0.09] bg-white/[0.05] text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-sky-300/35 hover:bg-white/[0.11] hover:text-white'
              }`}
              title={item.title}
            >
              {item.icon}
              {item.badge && (
                <span className="pointer-events-none absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-black leading-4 text-white shadow">
                  {item.badge}
                </span>
              )}
              {item.hasUpdateDot && (
                <span
                  aria-label="有新版本"
                  className="pointer-events-none absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400 shadow"
                />
              )}
              {item.commentBadge && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={event => {
                    event.stopPropagation();
                    const targetCardId = unreadSummary.items[0]?.cardId;
                    if (targetCardId) {
                      void nativeClient.toolWindows.openTodo(targetCardId);
                    }
                  }}
                  className={`absolute -bottom-1 -left-1 grid min-h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-black leading-4 shadow ${
                    item.hasMention
                      ? 'animate-pulse bg-amber-400 text-slate-950'
                      : 'bg-sky-500 text-white'
                  }`}
                >
                  {item.hasMention ? '@' : item.commentBadge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
