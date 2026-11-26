import React, { useEffect, useState } from 'react';
import { ListTodo, PackageOpen, PencilLine, Scissors } from 'lucide-react';
import { nativeClient } from '../../native/native-client';
import type { TodoCounts, TodoUnreadCommentSummary } from '../../types/todo';
import type { RailModule, WindowAction } from '../../types/tidydesk-api';

function formatBadge(count: number) {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

const EMPTY_UNREAD: TodoUnreadCommentSummary = {
  unreadTotal: 0,
  mentionTotal: 0,
  items: []
};

/**
 * Floating docked edge handle rendering module triggers, open todo badge, and unread comment/@mention indicator.
 */
export const RailBar: React.FC = () => {
  const [activeModule, setActiveModule] = useState<RailModule>(null);
  const [todoCounts, setTodoCounts] = useState<TodoCounts>({ total: 0, open: 0, done: 0 });
  const [unreadSummary, setUnreadSummary] = useState<TodoUnreadCommentSummary>(EMPTY_UNREAD);

  useEffect(() => {
    let disposed = false;

    const syncCounts = () => {
      if (!nativeClient.isAvailable()) {
        setTodoCounts({ total: 0, open: 0, done: 0 });
        setUnreadSummary(EMPTY_UNREAD);
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
  }> = [
    {
      id: 'files',
      title: '文件抽屉',
      action: 'open-files',
      icon: <PackageOpen size={21} strokeWidth={1.9} />
    },
    {
      id: 'todos',
      title: todoTitle,
      action: 'open-todos',
      icon: <ListTodo size={21} strokeWidth={1.9} />,
      badge: formatBadge(todoCounts.open),
      commentBadge: unreadCommentBadge,
      hasMention: hasUnreadMentions
    },
    {
      id: 'capture',
      title: '快捷记录',
      action: 'open-capture',
      icon: <PencilLine size={21} strokeWidth={1.9} />
    },
    {
      id: 'screenshot',
      title: '截图贴纸',
      action: 'start-screenshot',
      icon: <Scissors size={21} strokeWidth={1.9} />
    }
  ];

  return (
    <div
      className="group relative flex h-screen w-full select-none flex-col items-center justify-center gap-2 overflow-hidden rounded-l-2xl border-y border-l border-white/[0.12] bg-[#11131c] py-3 pl-[5px] pr-1.5 text-slate-100"
      style={{
        WebkitAppRegion: 'no-drag',
        WebkitMaskImage: '-webkit-radial-gradient(white, white)',
        boxShadow:
          'inset 1px 0 0 rgba(255, 255, 255, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.06), inset 0 -1px 0 rgba(0, 0, 0, 0.35)'
      } as React.CSSProperties}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-[2px] top-1/2 h-8 w-[2px] -translate-y-1/2 rounded-full bg-sky-400/60 transition-colors group-hover:bg-sky-300/90"
      />
      {items.map(item => {
        const isActive = activeModule === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => openModule(item.action)}
            data-testid={`rail-${item.id}`}
            className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border transition-all ${
              isActive
                ? 'border-sky-300/40 bg-sky-400/20 text-sky-100 shadow-lg shadow-sky-950/25'
                : 'border-white/[0.12] bg-white/[0.08] text-slate-200 hover:border-sky-300/40 hover:bg-white/[0.15] hover:text-white'
            }`}
            title={item.title}
          >
            {item.icon}
            {item.badge && (
              <span className="absolute -right-0.5 -top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-black leading-4 text-white shadow">
                {item.badge}
              </span>
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
                className={`absolute -bottom-0.5 -left-0.5 grid min-h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-black leading-4 shadow ${
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
  );
};
