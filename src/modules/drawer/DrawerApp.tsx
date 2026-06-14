import React from 'react';
import { useDrawerOperations } from './useDrawerOperations';
import { SettingsPanel } from '../../components/SettingsPanel';
import { FileTile } from './FileTile';
import { QuickNotesPanel } from '../notes/QuickNotesPanel';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Folder,
  FolderInput,
  PackageOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  X,
  Wrench
} from 'lucide-react';

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
        <div className="flex items-center justify-between px-5 py-4" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <div className="flex min-w-0 items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.08] text-slate-200">
              <PackageOpen size={18} />
            </div>
            <div className="min-w-0 text-left">
              <div className="truncate text-[14px] font-black tracking-tight text-slate-100">TidyDesk</div>
              <div className="text-[9px] uppercase tracking-[0.22em] text-slate-500">{activeDrawerTab === 'files' ? 'Shortcut drawers' : 'Quick notes'}</div>
            </div>
          </div>

          <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button 
              type="button" 
              onClick={() => setShowSettings(true)} 
              data-testid="drawer-settings"
              className="rounded-md p-2 text-slate-500 hover:bg-white/[0.08] hover:text-slate-100" 
              title="设置"
            >
              <Settings size={14} />
            </button>
            <button 
              type="button" 
              onClick={handleValidateAll} 
              disabled={isValidating}
              data-testid="drawer-validate-shortcuts"
              className="rounded-md p-2 text-slate-500 hover:bg-white/[0.08] hover:text-slate-100 disabled:opacity-50" 
              title="验证所有快捷方式"
            >
              <Wrench size={14} className={isValidating ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={refreshDesktop} data-testid="drawer-refresh" className="rounded-md p-2 text-slate-500 hover:bg-white/[0.08] hover:text-slate-100" title="刷新">
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={() => windowControl('collapse-drawer')} data-testid="drawer-collapse" className="rounded-md p-2 text-slate-500 hover:bg-rose-500/15 hover:text-rose-200" title="收起抽屉">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="px-5 pb-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="flex gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] p-1">
            <button
              type="button"
              onClick={() => switchDrawerTab('files')}
              className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-md text-[12px] font-bold transition-all ${
                activeDrawerTab === 'files'
                  ? 'bg-white/[0.12] text-slate-100'
                  : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
              }`}
            >
              <PackageOpen size={14} />
              桌面收纳
            </button>
            <button
              type="button"
              onClick={() => switchDrawerTab('capture')}
              className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-md text-[12px] font-bold transition-all ${
                activeDrawerTab === 'capture'
                  ? 'bg-white/[0.12] text-slate-100'
                  : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
              }`}
            >
              <Pencil size={14} />
              快捷记录
            </button>
          </div>
        </div>

        {activeDrawerTab === 'files' && (
          <div className="px-5 pb-3">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-slate-500" size={15} />
              <input
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                className="h-10 w-full rounded-lg border border-white/[0.07] bg-white/[0.06] pl-9 pr-3 text-[12px] font-medium text-slate-100 outline-none placeholder:text-slate-500 focus:border-white/20"
                placeholder="搜索所有抽屉..."
              />
            </div>
          </div>
        )}

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

        {activeDrawerTab === 'files' && invalidShortcutsCount > 0 && (
          <div className="mx-5 mb-3 rounded-lg border border-amber-400/20 bg-amber-500/10 p-3">
            <div className="flex items-start gap-2 text-[11px] leading-4 text-amber-100">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-semibold">发现 {invalidShortcutsCount} 个失效的快捷方式</div>
                <div className="mt-1 text-[10px] text-amber-200/80">
                  目标文件已被移动或删除，快捷方式无法打开。点击修复按钮尝试自动修复。
                </div>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={handleValidateAll}
                disabled={isValidating}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-sky-400/20 px-3 py-1.5 text-[11px] font-semibold text-sky-100 transition-all hover:bg-sky-400/30 disabled:opacity-50"
              >
                <Wrench size={12} />
                {isValidating ? '修复中...' : '尝试智能修复'}
              </button>
              <button
                type="button"
                onClick={handleCleanupInvalidShortcuts}
                disabled={isCleaningUp}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-amber-400/20 px-3 py-1.5 text-[11px] font-semibold text-amber-100 transition-all hover:bg-amber-400/30 disabled:opacity-50"
              >
                <Trash2 size={12} />
                {isCleaningUp ? '清理中...' : '清理失效快捷方式'}
              </button>
            </div>
          </div>
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
              {allDrawerFiles.map(({ drawer, files: drawerFiles }) => {
                const invalidCount = drawerFiles.filter(f => f.isValid === false).length;
                
                return (
                <div
                  key={drawer.id}
                  data-testid="drawer-card"
                  data-drawer-name={drawer.name}
                  className={`rounded-lg border transition-all ${
                    draggingOverDrawerId === drawer.id
                      ? 'border-sky-300/60 bg-sky-400/14'
                      : 'border-white/[0.08] bg-white/[0.04]'
                  }`}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDraggingOverDrawerId(drawer.id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.currentTarget === e.target) {
                      setDraggingOverDrawerId(null);
                    }
                  }}
                  onDrop={(e) => handleDropOnDrawer(e, drawer.id)}
                >
                  <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                    {renamingDrawerId === drawer.id ? (
                      <form onSubmit={(e) => submitDrawerRename(e, drawer.id)} className="flex min-w-0 flex-1 items-center gap-2">
                        <input
                          autoFocus
                          value={draftDrawerName}
                          onChange={event => setDraftDrawerName(event.target.value)}
                          onKeyDown={event => {
                            if (event.key === 'Escape') setRenamingDrawerId(null);
                          }}
                          className="h-8 flex-1 rounded-md border border-white/[0.12] bg-white/[0.08] px-2 text-[13px] font-bold text-slate-100 outline-none"
                        />
                        <button type="submit" className="rounded-md p-1.5 text-emerald-200 hover:bg-emerald-400/10">
                          <Check size={14} />
                        </button>
                        <button type="button" onClick={() => setRenamingDrawerId(null)} className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08]">
                          <X size={14} />
                        </button>
                      </form>
                    ) : (
                      <>
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <Folder size={16} className="shrink-0 text-amber-300" />
                          <span className="truncate text-[13px] font-bold text-slate-100">{drawer.name}</span>
                          <span className="shrink-0 text-[11px] text-slate-500">({drawerFiles.length})</span>
                          {invalidCount > 0 && (
                            <span className="shrink-0 rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-rose-200" title={`${invalidCount} 个失效`}>
                              ⚠️ {invalidCount}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openAppPicker(drawer.name)}
                            data-testid="drawer-add-app"
                            className="rounded-md p-1.5 text-slate-500 hover:bg-emerald-500/15 hover:text-emerald-200"
                            title="添加应用"
                          >
                            <Plus size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDraftDrawerName(drawer.name);
                              setRenamingDrawerId(drawer.id);
                            }}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-white/[0.08] hover:text-slate-100"
                            title="重命名"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`删除抽屉 "${drawer.name}"？\n\n抽屉内的所有快捷方式也会被删除（原文件不受影响）。`)) {
                                deleteItem(drawer.id, 'folder');
                              }
                            }}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-rose-500/15 hover:text-rose-200"
                            title="删除抽屉"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="p-3">
                    {drawerFiles.length > 0 ? (
                      <div className="grid grid-cols-3 gap-2">
                        {drawerFiles.map(file => (
                          <FileTile
                            key={file.id}
                            file={file}
                            onOpen={() => openFile(file.path)}
                            onDelete={() => {
                              if (file.targetPath?.includes('storage')) {
                                alert(`"${file.name}" 已由 TidyDesk 收纳。请先点击还原按钮移回桌面，再删除快捷入口。`);
                                return;
                              }
                              if (confirm(`删除快捷入口 "${file.name}"？原文件不会被删除。`)) deleteItem(file.id, 'file');
                            }}
                          onRepair={file.isValid === false ? () => handleRepairShortcut(file.id, file.name) : undefined}
                          onRestore={file.isValid !== false && file.targetPath?.includes('storage') ? () => handleRestoreToDesktop(file.id, file.name) : undefined}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="grid h-32 place-items-center rounded-lg border border-dashed border-white/[0.06] text-center text-[11px] text-slate-500">
                      <div>
                        <PackageOpen className="mx-auto mb-1.5 opacity-40" size={20} />
                        拖入文件到这里
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
            })}

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
