import React from 'react';
import { PackageOpen, RefreshCw, Search, Settings, Wrench, X } from 'lucide-react';

interface DrawerHeaderProps {
  searchQuery: string;
  isLoading: boolean;
  isValidating: boolean;
  onOpenSettings: () => void;
  onValidateAll: () => void;
  onRefresh: () => void;
  onCollapse: () => void;
  onSearchChange: (value: string) => void;
}

/**
 * Top bar and search input for the expanded TidyDesk file organizer drawer.
 */
export const DrawerHeader: React.FC<DrawerHeaderProps> = ({
  searchQuery,
  isLoading,
  isValidating,
  onOpenSettings,
  onValidateAll,
  onRefresh,
  onCollapse,
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
            <div className="text-[9px] uppercase tracking-[0.22em] text-slate-500">Shortcut drawers</div>
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
    </>
  );
};
