import React from 'react';
import { AlertTriangle, Trash2, Wrench } from 'lucide-react';

interface InvalidShortcutsBannerProps {
  invalidCount: number;
  isValidating: boolean;
  isCleaningUp: boolean;
  onValidateAll: () => void;
  onCleanupInvalidShortcuts: () => void;
}

/**
 * Warning banner shown when broken shortcuts are detected across drawers.
 */
export const InvalidShortcutsBanner: React.FC<InvalidShortcutsBannerProps> = ({
  invalidCount,
  isValidating,
  isCleaningUp,
  onValidateAll,
  onCleanupInvalidShortcuts
}) => {
  if (invalidCount <= 0) return null;

  return (
    <div className="mx-5 mb-3 rounded-lg border border-amber-400/20 bg-amber-500/10 p-3">
      <div className="flex items-start gap-2 text-[11px] leading-4 text-amber-100">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="font-semibold">发现 {invalidCount} 个失效的快捷方式</div>
          <div className="mt-1 text-[10px] text-amber-200/80">
            目标文件已被移动或删除，快捷方式无法打开。点击修复按钮尝试自动修复。
          </div>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onValidateAll}
          disabled={isValidating}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-sky-400/20 px-3 py-1.5 text-[11px] font-semibold text-sky-100 transition-all hover:bg-sky-400/30 disabled:opacity-50"
        >
          <Wrench size={12} />
          {isValidating ? '修复中...' : '尝试智能修复'}
        </button>
        <button
          type="button"
          onClick={onCleanupInvalidShortcuts}
          disabled={isCleaningUp}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-amber-400/20 px-3 py-1.5 text-[11px] font-semibold text-amber-100 transition-all hover:bg-amber-400/30 disabled:opacity-50"
        >
          <Trash2 size={12} />
          {isCleaningUp ? '清理中...' : '清理失效快捷方式'}
        </button>
      </div>
    </div>
  );
};
