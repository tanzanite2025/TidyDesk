import React from 'react';
import { AlertCircle, Check, Download, RefreshCw, X } from 'lucide-react';
import type { ResidentSettings, ResidentSettingsUpdate } from '../../types/tidydesk-api';
import type { UpdateSnapshot } from '../../types/update';

interface UpdateSectionCardProps {
  residentSettings: ResidentSettings | null;
  isSavingResident: boolean;
  snapshot: UpdateSnapshot | null;
  isReady: boolean;
  isChecking: boolean;
  isDownloading: boolean;
  isInstalling: boolean;
  onUpdateResident: (payload: ResidentSettingsUpdate) => void;
  onCheckForUpdates: () => Promise<void>;
  onDownloadUpdate: () => Promise<void>;
  onCancelDownload: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
}

function updateStatusTone(snapshot: UpdateSnapshot | null) {
  if (!snapshot) return 'border-white/[0.08] bg-white/[0.04] text-slate-300';
  if (snapshot.state === 'available') return 'border-sky-400/20 bg-sky-500/10 text-sky-100';
  if (snapshot.state === 'up-to-date' || snapshot.state === 'ready-to-install' || snapshot.state === 'ready-to-restart') {
    return 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100';
  }
  if (snapshot.state === 'error' || snapshot.state === 'unsupported') {
    return 'border-amber-400/20 bg-amber-500/10 text-amber-100';
  }
  return 'border-white/[0.08] bg-white/[0.04] text-slate-300';
}

