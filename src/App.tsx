import React, { useEffect, useMemo, useState } from 'react';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FileCategory, TidyFile } from './types/file';
import {
  AlertTriangle,
  AppWindow,
  Check,
  ChevronLeft,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileText,
  Folder,
  FolderInput,
  PackageOpen,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X
} from 'lucide-react';

type TidyDeskWindowApi = {
  getPathForFile: (file: globalThis.File) => string;
  onDrawerState: (callback: (payload: { expanded: boolean }) => void) => () => void;
};

const tidyDeskWindowApi: TidyDeskWindowApi | null = (window as any).tidyDesk || null;
const windowMode = new URLSearchParams(window.location.search).get('mode');

function getPathFromDroppedFile(file: globalThis.File): string | null {
  if ((file as any).path) return (file as any).path;
  if (tidyDeskWindowApi?.getPathForFile) return tidyDeskWindowApi.getPathForFile(file);
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const unit = 1024;
  const labels = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(unit)), labels.length - 1);
  return `${parseFloat((bytes / Math.pow(unit, index)).toFixed(1))} ${labels[index]}`;
}

function categoryIcon(category: FileCategory) {
  switch (category) {
    case 'image':
      return <FileImage size={22} />;
    case 'document':
      return <FileText size={22} />;
    case 'archive':
      return <FileArchive size={22} />;
    case 'developer':
      return <FileCode size={22} />;
    case 'app':
      return <AppWindow size={22} />;
    case 'folder':
      return <Folder size={22} />;
    default:
      return <File size={22} />;
  }
}

function categoryTone(category: FileCategory): string {
  const tones: Record<FileCategory, string> = {
    image: 'bg-violet-500/16 text-violet-200',
    document: 'bg-sky-500/16 text-sky-200',
    archive: 'bg-amber-500/16 text-amber-200',
    app: 'bg-emerald-500/16 text-emerald-200',
    developer: 'bg-cyan-500/16 text-cyan-200',
    temporary: 'bg-rose-500/16 text-rose-200',
    folder: 'bg-amber-500/16 text-amber-200',
    other: 'bg-slate-500/16 text-slate-200'
  };
  return tones[category];
}

