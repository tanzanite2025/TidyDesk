import React, { useEffect, useState } from 'react';
import { ListTodo, PackageOpen, PencilLine, Scissors } from 'lucide-react';
import { nativeClient } from '../../native/native-client';
import type { TodoCounts } from '../../types/todo';
import type { RailModule, WindowAction } from '../../types/tidydesk-api';

function formatBadge(count: number) {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

/**
 * Floating docked edge handle rendering module triggers and open todo badge.
 */
export const RailBar: React.FC = () => {
  const [activeModule, setActiveModule] = useState<RailModule>(null);
  const [todoCounts, setTodoCounts] = useState<TodoCounts>({ total: 0, open: 0, done: 0 });

  useEffect(() => {
    let disposed = false;

    const syncCounts = () => {
      if (!nativeClient.isAvailable()) {
        setTodoCounts({ total: 0, open: 0, done: 0 });
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
    };

    syncCounts();

    const unsubscribeCounts = nativeClient.todos.onCountsUpdated(next => {
      if (!disposed) setTodoCounts(next);
    });
    const unsubscribeTodos = nativeClient.todos.onUpdated(state => {
      if (!disposed && state?.counts) setTodoCounts(state.counts);
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
      unsubscribeSession?.();
      unsubscribeModule?.();
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, []);

  const openModule = (action: WindowAction) => {
    if (action === 'open-todos') {
      void nativeClient.toolWindows.openTodo();
      return;
    }

    nativeClient.windows.control(action);
  };

  const items: Array<{
    id: Exclude<RailModule, null> | 'screenshot';
    title: string;
    action: WindowAction;
    icon: React.ReactNode;
    badge?: string;
  }> = [
    {
      id: 'files',
      title: '文件抽屉',
      action: 'open-files',
      icon: <PackageOpen size={21} strokeWidth={1.9} />
    },
    {
      id: 'todos',
      title: `待办 ${todoCounts.open} 个未完成`,
      action: 'open-todos',
      icon: <ListTodo size={21} strokeWidth={1.9} />,
      badge: formatBadge(todoCounts.open)
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
      className="group relative flex h-screen w-full select-none flex-col items-center justify-center gap-2 overflow-hidden rounded-l-2xl border-y border-l border-slate-200/25 bg-gradient-to-b from-[#21283c] via-[#1a2030] to-[#151a27] py-3 pl-[5px] pr-1.5 text-slate-100"
      style={{
        WebkitAppRegion: 'no-drag',
        WebkitMaskImage: '-webkit-radial-gradient(white, white)',
        boxShadow:
          'inset 1px 0 0 rgba(255, 255, 255, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.14), inset 0 -1px 0 rgba(0, 0, 0, 0.45)'
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
                ? 'border-sky-300/40 bg-sky-400/22 text-sky-100 shadow-lg shadow-sky-950/25'
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
          </button>
        );
      })}
    </div>
  );
};
