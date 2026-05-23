import React, { useEffect, useState } from 'react';
import { ListTodo, PackageOpen, PencilLine } from 'lucide-react';
import { TodoCounts } from '../../types/todo';

type RailModule = 'files' | 'todos' | 'capture' | null;

type TidyDeskRailApi = {
  windowControl: (action: string) => void;
  getTodoCounts?: () => Promise<TodoCounts>;
  onTodoCountsUpdated?: (callback: (counts: TodoCounts) => void) => () => void;
  onModuleState?: (callback: (payload: { activeModule: RailModule }) => void) => () => void;
};

const tidyDeskApi: TidyDeskRailApi | null = (window as any).tidyDesk || null;

function formatBadge(count: number) {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

export const RailApp: React.FC = () => {
  const [activeModule, setActiveModule] = useState<RailModule>(null);
  const [todoCounts, setTodoCounts] = useState<TodoCounts>({ total: 0, open: 0, done: 0 });

  useEffect(() => {
    tidyDeskApi?.getTodoCounts?.().then(setTodoCounts).catch(() => undefined);

    const unsubscribeCounts = tidyDeskApi?.onTodoCountsUpdated?.(setTodoCounts);
    const unsubscribeModule = tidyDeskApi?.onModuleState?.(payload => {
      setActiveModule(payload.activeModule || null);
    });

    return () => {
      unsubscribeCounts?.();
      unsubscribeModule?.();
    };
  }, []);

  const openModule = (action: string) => {
    tidyDeskApi?.windowControl(action);
  };

  const items = [
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

      <div className="mt-4 [writing-mode:vertical-rl] text-[9px] font-black tracking-[0.22em] text-slate-500" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        TIDYDESK
      </div>
    </div>
  );
};
