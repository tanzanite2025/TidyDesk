import React, { useEffect, useState } from 'react';
import { ListTodo, PackageOpen, PencilLine, Scissors } from 'lucide-react';
import { nativeClient } from '../../native/native-client';
import type { TodoCounts } from '../../types/todo';
import type { RailModule, WindowAction } from '../../types/tidydesk-api';

const nativeApi = nativeClient;

function formatBadge(count: number) {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

export const HandleApp: React.FC = () => {
  const [activeModule, setActiveModule] = useState<RailModule>(null);
  const [todoCounts, setTodoCounts] = useState<TodoCounts>({ total: 0, open: 0, done: 0 });

  useEffect(() => {
    (nativeApi.isAvailable() ? nativeApi.todos.getCounts() : Promise.resolve({ total: 0, open: 0, done: 0 }))
      .then(setTodoCounts)
      .catch(() => undefined);

    const unsubscribeCounts = nativeApi.todos.onCountsUpdated(setTodoCounts);
    const unsubscribeModule = nativeApi.windows.onModuleState(payload => {
      setActiveModule(payload.activeModule || null);
    });

    return () => {
      unsubscribeCounts?.();
      unsubscribeModule?.();
    };
  }, []);

  const openModule = (action: WindowAction) => {
    if (action === 'open-todos') {
      void nativeApi.toolWindows.openTodo();
      return;
    }

    nativeApi.windows.control(action);
  };

  const items: Array<{
    id: Exclude<RailModule, null> | 'screenshot';
    title: string;
    action: WindowAction;
    icon: React.ReactNode;
    badge?: string;
  }> = [
    {
      id: 'files' as const,
      title: '文件抽屉',
      action: 'open-files',
      icon: <PackageOpen size={17} />
    },
    {
      id: 'todos' as const,
      title: `待办 ${todoCounts.open} 个未完成`,
      action: 'open-todos',
      icon: <ListTodo size={17} />,
      badge: formatBadge(todoCounts.open)
    },
    {
      id: 'capture' as const,
      title: '快速记录',
      action: 'open-capture',
      icon: <PencilLine size={17} />
    },
    {
      id: 'screenshot' as const,
      title: '截图贴纸',
      action: 'start-screenshot',
      icon: <Scissors size={17} />
    }
  ];

  return (
    <div
      className="flex h-screen w-full select-none flex-col items-center justify-center gap-3 overflow-hidden rounded-l-2xl bg-[#10131d]/95 px-4 py-5 text-slate-100"
      style={{
        WebkitAppRegion: 'no-drag',
        WebkitMaskImage: '-webkit-radial-gradient(white, white)'
      } as React.CSSProperties}
    >
      {items.map(item => {
        const isActive = activeModule === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => openModule(item.action)}
            className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-all ${
              isActive
                ? 'border-sky-400/20 bg-sky-400/18 text-sky-100 shadow-lg shadow-sky-950/20'
                : 'border-white/[0.03] bg-white/[0.05] text-slate-300 hover:bg-white/[0.08] hover:text-slate-100'
            }`}
            title={item.title}
          >
            {item.icon}
            {item.badge && (
              <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-black leading-4 text-white shadow">
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
