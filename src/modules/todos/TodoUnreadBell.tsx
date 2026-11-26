import React, { useEffect, useRef, useState } from 'react';
import { AtSign, Bell, CheckCheck, MessageSquare, X } from 'lucide-react';
import type {
  TodoCommentNotificationPayload,
  TodoUnreadCommentSummary
} from '../../types/todo';

interface TodoUnreadBellProps {
  unreadSummary: TodoUnreadCommentSummary;
  onOpenCard: (cardId: string) => void;
  onMarkAllRead: () => void;
}

/**
 * Compact header bell button + popover listing unread card comments and @mentions with 1-click navigation.
 */
export const TodoUnreadBell: React.FC<TodoUnreadBellProps> = ({
  unreadSummary,
  onOpenCard,
  onMarkAllRead
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const hasUnread = unreadSummary.unreadTotal > 0;
  const hasMention = unreadSummary.mentionTotal > 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        title={
          hasMention
            ? `${unreadSummary.unreadTotal} 条未读评论（${unreadSummary.mentionTotal} 条 @你）`
            : hasUnread
              ? `${unreadSummary.unreadTotal} 条未读评论`
              : '评论通知（暂无未读）'
        }
        className={`relative rounded-md p-2 transition-colors ${
          hasMention
            ? 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
            : hasUnread
              ? 'bg-sky-500/15 text-sky-200 hover:bg-sky-500/25'
              : 'text-slate-500 hover:bg-white/[0.08] hover:text-slate-100'
        }`}
      >
        <Bell size={14} />
        {hasUnread && (
          <span
            className={`absolute -right-0.5 -top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-black leading-4 shadow ${
              hasMention ? 'bg-amber-400 text-slate-950' : 'bg-sky-500 text-white'
            }`}
          >
            {unreadSummary.unreadTotal > 99 ? '99+' : unreadSummary.unreadTotal}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-white/[0.12] bg-[#161a26] shadow-2xl shadow-black/60">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-3.5 py-2.5">
            <div className="flex items-center gap-1.5 text-[12px] font-bold text-slate-100">
              <span>未读评论提醒</span>
              {unreadSummary.mentionTotal > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-200">
                  <AtSign size={10} />
                  {unreadSummary.mentionTotal}
                </span>
              )}
            </div>
            {hasUnread && (
              <button
                type="button"
                onClick={() => {
                  onMarkAllRead();
                  setOpen(false);
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-sky-300 hover:bg-sky-500/15"
              >
                <CheckCheck size={11} />
                全部已读
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto p-1.5">
            {unreadSummary.items.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-slate-500">
                当前没有未读的评论或 @提及
              </div>
            ) : (
              unreadSummary.items.map(item => (
                <button
                  key={item.cardId}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpenCard(item.cardId);
                  }}
                  className="flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.07]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-bold text-slate-100">
                      {item.cardTitle}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.mentionCount > 0 && (
                        <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-black text-amber-200">
                          @你 {item.mentionCount}
                        </span>
                      )}
                      <span className="rounded-full bg-sky-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-sky-200">
                        {item.unreadCount}
                      </span>
                    </div>
                  </div>
                  <div className="truncate text-[11px] text-slate-400">
                    <span className="font-semibold text-slate-300">{item.latestAuthorName}: </span>
                    {item.latestBodyPreview}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface TodoCommentNotificationBannerProps {
  notification: TodoCommentNotificationPayload | null;
  onOpenCard: (cardId: string) => void;
  onDismiss: () => void;
}

/**
 * Dismissible live banner surfaced inside the Todo board when incremental sync receives remote comments.
 */
export const TodoCommentNotificationBanner: React.FC<TodoCommentNotificationBannerProps> = ({
  notification,
  onOpenCard,
  onDismiss
}) => {
  if (!notification) return null;
  const isMention = notification.mentionCount > 0;

  return (
    <div className="mx-auto mt-3 flex w-full max-w-[1680px] items-center gap-2 px-4 sm:px-5">
      <div
        className={`flex flex-1 items-center gap-2.5 rounded-xl border px-3 py-2 text-[11px] ${
          isMention
            ? 'border-amber-400/35 bg-amber-500/15 text-amber-100'
            : 'border-sky-400/30 bg-sky-500/15 text-sky-100'
        }`}
      >
        <MessageSquare size={14} className={isMention ? 'shrink-0 text-amber-300' : 'shrink-0 text-sky-300'} />
        <button
          type="button"
          onClick={() => {
            onOpenCard(notification.cardId);
            onDismiss();
          }}
          className="min-w-0 flex-1 text-left hover:underline"
        >
          <span className="font-bold">{notification.title}：</span>
          <span className="opacity-90">{notification.body}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            onOpenCard(notification.cardId);
            onDismiss();
          }}
          className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-bold hover:bg-white/20"
        >
          查看卡片
        </button>
        <button
          type="button"
          onClick={onDismiss}
          title="关闭提醒"
          className="shrink-0 rounded p-0.5 opacity-80 hover:bg-white/15 hover:opacity-100"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
};