function FileTile({ file, onOpen, onDelete }: { file: TidyFile; onOpen: () => void; onDelete: () => void }) {
  return (
    <div className="group relative h-[112px] rounded-lg border border-white/[0.07] bg-white/[0.055] px-3 py-3 transition-all hover:bg-white/[0.09]">
      <button type="button" onClick={onOpen} className="block h-full w-full text-left">
        <div className={`grid h-10 w-10 place-items-center rounded-lg ${categoryTone(file.category)}`}>
          {categoryIcon(file.category)}
        </div>
        <div className="mt-3 truncate text-[12px] font-semibold text-slate-100" title={file.name}>
          {file.name}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500">
          <span>{formatBytes(file.size)}</span>
          {file.extension && <span>{file.extension.replace('.', '').toUpperCase()}</span>}
        </div>
      </button>
      <button
        type="button"
        onClick={event => {
          event.stopPropagation();
          onDelete();
        }}
        className="absolute right-2 top-2 hidden rounded-md p-1 text-slate-500 hover:bg-rose-500/15 hover:text-rose-200 group-hover:block"
        title="删除快捷入口"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

const DrawerApp: React.FC = () => {
  const {
    files,
    folders,
    healthInfo,
    isLoading,
    error,
    refreshDesktop,
    createDrawer,
    renameItem,
    deleteItem,
    importExternalFiles,
    openFile,
    clearError,
    windowControl
  } = useWorkspace();

  const [searchQuery, setSearchQuery] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isDrawerExpanded, setIsDrawerExpanded] = useState(false);
  const [isRenamingDrawer, setIsRenamingDrawer] = useState(false);
  const [draftDrawerName, setDraftDrawerName] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const isDrawerExpandedRef = React.useRef(isDrawerExpanded);
  
  // 防抖搜索
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    
    return () => clearTimeout(timer);
  }, [searchQuery]);
  
  // 保持 ref 同步
  React.useEffect(() => {
    isDrawerExpandedRef.current = isDrawerExpanded;
  }, [isDrawerExpanded]);

  const drawer = folders[0] || null;
  const drawerFiles = drawer ? files.filter(file => file.parentId === drawer.id) : [];
  const filteredFiles = useMemo(() => {
    const query = debouncedSearchQuery.trim().toLowerCase();
    if (!query) return drawerFiles;
    return drawerFiles.filter(file => file.name.toLowerCase().includes(query));
  }, [drawerFiles, debouncedSearchQuery]);

  useEffect(() => {
    if (!tidyDeskWindowApi) return;
    
    const unsubscribe = tidyDeskWindowApi.onDrawerState(payload => {
      if (!payload.expanded && isDrawerExpandedRef.current) {
        // 触发收起动画
        setIsClosing(true);
        setTimeout(() => {
          setIsDrawerExpanded(false);
          setIsClosing(false);
        }, 200); // 与 CSS 动画时长匹配
      } else {
        setIsDrawerExpanded(payload.expanded);
        setIsClosing(false);
      }
    });
    
    return unsubscribe;
  }, []); // ✅ 只注册一次，使用 ref 避免闭包问题

  useEffect(() => {
    if (!drawer && folders.length === 0) {
      createDrawer('收纳抽屉');
    }
  }, [createDrawer, drawer, folders.length]);

  async function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setIsDraggingOver(false);

    const filePaths = Array.from(event.dataTransfer.files)
      .map(getPathFromDroppedFile)
      .filter((filePath): filePath is string => Boolean(filePath));

    if (filePaths.length === 0) return;

    await importExternalFiles(filePaths, drawer?.id || null);
    setNotice('已加入抽屉。这里只创建快捷入口，原桌面文件没有移动。');
  }

  async function submitDrawerRename(event: React.FormEvent) {
    event.preventDefault();
    const nextName = draftDrawerName.trim();
    if (!drawer || !nextName) return;

    await renameItem(drawer.id, 'folder', nextName);
    setIsRenamingDrawer(false);
  }

  const drawerName = drawer?.name || '收纳抽屉';

  if (windowMode === 'handle' || (!isDrawerExpanded && windowMode !== 'drawer')) {
    return (
      <button
        type="button"
        onClick={() => windowControl(isDrawerExpanded ? 'collapse-drawer' : 'expand-drawer')}
        onDragOver={event => event.preventDefault()}
        onDrop={handleDrop}
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
    <div
      className="relative flex h-screen w-full select-none overflow-hidden bg-transparent text-slate-100"
      onDragEnter={() => setIsDraggingOver(true)}
      onDragOver={event => event.preventDefault()}
      onDragLeave={event => {
        if (event.currentTarget === event.target) setIsDraggingOver(false);
      }}
      onDrop={handleDrop}
    >
      <div 
        className={`flex min-w-0 flex-1 flex-col overflow-hidden bg-[#11131c]/90 ${isClosing ? 'animate-drawer-panel-out' : 'animate-drawer-panel-in'}`}
        style={{ boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.5)' }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <div className="flex min-w-0 items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.08] text-slate-200">
              <PackageOpen size={18} />
            </div>
            {isRenamingDrawer ? (
              <form onSubmit={submitDrawerRename} className="flex min-w-0 items-center gap-2">
                <input
                  autoFocus
                  value={draftDrawerName}
                  onChange={event => setDraftDrawerName(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Escape') setIsRenamingDrawer(false);
                  }}
                  className="h-8 w-40 rounded-md border border-white/[0.12] bg-white/[0.08] px-2 text-[13px] font-bold text-slate-100 outline-none"
                />
                <button type="submit" className="rounded-md p-1.5 text-emerald-200 hover:bg-emerald-400/10">
                  <Check size={14} />
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDraftDrawerName(drawerName);
                  setIsRenamingDrawer(true);
                }}
                className="min-w-0 text-left"
              >
                <div className="flex items-center gap-2">
                  <div className="truncate text-[14px] font-black tracking-tight text-slate-100">{drawerName}</div>
                  <Pencil size={12} className="text-slate-500" />
                </div>
                <div className="text-[9px] uppercase tracking-[0.22em] text-slate-500">Shortcut drawer</div>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button type="button" onClick={refreshDesktop} className="rounded-md p-2 text-slate-500 hover:bg-white/[0.08] hover:text-slate-100">
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={() => windowControl('collapse-drawer')} className="rounded-md p-2 text-slate-500 hover:bg-rose-500/15 hover:text-rose-200" title="收起抽屉">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-500" size={15} />
            <input
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              className="h-10 w-full rounded-lg border border-white/[0.07] bg-white/[0.06] pl-9 pr-3 text-[12px] font-medium text-slate-100 outline-none placeholder:text-slate-500 focus:border-white/20"
              placeholder="搜索抽屉里的入口..."
            />
          </div>
        </div>

        {error && (
          <div className="mx-5 mb-3 flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-500/10 p-3 text-[11px] text-rose-100">
            <span className="flex-1">{error}</span>
            <button type="button" onClick={clearError} className="text-rose-200">
              <X size={13} />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          <div
            className={`mb-4 rounded-lg border p-4 transition-all ${
              isDraggingOver ? 'border-sky-300/60 bg-sky-400/14' : 'border-white/[0.08] bg-white/[0.055]'
            }`}
            onDragOver={event => event.preventDefault()}
            onDrop={handleDrop}
          >
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-sky-400/15 text-sky-100">
                <FolderInput size={24} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-bold">拖入桌面图标</div>
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
              <span>已整理 {drawerFiles.length} 项</span>
              <span>桌面整洁度 {healthInfo.score}%</span>
            </div>
          </div>

          {notice && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-400/15 bg-emerald-400/10 p-3 text-[11px] leading-4 text-emerald-100">
              <Check size={14} className="mt-0.5 shrink-0" />
              <span className="flex-1">{notice}</span>
              <button type="button" onClick={() => setNotice(null)} className="text-emerald-200">
                <X size={13} />
              </button>
            </div>
          )}

          {filteredFiles.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {filteredFiles.map(file => (
                <FileTile
                  key={file.id}
                  file={file}
                  onOpen={() => openFile(file.path)}
                  onDelete={() => {
                    if (confirm(`删除快捷入口 "${file.name}"？原文件不会被删除。`)) deleteItem(file.id, 'file');
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="grid min-h-[220px] place-items-center rounded-lg border border-dashed border-white/[0.08] text-center text-[12px] text-slate-500">
              <div>
                <PackageOpen className="mx-auto mb-2" size={24} />
                这个抽屉还没有入口
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => (
  <ErrorBoundary>
    <WorkspaceProvider>
      <DrawerApp />
    </WorkspaceProvider>
  </ErrorBoundary>
);

export default App;
