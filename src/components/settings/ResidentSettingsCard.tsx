import React from 'react';
import { nativeClient } from '../../native/native-client';
import type { ResidentSettings, ResidentSettingsUpdate } from '../../types/tidydesk-api';

interface ResidentSettingsCardProps {
  residentSettings: ResidentSettings | null;
  residentError: string;
  isSavingResident: boolean;
  onUpdateResident: (payload: ResidentSettingsUpdate) => void;
}

export const ResidentSettingsCard: React.FC<ResidentSettingsCardProps> = ({
  residentSettings,
  residentError,
  isSavingResident,
  onUpdateResident
}) => (
  <div className="mb-6">
    <h3 className="mb-3 text-[13px] font-semibold text-slate-200">驻留和启动</h3>
    <div className="space-y-3 rounded-lg border border-white/[0.08] bg-white/[0.04] p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[12px] font-semibold text-slate-100">开机自动启动</div>
          <div className="mt-0.5 text-[11px] text-slate-500">登录 Windows 后自动启动 TidyDesk</div>
        </div>
        <button
          type="button"
          disabled={!residentSettings || isSavingResident}
          onClick={() => onUpdateResident({ autostartEnabled: !residentSettings?.autostartEnabled })}
          className={`min-w-16 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
            residentSettings?.autostartEnabled
              ? 'bg-emerald-500/20 text-emerald-100'
              : 'bg-white/[0.08] text-slate-400'
          }`}
        >
          {residentSettings?.autostartEnabled ? '已开启' : '已关闭'}
        </button>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[12px] font-semibold text-slate-100">启动后隐藏到托盘</div>
          <div className="mt-0.5 text-[11px] text-slate-500">启动时不显示桌面把手，适合开机静默驻留</div>
        </div>
        <button
          type="button"
          disabled={!residentSettings || isSavingResident}
          onClick={() => onUpdateResident({ launchMinimized: !residentSettings?.launchMinimized })}
          className={`min-w-16 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
            residentSettings?.launchMinimized
              ? 'bg-emerald-500/20 text-emerald-100'
              : 'bg-white/[0.08] text-slate-400'
          }`}
        >
          {residentSettings?.launchMinimized ? '已开启' : '已关闭'}
        </button>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => nativeClient.resident.showHandle()}
          className="flex-1 rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-[11px] font-semibold text-slate-200 hover:bg-white/[0.09]"
        >
          显示把手
        </button>
        <button
          type="button"
          onClick={() => nativeClient.resident.hideHandle()}
          className="flex-1 rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-[11px] font-semibold text-slate-200 hover:bg-white/[0.09]"
        >
          隐藏到托盘
        </button>
      </div>

      {residentError && (
        <div className="rounded-md border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
          {residentError}
        </div>
      )}
    </div>
  </div>
);
