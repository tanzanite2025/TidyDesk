import React from 'react';
import { NotebookPen, X } from 'lucide-react';
import { nativeClient } from '../../native/native-client';
import { QuickNotesPanel } from '../notes/QuickNotesPanel';

/**
 * Standalone floating tool window hosting the Quick Notes editor and card list.
 */
export const QuickCaptureApp: React.FC = () => {
  const close = () => {
    if (nativeClient.isAvailable()) {
      nativeClient.windows.control('close-capture');
    }
  };

  return (
    <div
      className="flex h-screen w-full select-none flex-col overflow-hidden rounded-xl border border-white/[0.12] bg-[#11131c] text-slate-100 shadow-2xl"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          close();
        }
      }}
    >
      <div
        className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3.5"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div
          className="flex min-w-0 items-center gap-2.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sky-400/15 text-sky-100">
            <NotebookPen size={16} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-black tracking-tight">快捷记录</div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-slate-500">
              Quick notes & scratchpad
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={close}
          data-testid="capture-close"
          className="rounded-md p-2 text-slate-500 hover:bg-rose-500/15 hover:text-rose-200"
          title="关闭快捷记录（Esc）"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 md:overflow-hidden md:p-5">
        <QuickNotesPanel />
      </div>
    </div>
  );
};
