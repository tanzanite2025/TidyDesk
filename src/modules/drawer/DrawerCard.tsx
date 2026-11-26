import React from 'react';
import { Check, Folder, PackageOpen, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { TidyFile, TidyFolder } from '../../types/file';
import { FileTile } from './FileTile';

interface DrawerCardProps {
  drawer: TidyFolder;
  drawerFiles: TidyFile[];
  isDraggingOver: boolean;
  isRenaming: boolean;
  draftDrawerName: string;
  onDraftNameChange: (name: string) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onSubmitRename: (event: React.FormEvent, drawerId: string) => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent, drawerId: string) => void;
  onOpenAppPicker: (drawerName: string) => void;
  onDeleteDrawer: (drawerId: string, drawerName: string) => void;
  onOpenFile: (path: string) => void;
  onDeleteFile: (file: TidyFile) => void;
  onRepairShortcut: (fileId: string, fileName: string) => void;
  onRestoreToDesktop: (fileId: string, fileName: string) => void;
}

/**
 * Single drawer card showing its rename header, drop target, and file tiles.
 */
export const DrawerCard: React.FC<DrawerCardProps> = ({
  drawer,
  drawerFiles,
  isDraggingOver,
  isRenaming,
  draftDrawerName,
  onDraftNameChange,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  onDragEnter,
  onDragLeave,
  onDrop,
  onOpenAppPicker,
  onDeleteDrawer,
  onOpenFile,
  onDeleteFile,
  onRepairShortcut,
  onRestoreToDesktop
}) => {
  const invalidCount = drawerFiles.filter(f => f.isValid === false).length;

  return (
    <div
      data-testid="drawer-card"
      data-drawer-name={drawer.name}
      className={`rounded-lg border transition-all ${
        isDraggingOver
          ? 'border-sky-300/60 bg-sky-400/15'
          : 'border-white/[0.08] bg-white/[0.04]'
      }`}
      onDragEnter={event => {
        event.preventDefault();
        event.stopPropagation();
        onDragEnter();
      }}
      onDragOver={event => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDragLeave={event => {
        event.preventDefault();
        event.stopPropagation();
        if (event.currentTarget === event.target) {
          onDragLeave();
        }
      }}
      onDrop={event => onDrop(event, drawer.id)}
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        {isRenaming ? (
          <form onSubmit={event => onSubmitRename(event, drawer.id)} className="flex min-w-0 flex-1 items-center gap-2">
            <input
              autoFocus
              value={draftDrawerName}
              onChange={event => onDraftNameChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') onCancelRename();
              }}
              className="h-8 flex-1 rounded-md border border-white/[0.12] bg-white/[0.08] px-2 text-[13px] font-bold text-slate-100 outline-none"
            />
            <button type="submit" className="rounded-md p-1.5 text-emerald-200 hover:bg-emerald-400/10">
              <Check size={14} />
            </button>
            <button type="button" onClick={onCancelRename} className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08]">
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
                onClick={() => onOpenAppPicker(drawer.name)}
                data-testid="drawer-add-app"
                className="rounded-md p-1.5 text-slate-500 hover:bg-emerald-500/15 hover:text-emerald-200"
                title="添加应用"
              >
                <Plus size={13} />
              </button>
              <button
                type="button"
                onClick={onStartRename}
                className="rounded-md p-1.5 text-slate-500 hover:bg-white/[0.08] hover:text-slate-100"
                title="重命名"
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`删除抽屉 "${drawer.name}"？\n\n抽屉内的所有快捷方式也会被删除（原文件不受影响）。`)) {
                    onDeleteDrawer(drawer.id, drawer.name);
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
                onOpen={() => onOpenFile(file.path)}
                onDelete={() => onDeleteFile(file)}
                onRepair={file.isValid === false ? () => onRepairShortcut(file.id, file.name) : undefined}
                onRestore={file.isValid !== false && file.isManaged ? () => onRestoreToDesktop(file.id, file.name) : undefined}
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
};
