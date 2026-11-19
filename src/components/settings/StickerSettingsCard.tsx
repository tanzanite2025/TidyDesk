import React from 'react';
import type { ResidentSettings, ResidentSettingsUpdate } from '../../types/tidydesk-api';

interface StickerSettingsCardProps {
  residentSettings: ResidentSettings | null;
  isSavingResident: boolean;
  pasteHotkeyDisplay: string;
  onUpdateResident: (payload: ResidentSettingsUpdate) => void;
  onOpenHotkeySettings: () => void;
}

export const StickerSettingsCard: React.FC<StickerSettingsCardProps> = ({
  residentSettings,
  isSavingResident,
  pasteHotkeyDisplay,
  onUpdateResident,
  onOpenHotkeySettings
}) => (
  <div className="mb-6">
    <h3 className="mb-3 text-[13px] font-semibold text-slate-200">截图贴纸</h3>
    <div className="space-y-3 rounded-lg border border-white/[0.08] bg-white/[0.04] p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[12px] font-semibold text-slate-100">截完图立即贴到桌面</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            默认关闭；关闭后按设置的贴图快捷键把最近截图贴到桌面
          </div>
        </div>
        <button
          type="button"
          disabled={!residentSettings || isSavingResident}
          onClick={() => onUpdateResident({ autoStickAfterSnip: !residentSettings?.autoStickAfterSnip })}
          className={`min-w-16 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
            residentSettings?.autoStickAfterSnip
              ? 'bg-emerald-500/20 text-emerald-100'
              : 'bg-white/[0.08] text-slate-400'
          }`}
        >
          {residentSettings?.autoStickAfterSnip ? '已开启' : '已关闭'}
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-slate-950/35 px-3 py-2 text-[11px] text-slate-400">
        <div>
          贴图快捷键：<span className="font-semibold text-slate-200">{pasteHotkeyDisplay}</span>
        </div>
        <button
          type="button"
          onClick={onOpenHotkeySettings}
          className="rounded-md border border-white/[0.08] px-2 py-1 text-slate-300 hover:bg-white/[0.08] hover:text-slate-100"
        >
          修改快捷键
        </button>
      </div>
    </div>
  </div>
);
