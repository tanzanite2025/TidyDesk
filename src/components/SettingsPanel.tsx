import React from 'react';
import { X } from 'lucide-react';
import { useUpdateManager } from '../services/updates/use-update-manager';
import { nativeClient } from '../native/native-client';
import type { HotkeySettings, ResidentSettings, ResidentSettingsUpdate } from '../types/tidydesk-api';
import { HotkeySettingsDialog } from './HotkeySettingsDialog';
import { AppInfoCard } from './settings/AppInfoCard';
import { StickerSettingsCard } from './settings/StickerSettingsCard';
import { ResidentSettingsCard } from './settings/ResidentSettingsCard';
import { AccountSyncCard } from './settings/AccountSyncCard';
import { UpdateSectionCard } from './settings/UpdateSectionCard';

interface SettingsPanelProps {
  onClose: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
  const [residentSettings, setResidentSettings] = React.useState<ResidentSettings | null>(null);
  const [residentError, setResidentError] = React.useState('');
  const [isSavingResident, setIsSavingResident] = React.useState(false);
  const [showHotkeySettings, setShowHotkeySettings] = React.useState(false);
  const [pasteHotkeyDisplay, setPasteHotkeyDisplay] = React.useState('Ctrl+Alt+V');
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

  const applyHotkeySettings = React.useCallback((settings: HotkeySettings) => {
    const binding = settings.bindings.find(item => item.action === 'paste_pending_sticker');
    setPasteHotkeyDisplay(binding?.displayAccelerator || '未设置');
  }, []);

  React.useEffect(() => {
    if (!nativeClient.isAvailable()) return;
    nativeClient.hotkeys
      .getSettings()
      .then(applyHotkeySettings)
      .catch(err => {
        console.error('[TIDYDESK] Failed to load hotkey settings:', err);
      });
  }, [applyHotkeySettings]);

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

  const handleInstallUpdate = async () => {
    if (confirm('应用将重启以安装更新。是否继续？')) {
      await installUpdate();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      {showHotkeySettings && (
        <HotkeySettingsDialog
          onClose={() => setShowHotkeySettings(false)}
          onSaved={applyHotkeySettings}
        />
      )}
      <div className="max-h-[90vh] w-[480px] overflow-y-auto rounded-xl border border-white/[0.12] bg-[#11131c] shadow-2xl">
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

        <div className="p-6">
          <AppInfoCard metadata={metadata} />
          <StickerSettingsCard
            residentSettings={residentSettings}
            isSavingResident={isSavingResident}
            pasteHotkeyDisplay={pasteHotkeyDisplay}
            onUpdateResident={payload => void updateResidentSettings(payload)}
            onOpenHotkeySettings={() => setShowHotkeySettings(true)}
          />
          <ResidentSettingsCard
            residentSettings={residentSettings}
            residentError={residentError}
            isSavingResident={isSavingResident}
            onUpdateResident={payload => void updateResidentSettings(payload)}
          />
          <AccountSyncCard />
          <UpdateSectionCard
            residentSettings={residentSettings}
            isSavingResident={isSavingResident}
            snapshot={snapshot}
            isReady={isReady}
            isChecking={isChecking}
            isDownloading={isDownloading}
            onUpdateResident={payload => void updateResidentSettings(payload)}
            onCheckForUpdates={checkForUpdates}
            onDownloadUpdate={downloadUpdate}
            onInstallUpdate={handleInstallUpdate}
          />
        </div>
      </div>
    </div>
  );
};
