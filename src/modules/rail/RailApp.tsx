import React, { useEffect, useState } from 'react';
import { ListTodo, PackageOpen, PencilLine, Scissors } from 'lucide-react';
import { nativeClient } from '../../native/native-client';
import { TodoCounts } from '../../types/todo';
import type { RailModule, WindowAction } from '../../types/tidydesk-api';

const nativeApi = nativeClient;

function formatBadge(count: number) {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

export const RailApp: React.FC = () => {
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
      icon: <PackageOpen size={19} />
    },
    {
      id: 'todos' as const,
      title: `待办 ${todoCounts.open} 个未完成`,
      action: 'open-todos',
      icon: <ListTodo size={19} />,
      badge: formatBadge(todoCounts.open)
    },
    {
      id: 'capture' as const,
      title: '快速记录',
      action: 'open-capture',
      icon: <PencilLine size={19} />
    },
    {
      id: 'screenshot' as const,
      title: '截图贴纸',
      action: 'start-screenshot',
      icon: <Scissors size={19} />
    }
  ];

  return (
    <div
      className="flex h-screen w-full select-none flex-col items-center justify-center rounded-l-2xl bg-[#10131d]/95 text-slate-100 shadow-2xl"
      style={{
        WebkitAppRegion: 'drag',
        WebkitMaskImage: '-webkit-radial-gradient(white, white)',
        boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.5)'
      } as React.CSSProperties}
    >
      <div className="flex flex-col items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {items.map(item => {
          const isActive = activeModule === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => openModule(item.action)}
              className={`relative grid h-11 w-11 place-items-center rounded-lg border transition-all ${
                isActive
                  ? 'border-sky-300/35 bg-sky-400/18 text-sky-100 shadow-lg shadow-sky-950/25'
                  : 'border-white/[0.06] bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] hover:text-slate-100'
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
    </div>
  );
};