export const UpdateSectionCard: React.FC<UpdateSectionCardProps> = ({
  residentSettings,
  isSavingResident,
  snapshot,
  isReady,
  isChecking,
  isDownloading,
  isInstalling,
  onUpdateResident,
  onCheckForUpdates,
  onDownloadUpdate,
  onCancelDownload,
  onInstallUpdate
}) => {
  const showCheckButton =
    Boolean(snapshot?.canCheck) &&
    snapshot?.state !== 'checking' &&
    snapshot?.state !== 'downloading' &&
    snapshot?.state !== 'installing' &&
    snapshot?.state !== 'ready-to-restart';

  const showDownloadButton =
    Boolean(snapshot?.canDownload) &&
    (snapshot?.state === 'available' || (snapshot?.state === 'error' && Boolean(snapshot.availableVersion)));

  const showInstallButton =
    Boolean(snapshot?.canInstall) &&
    (snapshot?.state === 'ready-to-install' || (snapshot?.state === 'error' && Boolean(snapshot.availableVersion)));

  return (
    <div>
      <h3 className="mb-3 text-[13px] font-semibold text-slate-200">软件更新</h3>

      <div className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-white/[0.08] bg-white/[0.04] p-4">
        <div>
          <div className="text-[12px] font-semibold text-slate-100">自动检查更新</div>
          <div className="mt-0.5 text-[11px] text-slate-500">启动后后台检查；检查成功后当天不重复提醒</div>
        </div>
        <button
          type="button"
          disabled={!residentSettings || isSavingResident}
          onClick={() => onUpdateResident({ autoUpdateCheckEnabled: !residentSettings?.autoUpdateCheckEnabled })}
          className={`min-w-16 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
            residentSettings?.autoUpdateCheckEnabled
              ? 'bg-emerald-500/20 text-emerald-100'
              : 'bg-white/[0.08] text-slate-400'
          }`}
        >
          {residentSettings?.autoUpdateCheckEnabled ? '已开启' : '已关闭'}
        </button>
      </div>

      {(snapshot || !isReady) && (
        <div className={`mb-3 rounded-lg border p-3 text-[12px] ${updateStatusTone(snapshot)}`}>
          {!isReady && (
            <div className="flex items-center gap-2">
              <RefreshCw size={14} className="animate-spin" />
              <span>正在初始化更新服务...</span>
            </div>
          )}

          {snapshot?.state === 'checking' && (
            <div className="flex items-center gap-2">
              <RefreshCw size={14} className="animate-spin" />
              <span>正在检查更新...</span>
            </div>
          )}

          {snapshot?.state === 'available' && (
            <div>
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle size={14} />
                <span>发现新版本: v{snapshot.availableVersion || '新版本'}</span>
              </div>
              {snapshot.message && (
                <div className="mt-1 text-[11px] opacity-80">{snapshot.message}</div>
              )}
              {snapshot.releaseNotes && (
                <div className="mt-2 whitespace-pre-line rounded bg-black/20 px-2.5 py-2 text-[11px] leading-relaxed opacity-90">
                  {snapshot.releaseNotes}
                </div>
              )}
            </div>
          )}

          {snapshot?.state === 'up-to-date' && (
            <div className="flex items-center gap-2">
              <Check size={14} />
              <span>已是最新版本</span>
            </div>
          )}

          {snapshot?.state === 'downloading' && (
            <div>
              <div className="flex items-center gap-2">
                <Download size={14} className="animate-bounce" />
                <span>
                  {snapshot.message || `正在下载更新... ${snapshot.percent?.toFixed(1) ?? '0.0'}%`}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.1]">
                <div
                  className="h-full bg-sky-400 transition-all duration-300"
                  style={{ width: `${snapshot.percent || 0}%` }}
                />
              </div>
            </div>
          )}

          {snapshot?.state === 'ready-to-install' && (
            <div>
              <div className="flex items-center gap-2 font-semibold">
                <Check size={14} />
                <span>更新 v{snapshot.availableVersion || ''} 已完成校验，准备安装</span>
              </div>
              {snapshot.releaseNotes && (
                <div className="mt-2 whitespace-pre-line rounded bg-black/20 px-2.5 py-2 text-[11px] leading-relaxed opacity-90">
                  {snapshot.releaseNotes}
                </div>
              )}
            </div>
          )}

          {snapshot?.state === 'installing' && (
            <div className="flex items-center gap-2 font-semibold">
              <RefreshCw size={14} className="animate-spin" />
              <span>{snapshot.message || '正在准备安装更新...'}</span>
            </div>
          )}

          {snapshot?.state === 'ready-to-restart' && (
            <div className="flex items-center gap-2 font-semibold">
              <Check size={14} />
              <span>{snapshot.message || '更新已安装，重启后生效'}</span>
            </div>
          )}

          {snapshot?.state === 'error' && (
            <div>
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle size={14} />
                <span>
                  {snapshot.availableVersion
                    ? `更新 v${snapshot.availableVersion} 操作失败`
                    : '更新失败'}
                </span>
              </div>
              <div className="mt-1 text-[11px] opacity-80">{snapshot.message}</div>
            </div>
          )}

          {snapshot?.state === 'unsupported' && (
            <div className="flex items-center gap-2">
              <AlertCircle size={14} />
              <span>{snapshot.message}</span>
            </div>
          )}

          {snapshot?.state === 'idle' && (
            <div className="flex items-center gap-2">
              <RefreshCw size={14} />
              <span>更新系统已就绪，可手动检查更新。</span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {showDownloadButton && (
          <button
            type="button"
            onClick={() => void onDownloadUpdate()}
            disabled={isDownloading}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-sky-500/20 px-4 py-2.5 text-[12px] font-semibold text-sky-100 transition-all hover:bg-sky-500/30 disabled:opacity-50"
          >
            <Download size={14} />
            {snapshot?.state === 'error' ? '重试下载' : '下载更新'}
          </button>
        )}

        {snapshot?.state === 'downloading' && (
          <button
            type="button"
            onClick={() => void onCancelDownload()}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.06] px-4 py-2.5 text-[12px] font-semibold text-slate-200 transition-all hover:bg-rose-500/15 hover:text-rose-100"
          >
            <X size={14} />
            取消下载
          </button>
        )}

        {showInstallButton && (
          <button
            type="button"
            onClick={() => void onInstallUpdate()}
            disabled={isInstalling}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-500/20 px-4 py-2.5 text-[12px] font-semibold text-emerald-100 transition-all hover:bg-emerald-500/30 disabled:opacity-50"
          >
            <Check size={14} />
            {snapshot?.state === 'error' ? '重试安装并重启' : '安装并重启'}
          </button>
        )}

        {showCheckButton && (
          <button
            type="button"
            onClick={() => void onCheckForUpdates()}
            disabled={isChecking}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.06] px-4 py-2.5 text-[12px] font-semibold text-slate-100 transition-all hover:bg-white/[0.1] disabled:opacity-50"
          >
            <RefreshCw size={14} className={isChecking ? 'animate-spin' : ''} />
            {isChecking ? '检查中...' : showDownloadButton || snapshot?.state === 'error' ? '重新检查' : '检查更新'}
          </button>
        )}
      </div>
    </div>
  );
};
