import React from 'react';
import { X, Download, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { useUpdateManager } from '../services/updates/use-update-manager';
import { nativeClient } from '../native/native-client';
import type { ResidentSettings, ResidentSettingsUpdate } from '../types/tidydesk-api';
import type { UpdateSnapshot } from '../types/update';

interface SettingsPanelProps {
  onClose: () => void;
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

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
  const [residentSettings, setResidentSettings] = React.useState<ResidentSettings | null>(null);
  const [residentError, setResidentError] = React.useState('');
  const [isSavingResident, setIsSavingResident] = React.useState(false);
  // 获取应用版本
  // 监听更新状态
  const {
    metadata,
    snapshot,
    isReady,
    isChecking,
    isDownloading,
    checkForUpdates,
    downloadUpdate,
    installUpdate
  } = useUpdateManager();

  React.useEffect(() => {
    if (!nativeClient.isAvailable()) return;
    nativeClient.resident
      .getSettings()
      .then(settings => {
        setResidentSettings(settings);
        setResidentError('');
      })
      .catch(err => {
        setResidentError(`驻留设置加载失败: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, []);

  const updateResidentSettings = async (payload: ResidentSettingsUpdate) => {
    setIsSavingResident(true);
    setResidentError('');
    try {
      const nextSettings = await nativeClient.resident.updateSettings(payload);
      setResidentSettings(nextSettings);
    } catch (err) {
      setResidentError(`驻留设置保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSavingResident(false);
    }
  };

  const handleCheckForUpdates = async () => {
    await checkForUpdates();
  };

  const handleDownloadUpdate = async () => {
    await downloadUpdate();
  };

  const handleInstallUpdate = async () => {
    if (confirm('应用将重启以安装更新。是否继续？')) {
      await installUpdate();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="max-h-[90vh] w-[480px] overflow-y-auto rounded-xl border border-white/[0.12] bg-[#11131c]/95 shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-white/[0.08] px-6 py-4">
          <div>
            <h2 className="text-[16px] font-bold text-slate-100">设置</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">应用设置和更新</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-slate-500 hover:bg-white/[0.08] hover:text-slate-100"
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容 */}
        <div className="p-6">
          {/* 应用信息 */}
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

          {/* 驻留设置 */}
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
                  onClick={() => updateResidentSettings({ autostartEnabled: !residentSettings?.autostartEnabled })}
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
                  onClick={() => updateResidentSettings({ launchMinimized: !residentSettings?.launchMinimized })}
                  className={`min-w-16 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
                    residentSettings?.launchMinimized
                      ? 'bg-emerald-500/20 text-emerald-100'
                      : 'bg-white/[0.08] text-slate-400'
                  }`}
                >
                  {residentSettings?.launchMinimized ? '已开启' : '已关闭'}
                </button>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[12px] font-semibold text-slate-100">后台快捷方式监控</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">监控抽屉快捷方式目标是否被删除或恢复</div>
                </div>
                <button
                  type="button"
                  disabled={!residentSettings || isSavingResident}
                  onClick={() => updateResidentSettings({ backgroundMonitorEnabled: !residentSettings?.backgroundMonitorEnabled })}
                  className={`min-w-16 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-50 ${
                    residentSettings?.backgroundMonitorEnabled
                      ? 'bg-emerald-500/20 text-emerald-100'
                      : 'bg-white/[0.08] text-slate-400'
                  }`}
                >
                  {residentSettings?.backgroundMonitorEnabled ? '已开启' : '已暂停'}
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

          {/* 更新检查 */}
          <div>
            <h3 className="mb-3 text-[13px] font-semibold text-slate-200">软件更新</h3>
            
            {/* 更新状态显示 */}
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
                    {snapshot.releaseNotes && (
                      <div className="mt-2 text-[11px] opacity-80">
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
                      <span>正在下载更新... {snapshot.percent?.toFixed(1)}%</span>
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
                  <div className="flex items-center gap-2 font-semibold">
                    <Check size={14} />
                    <span>更新已下载，准备安装</span>
                  </div>
                )}

                {snapshot?.state === 'installing' && (
                  <div className="flex items-center gap-2 font-semibold">
                    <RefreshCw size={14} className="animate-spin" />
                    <span>正在准备安装更新...</span>
                  </div>
                )}

                {snapshot?.state === 'ready-to-restart' && (
                  <div className="flex items-center gap-2 font-semibold">
                    <Check size={14} />
                    <span>更新已安装，重启后生效</span>
                  </div>
                )}
                
                {snapshot?.state === 'error' && (
                  <div>
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertCircle size={14} />
                      <span>更新失败</span>
                    </div>
                    <div className="mt-1 text-[11px] opacity-80">
                      {snapshot.message}
                    </div>
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

            {/* 操作按钮 */}
            <div className="flex gap-2">
              {snapshot?.canCheck && snapshot.state !== 'checking' && snapshot.state !== 'available' && snapshot.state !== 'downloading' && snapshot.state !== 'ready-to-install' && snapshot.state !== 'installing' && snapshot.state !== 'ready-to-restart' && (
                <button
                  type="button"
                  onClick={handleCheckForUpdates}
                  disabled={isChecking}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.06] px-4 py-2.5 text-[12px] font-semibold text-slate-100 transition-all hover:bg-white/[0.1] disabled:opacity-50"
                >
                  <RefreshCw size={14} className={isChecking ? 'animate-spin' : ''} />
                  {isChecking ? '检查中...' : '检查更新'}
                </button>
              )}
              
              {snapshot?.state === 'available' && snapshot.canDownload && (
                <button
                  type="button"
                  onClick={handleDownloadUpdate}
                  disabled={isDownloading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-sky-500/20 px-4 py-2.5 text-[12px] font-semibold text-sky-100 transition-all hover:bg-sky-500/30 disabled:opacity-50"
                >
                  <Download size={14} />
                  下载更新
                </button>
              )}
              
              {snapshot?.state === 'ready-to-install' && snapshot.canInstall && (
                <button
                  type="button"
                  onClick={handleInstallUpdate}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-500/20 px-4 py-2.5 text-[12px] font-semibold text-emerald-100 transition-all hover:bg-emerald-500/30"
                >
                  <Check size={14} />
                  安装并重启
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
