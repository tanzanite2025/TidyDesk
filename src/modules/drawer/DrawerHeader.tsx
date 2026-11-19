import React from 'react';
import { PackageOpen, Pencil, RefreshCw, Search, Settings, Wrench, X } from 'lucide-react';
import type { DrawerTab } from './useDrawerOperations';

interface DrawerHeaderProps {
  activeDrawerTab: DrawerTab;
  searchQuery: string;
  isLoading: boolean;
  isValidating: boolean;
  onOpenSettings: () => void;
  onValidateAll: () => void;
  onRefresh: () => void;
  onCollapse: () => void;
  onSwitchTab: (tab: DrawerTab) => void;
  onSearchChange: (value: string) => void;
}

/**
 * Top bar, tab switcher, and search input for the expanded TidyDesk drawer.
 */
export const DrawerHeader: React.FC<DrawerHeaderProps> = ({
  activeDrawerTab,
  searchQuery,
  isLoading,
  isValidating,
  onOpenSettings,
  onValidateAll,
  onRefresh,
  onCollapse,
  onSwitchTab,
  onSearchChange
}) => {
  return (
    <>
      <div className="flex items-center justify-between px-5 py-4" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="flex min-w-0 items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.08] text-slate-200">
            <PackageOpen size={18} />
          </div>
          <div className="min-w-0 text-left">
            <div className="truncate text-[14px] font-black tracking-tight text-slate-100">TidyDesk</div>
            <div className="text-[9px] uppercase tracking-[0.22em] text-slate-500">
              {activeDrawerTab === 'files' ? 'Shortcut drawers' : 'Quick notes'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            type="button"
            onClick={onOpenSettings}
            data-testid="drawer-settings"
            className="rounded-md p-2 text-slate-500 hover:bg-white/[0.08] hover:text-slate-100"
            title="设置"
          >
            <Settings size={14} />
          </button>
          <button
            type="button"
            onClick={onValidateAll}
            disabled={isValidating}
            data-testid="drawer-validate-shortcuts"
            className="rounded-md p-2 text-slate-500 hover:bg-white/[0.08] hover:text-slate-100 disabled:opacity-50"
            title="验证所有快捷方式"
          >
            <Wrench size={14} className={isValidating ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={onRefresh}
            data-testid="drawer-refresh"
            className="rounded-md p-2 text-slate-500 hover:bg-white/[0.08] hover:text-slate-100"
            title="刷新"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={onCollapse}
            data-testid="drawer-collapse"
            className="rounded-md p-2 text-slate-500 hover:bg-rose-500/15 hover:text-rose-200"
            title="收起抽屉"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="px-5 pb-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="flex gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] p-1">
          <button
            type="button"
            onClick={() => onSwitchTab('files')}
            className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-md text-[12px] font-bold transition-all ${
              activeDrawerTab === 'files'
                ? 'bg-white/[0.12] text-slate-100'
                : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
            }`}
          >
            <PackageOpen size={14} />
            桌面收纳
          </button>
          <button
            type="button"
            onClick={() => onSwitchTab('capture')}
            className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-md text-[12px] font-bold transition-all ${
              activeDrawerTab === 'capture'
                ? 'bg-white/[0.12] text-slate-100'
                : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
            }`}
          >
            <Pencil size={14} />
            快捷记录
          </button>
        </div>
      </div>

      {activeDrawerTab === 'files' && (
        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-500" size={15} />
            <input
              value={searchQuery}
              onChange={event => onSearchChange(event.target.value)}
              className="h-10 w-full rounded-lg border border-white/[0.07] bg-white/[0.06] pl-9 pr-3 text-[12px] font-medium text-slate-100 outline-none placeholder:text-slate-500 focus:border-white/20"
              placeholder="搜索所有抽屉..."
            />
          </div>
        </div>
      )}
    </>
  );
};
