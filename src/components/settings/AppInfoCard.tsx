import React from 'react';
import type { UpdateMetadata } from '../../types/update';

interface AppInfoCardProps {
  metadata: UpdateMetadata | null;
}

export const AppInfoCard: React.FC<AppInfoCardProps> = ({ metadata }) => (
  <div className="mb-6">
    <h3 className="mb-3 text-[13px] font-semibold text-slate-200">应用信息</h3>
    <div className="space-y-2 rounded-lg border border-white/[0.08] bg-white/[0.04] p-4">
      <div className="flex justify-between text-[12px]">
        <span className="text-slate-400">应用名称</span>
        <span className="font-medium text-slate-100">{metadata?.name || 'TidyDesk'}</span>
      </div>
      <div className="flex justify-between text-[12px]">
        <span className="text-slate-400">当前版本</span>
        <span className="font-medium text-slate-100">v{metadata?.version || '加载中...'}</span>
      </div>
      <div className="flex justify-between text-[12px]">
        <span className="text-slate-400">运行模式</span>
        <span className="font-medium text-slate-100">{metadata?.isPackaged ? '生产模式' : '开发模式'}</span>
      </div>
      <div className="flex justify-between text-[12px]">
        <span className="text-slate-400">运行壳</span>
        <span className="font-medium uppercase text-slate-100">{metadata?.runtime || '加载中...'}</span>
      </div>
    </div>
  </div>
);
