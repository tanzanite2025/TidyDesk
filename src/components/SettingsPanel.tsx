import React, { useEffect, useState } from 'react';
import { X, Download, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { nativeClient } from '../native/native-client';
import type { UpdateStatus, UpdateStatusPayload } from '../types/tidydesk-api';

type UpdateInfo = Partial<UpdateStatusPayload>;

interface SettingsPanelProps {
  onClose: () => void;
}

const nativeApi = nativeClient;

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
  const [appVersion, setAppVersion] = useState<string>('');
  const [isPackaged, setIsPackaged] = useState<boolean>(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>({});
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    // 获取应用版本
    if (nativeApi.isAvailable()) {
      nativeApi.updates.getAppVersion().then(info => {
        setAppVersion(info.version);
        setIsPackaged(info.isPackaged);
      });
    }

    // 监听更新状态
    if (nativeApi.isAvailable()) {
      const unsubscribe = nativeApi.updates.onStatus(payload => {
        setUpdateStatus(payload.status);
        setUpdateInfo(payload);
        
        if (payload.status === 'checking') {
          setIsChecking(true);
        } else {
          setIsChecking(false);
        }
        
        if (payload.status === 'downloading') {
          setIsDownloading(true);
        } else if (payload.status === 'downloaded' || payload.status === 'error') {
          setIsDownloading(false);
        }
      });

      return unsubscribe;
    }
    return undefined;
  }, []);

  const handleCheckForUpdates = async () => {
    if (!nativeApi.isAvailable()) return;

    setIsChecking(true);
    setUpdateStatus('checking');
    
    try {
      const result = await nativeApi.updates.checkForUpdates();
      
      if (result.status === 'dev-mode') {
        setUpdateStatus('dev-mode');
        setUpdateInfo({ message: result.message });
      }
    } catch (err) {
      setUpdateStatus('error');
      setUpdateInfo({ message: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsChecking(false);
    }
  };

  const handleDownloadUpdate = async () => {
    if (!nativeApi.isAvailable()) return;

    try {
      await nativeApi.updates.downloadUpdate();
    } catch (err) {
      setUpdateStatus('error');
      setUpdateInfo({ message: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleInstallUpdate = async () => {
    if (!nativeApi.isAvailable()) return;

    if (confirm('应用将重启以安装更新。是否继续？')) {
      try {
        await nativeApi.updates.installUpdate();
      } catch (err) {
        setUpdateStatus('error');
        setUpdateInfo({ message: err instanceof Error ? err.message : String(err) });
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[480px] rounded-xl border border-white/[0.12] bg-[#11131c]/95 shadow-2xl">
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
                <span className="font-medium text-slate-100">TidyDesk</span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="text-slate-400">当前版本</span>
                <span className="font-medium text-slate-100">v{appVersion || '加载中...'}</span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="text-slate-400">运行模式</span>
                <span className="font-medium text-slate-100">{isPackaged ? '生产模式' : '开发模式'}</span>
              </div>
            </div>
          </div>

          {/* 更新检查 */}
          <div>
            <h3 className="mb-3 text-[13px] font-semibold text-slate-200">软件更新</h3>
            
            {/* 更新状态显示 */}
            {updateStatus && (
              <div className={`mb-3 rounded-lg border p-3 text-[12px] ${
                updateStatus === 'available' ? 'border-sky-400/20 bg-sky-500/10 text-sky-100' :
                updateStatus === 'not-available' ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100' :
                updateStatus === 'downloaded' ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100' :
                updateStatus === 'error' || updateStatus === 'dev-mode' ? 'border-amber-400/20 bg-amber-500/10 text-amber-100' :
                'border-white/[0.08] bg-white/[0.04] text-slate-300'
              }`}>
                {updateStatus === 'checking' && (
                  <div className="flex items-center gap-2">
                    <RefreshCw size={14} className="animate-spin" />
                    <span>正在检查更新...</span>
                  </div>
                )}
                
                {updateStatus === 'available' && (
                  <div>
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertCircle size={14} />
                      <span>发现新版本: v{updateInfo.version}</span>
                    </div>
                    {updateInfo.releaseNotes && (
                      <div className="mt-2 text-[11px] opacity-80">
                        {updateInfo.releaseNotes}
                      </div>
                    )}
                  </div>
                )}
                
                {updateStatus === 'not-available' && (
                  <div className="flex items-center gap-2">
                    <Check size={14} />
                    <span>已是最新版本</span>
                  </div>
                )}
                
                {updateStatus === 'downloading' && (
                  <div>
                    <div className="flex items-center gap-2">
                      <Download size={14} className="animate-bounce" />
                      <span>正在下载更新... {updateInfo.percent?.toFixed(1)}%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.1]">
                      <div 
                        className="h-full bg-sky-400 transition-all duration-300"
                        style={{ width: `${updateInfo.percent || 0}%` }}
                      />
                    </div>
                  </div>
                )}
                
                {updateStatus === 'downloaded' && (
                  <div className="flex items-center gap-2 font-semibold">
                    <Check size={14} />
                    <span>更新已下载，准备安装</span>
                  </div>
                )}
                
                {updateStatus === 'error' && (
                  <div>
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertCircle size={14} />
                      <span>更新失败</span>
                    </div>
                    <div className="mt-1 text-[11px] opacity-80">
                      {updateInfo.message}
                    </div>
                  </div>
                )}
                
                {updateStatus === 'dev-mode' && (
                  <div className="flex items-center gap-2">
                    <AlertCircle size={14} />
                    <span>{updateInfo.message}</span>
                  </div>
                )}
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-2">
              {(!updateStatus || updateStatus === 'not-available' || updateStatus === 'error') && (
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
              
              {updateStatus === 'available' && (
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
              
              {updateStatus === 'downloaded' && (
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
