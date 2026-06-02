import React, { useEffect, useState } from 'react';
import { ListTodo, PackageOpen, PencilLine, Scissors } from 'lucide-react';
import { nativeClient } from '../../native/native-client';
import type { TodoCounts } from '../../types/todo';
import type { RailModule, WindowAction } from '../../types/tidydesk-api';


function formatBadge(count: number) {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

type RailBarVariant = 'handle' | 'rail';

interface RailBarProps {
  variant: RailBarVariant;
}

const variantConfig: Record<RailBarVariant, {
  iconSize: number;
  buttonClass: string;
  activeClass: string;
  inactiveClass: string;
  containerClass: string;
  containerStyle: Record<string, unknown>;
  innerWrapper: boolean;
}> = {
  handle: {
    iconSize: 17,
    buttonClass: 'relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-all',
    activeClass: 'border-sky-400/20 bg-sky-400/18 text-sky-100 shadow-lg shadow-sky-950/20',
    inactiveClass: 'border-white/[0.03] bg-white/[0.05] text-slate-300 hover:bg-white/[0.08] hover:text-slate-100',
    containerClass: 'flex h-screen w-full select-none flex-col items-center justify-center gap-3 overflow-hidden rounded-l-2xl bg-[#10131d]/95 px-4 py-5 text-slate-100',
    containerStyle: {
      WebkitAppRegion: 'no-drag',
      WebkitMaskImage: '-webkit-radial-gradient(white, white)'
    },
    innerWrapper: false,
  },
  rail: {
    iconSize: 19,
    buttonClass: 'relative grid h-11 w-11 place-items-center rounded-lg border transition-all',
    activeClass: 'border-sky-300/35 bg-sky-400/18 text-sky-100 shadow-lg shadow-sky-950/25',
    inactiveClass: 'border-white/[0.06] bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] hover:text-slate-100',
    containerClass: 'flex h-screen w-full select-none flex-col items-center justify-center rounded-l-2xl bg-[#10131d]/95 text-slate-100 shadow-2xl',
    containerStyle: {
      WebkitAppRegion: 'no-drag',
      WebkitMaskImage: '-webkit-radial-gradient(white, white)',
      boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.5)'
    },
    innerWrapper: true,
  },
};

export const RailBar: React.FC<RailBarProps> = ({ variant }) => {
  const config = variantConfig[variant];
  const [activeModule, setActiveModule] = useState<RailModule>(null);
  const [todoCounts, setTodoCounts] = useState<TodoCounts>({ total: 0, open: 0, done: 0 });

  useEffect(() => {
    (nativeClient.isAvailable() ? nativeClient.todos.getCounts() : Promise.resolve({ total: 0, open: 0, done: 0 }))
      .then(setTodoCounts)
      .catch(() => undefined);

    const unsubscribeCounts = nativeClient.todos.onCountsUpdated(setTodoCounts);
    const unsubscribeModule = nativeClient.windows.onModuleState(payload => {
      setActiveModule(payload.activeModule || null);
    });

    return () => {
      unsubscribeCounts?.();
      unsubscribeModule?.();
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
      id: 'files' as const,
      title: '文件抽屉',
      action: 'open-files',
      icon: <PackageOpen size={config.iconSize} />
    },
    {
      id: 'todos' as const,
      title: `待办 ${todoCounts.open} 个未完成`,
      action: 'open-todos',
      icon: <ListTodo size={config.iconSize} />,
      badge: formatBadge(todoCounts.open)
    },
    {
      id: 'capture' as const,
      title: '快速记录',
      action: 'open-capture',
      icon: <PencilLine size={config.iconSize} />
    },
    {
      id: 'screenshot' as const,
      title: '截图贴纸',
      action: 'start-screenshot',
      icon: <Scissors size={config.iconSize} />
    }
  ];

  const buttons = (
    <>
      {items.map(item => {
        const isActive = activeModule === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => openModule(item.action)}
            className={`${config.buttonClass} ${
              isActive ? config.activeClass : config.inactiveClass
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
    </>
  );

  return (
    <div
      className={config.containerClass}
      style={config.containerStyle as React.CSSProperties}
    >
      {config.innerWrapper ? (
        <div className="flex flex-col items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {buttons}
        </div>
      ) : (
        buttons
      )}
    </div>
  );
};
