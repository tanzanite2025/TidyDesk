import React from 'react';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  FolderInput,
  PackageOpen,
  X
} from 'lucide-react';
import { SettingsPanel } from '../../components/SettingsPanel';
import { QuickNotesPanel } from '../notes/QuickNotesPanel';
import { nativeClient } from '../../native/native-client';
import { useDrawerOperations } from './useDrawerOperations';
import { DrawerHeader } from './DrawerHeader';
import { InvalidShortcutsBanner } from './InvalidShortcutsBanner';
import { DrawerCard } from './DrawerCard';

const windowMode = new URLSearchParams(window.location.search).get('mode');

export const DrawerApp: React.FC = () => {
  const {
    files,
    healthInfo,
    isLoading,
    refreshDesktop,
    openFile,
    deleteItem,
    clearError,
    windowControl,

    searchQuery,
    setSearchQuery,
    draggingOverDrawerId,
    setDraggingOverDrawerId,
    notice,
    setNotice,
    error,
    setError,
    isDrawerExpanded,
    renamingDrawerId,
    setRenamingDrawerId,
    draftDrawerName,
    setDraftDrawerName,
    isClosing,
    isCreatingDrawer,
    isCleaningUp,
    isValidating,
    showSettings,
    setShowSettings,
    activeDrawerTab,
    allDrawerFiles,
    invalidShortcutsCount,

    switchDrawerTab,
    handleDropOnDrawer,
    handleCreateDrawer,
    submitDrawerRename,
    handleCleanupInvalidShortcuts,
    handleValidateAll,
    handleRepairShortcut,
    handleRestoreToDesktop,
    openAppPicker
  } = useDrawerOperations();

  React.useEffect(() => {
    if (!nativeClient.isAvailable()) return undefined;
    return nativeClient.resident.onOpenSettings(() => setShowSettings(true));
  }, [setShowSettings]);

  if (windowMode === 'handle' || (!isDrawerExpanded && windowMode !== 'drawer')) {
    return (
      <button
        type="button"
        onClick={() => windowControl(isDrawerExpanded ? 'collapse-drawer' : 'expand-drawer')}
        className="flex h-screen w-full select-none flex-col items-center justify-center gap-3 rounded-l-2xl bg-[#11131c]/90 text-slate-100 transition-all hover:bg-[#171a24]/90 overflow-hidden shadow-2xl"
        style={{
          WebkitMaskImage: '-webkit-radial-gradient(white, white)',
          boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.5)'
        }}
        title={isDrawerExpanded ? '收起 TidyDesk 抽屉' : '打开 TidyDesk 抽屉'}
      >
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/[0.08] text-sky-100">
          <PackageOpen size={18} />
        </div>
        <div className="[writing-mode:vertical-rl] text-[11px] font-black tracking-[0.24em] text-slate-300">
          TIDYDESK
        </div>
        <ChevronLeft size={16} className={`text-slate-500 ${isDrawerExpanded ? 'rotate-180' : ''}`} />
      </button>
    );
  }

  return (
    <div className="relative flex h-screen w-full select-none overflow-hidden bg-transparent text-slate-100">
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      <div
        className={`flex min-w-0 flex-1 flex-col overflow-hidden bg-[#11131c]/90 ${isClosing ? 'animate-drawer-panel-out' : 'animate-drawer-panel-in'}`}
        style={{ boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.5)' }}
      >
        <DrawerHeader
          activeDrawerTab={activeDrawerTab}
          searchQuery={searchQuery}
          isLoading={isLoading}
          isValidating={isValidating}
          onOpenSettings={() => setShowSettings(true)}
          onValidateAll={handleValidateAll}
          onRefresh={refreshDesktop}
          onCollapse={() => windowControl('collapse-drawer')}
          onSwitchTab={switchDrawerTab}
          onSearchChange={setSearchQuery}
        />

        {activeDrawerTab === 'files' && error && (
          <div className="mx-5 mb-3 flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-500/10 p-3 text-[11px] text-rose-100">
            <span className="flex-1">{error}</span>
            <button type="button" onClick={clearError} className="text-rose-200">
              <X size={13} />
            </button>
          </div>
        )}

        {activeDrawerTab === 'files' && notice && (
          <div className="mx-5 mb-3 flex items-start gap-2 rounded-lg border border-emerald-400/15 bg-emerald-400/10 p-3 text-[11px] leading-4 text-emerald-100">
            <Check size={14} className="mt-0.5 shrink-0" />
            <span className="flex-1">{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-emerald-200">
              <X size={13} />
            </button>
          </div>
        )}

        {activeDrawerTab === 'files' && (
          <InvalidShortcutsBanner
            invalidCount={invalidShortcutsCount}
            isValidating={isValidating}
            isCleaningUp={isCleaningUp}
            onValidateAll={handleValidateAll}
            onCleanupInvalidShortcuts={handleCleanupInvalidShortcuts}
          />
        )}

        {activeDrawerTab === 'files' ? (
          <div className="flex-1 overflow-y-auto px-5 pb-4">
            <div className="mb-4 rounded-lg border border-white/[0.08] bg-white/[0.055] p-4">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-sky-400/15 text-sky-100">
                  <FolderInput size={24} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-bold">拖入桌面图标到抽屉卡片</div>
                  <div className="mt-1 text-[11px] leading-4 text-slate-400">
                    只创建快捷入口，原文件路径不变。确认无依赖后，你再决定是否删除桌面原项。
                  </div>
                </div>
              </div>
              <div className="mt-3 rounded-lg bg-amber-400/10 px-3 py-2 text-[11px] leading-4 text-amber-100">
                <AlertTriangle size={13} className="mr-1 inline align-[-2px]" />
                程序、项目文件、素材引用不建议移动；这里展示的是你已经整理进抽屉的入口。
              </div>
              <div className="mt-3 flex items-center justify-between text-[10px] text-slate-500">
                <span>已整理 {files.filter(f => f.parentId).length} 项</span>
                <span>桌面整洁度 {healthInfo.score}%</span>
              </div>
            </div>

            <div className="space-y-3">
              {allDrawerFiles.map(({ drawer, files: drawerFiles }) => (
                <DrawerCard
                  key={drawer.id}
                  drawer={drawer}
                  drawerFiles={drawerFiles}
                  isDraggingOver={draggingOverDrawerId === drawer.id}
                  isRenaming={renamingDrawerId === drawer.id}
                  draftDrawerName={draftDrawerName}
                  onDraftNameChange={setDraftDrawerName}
                  onStartRename={() => {
                    setDraftDrawerName(drawer.name);
                    setRenamingDrawerId(drawer.id);
                  }}
                  onCancelRename={() => setRenamingDrawerId(null)}
                  onSubmitRename={submitDrawerRename}
                  onDragEnter={() => setDraggingOverDrawerId(drawer.id)}
                  onDragLeave={() => setDraggingOverDrawerId(null)}
                  onDrop={handleDropOnDrawer}
                  onOpenAppPicker={openAppPicker}
                  onDeleteDrawer={id => deleteItem(id, 'folder')}
                  onOpenFile={openFile}
                  onDeleteFile={file => {
                    if (file.isManaged) {
                      setError(`"${file.name}" 已由 TidyDesk 收纳。请先点击还原按钮移回桌面，再删除快捷入口。`);
                      return;
                    }
                    if (confirm(`删除快捷入口 "${file.name}"？原文件不会被删除。`)) {
                      deleteItem(file.id, 'file');
                    }
                  }}
                  onRepairShortcut={handleRepairShortcut}
                  onRestoreToDesktop={handleRestoreToDesktop}
                />
              ))}

              <button
                type="button"
                onClick={handleCreateDrawer}
                disabled={isCreatingDrawer}
                data-testid="drawer-create"
                className="flex h-20 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/[0.12] bg-white/[0.02] text-slate-400 transition-all hover:border-sky-300/40 hover:bg-sky-400/10 hover:text-sky-200 disabled:opacity-50"
              >
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.06]">
                  <PackageOpen size={16} />
                </div>
                <span className="text-[12px] font-semibold">
                  {isCreatingDrawer ? '创建中...' : '新建抽屉'}
                </span>
              </button>
            </div>
          </div>
        ) : (
          <QuickNotesPanel />
        )}
      </div>
    </div>
  );
};
