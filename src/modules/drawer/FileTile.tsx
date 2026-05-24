import { AppWindow, File, FileArchive, FileCode, FileImage, FileText, Folder, Trash2, Undo2, Wrench } from 'lucide-react';
import type { FileCategory, TidyFile } from '../../types/file';

interface FileTileProps {
  file: TidyFile;
  onOpen: () => void;
  onDelete: () => void;
  onRepair?: () => void;
  onRestore?: () => void;
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

export function FileTile({ file, onOpen, onDelete, onRepair, onRestore }: FileTileProps) {
  const isInvalid = file.isValid === false;

  return (
    <div className={`group relative h-[112px] rounded-lg border px-3 py-3 transition-all ${
      isInvalid
        ? 'border-rose-400/30 bg-rose-500/10 opacity-60'
        : 'border-white/[0.07] bg-white/[0.055] hover:bg-white/[0.09]'
    }`}>
      <button
        type="button"
        onClick={onOpen}
        className="block h-full w-full text-left"
        disabled={isInvalid}
        title={isInvalid ? `目标文件不存在: ${file.targetPath || '未知'}` : file.name}
      >
        <div className={`grid h-10 w-10 place-items-center rounded-lg ${file.icon ? '' : categoryTone(file.category)} ${isInvalid ? 'opacity-50' : ''}`}>
          {file.icon ? (
            <img src={file.icon} alt={file.name} className="h-8 w-8" />
          ) : (
            categoryIcon(file.category)
          )}
        </div>
        <div className="mt-3 truncate text-[12px] font-semibold text-slate-100" title={file.name}>
          {file.name}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500">
          {isInvalid ? (
            <span className="text-rose-300">⚠️ 失效</span>
          ) : (
            <>
              <span>{formatBytes(file.size)}</span>
              {file.extension && <span>{file.extension.replace('.', '').toUpperCase()}</span>}
            </>
          )}
        </div>
      </button>
      <div className="absolute right-2 top-2 hidden items-center gap-1 group-hover:flex">
        {isInvalid && onRepair && (
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onRepair();
            }}
            className="rounded-md p-1 text-slate-500 hover:bg-sky-500/15 hover:text-sky-200"
            title="尝试智能修复"
          >
            <Wrench size={13} />
          </button>
        )}
        {!isInvalid && onRestore && (
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onRestore();
            }}
            className="rounded-md p-1 text-slate-500 hover:bg-emerald-500/15 hover:text-emerald-200"
            title="还原到桌面"
          >
            <Undo2 size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={event => {
            event.stopPropagation();
            onDelete();
          }}
          className="rounded-md p-1 text-slate-500 hover:bg-rose-500/15 hover:text-rose-200"
          title={isInvalid ? '删除失效的快捷方式' : '删除快捷入口'}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
