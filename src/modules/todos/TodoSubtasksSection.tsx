import React, { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
  X
} from 'lucide-react';
import type {
  TodoAttachmentFocalPoint,
  TodoAttachmentPreviewMode,
  TodoSubtask
} from '../../types/todo';
import { TodoAttachmentsSection } from './TodoAttachmentsSection';

export interface SubtaskMediaHandlers {
  coverAttachmentId: string | null;
  isUploading: boolean;
  activeMediaSubtaskId: string | null;
  onActivateTarget: (subtaskId: string | null) => void;
  onOpenCamera: (subtaskId: string) => void;
  onStartSnip: (subtaskId: string) => void;
  onPickImage: (subtaskId: string) => void;
  onUploadFiles: (subtaskId: string, files: FileList | File[]) => void | Promise<void>;
  onSetCover: (attachmentId: string | null) => void;
  onUpdateMeta: (
    subtaskId: string,
    attachmentId: string,
    patch: { focalPoint?: TodoAttachmentFocalPoint; previewMode?: TodoAttachmentPreviewMode }
  ) => void;
  onDeleteAttachment: (subtaskId: string, attachmentId: string) => void;
}

interface TodoSubtasksSectionProps {
  subtasks: TodoSubtask[];
  onChange: (nextSubtasks: TodoSubtask[]) => void | Promise<void>;
  mediaHandlers?: SubtaskMediaHandlers;
  disabled?: boolean;
}

function createDraftSubtaskId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `draft-sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Structured checklist section supporting quick create, toggle, inline edit, reorder, delete,
 * and inline collapsible per-subtask media workspace (camera/snip/picker/drag-drop/lightbox).
 */
export const TodoSubtasksSection: React.FC<TodoSubtasksSectionProps> = ({
  subtasks,
  onChange,
  mediaHandlers,
  disabled = false
}) => {
  const [newTitle, setNewTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [expandedSubtaskId, setExpandedSubtaskId] = useState<string | null>(null);

  useEffect(() => {
    if (expandedSubtaskId && !subtasks.some(item => item.id === expandedSubtaskId)) {
      setExpandedSubtaskId(null);
    }
  }, [expandedSubtaskId, subtasks]);

  const total = subtasks.length;
  const completedCount = subtasks.filter(item => item.completed).length;
  const progressPercent = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  const commitAdd = () => {
    const trimmed = newTitle.trim();
    if (!trimmed || disabled) return;
    const now = String(Date.now());
    const nextItem: TodoSubtask = {
      id: createDraftSubtaskId(),
      title: trimmed,
      completed: false,
      position: '',
      attachments: [],
      attachmentCount: 0,
      createdAt: now,
      updatedAt: now
    };
    setNewTitle('');
    void onChange([...subtasks, nextItem]);
  };

  const toggleItem = (id: string) => {
    if (disabled) return;
    const now = String(Date.now());
    void onChange(
      subtasks.map(item =>
        item.id === id ? { ...item, completed: !item.completed, updatedAt: now } : item
      )
    );
  };

  const startEdit = (item: TodoSubtask) => {
    if (disabled) return;
    setEditingId(item.id);
    setEditingTitle(item.title);
  };

  const commitEdit = () => {
    if (!editingId) return;
    const trimmed = editingTitle.trim();
    const targetId = editingId;
    setEditingId(null);
    if (!trimmed) return;
    const now = String(Date.now());
    void onChange(
      subtasks.map(item =>
        item.id === targetId ? { ...item, title: trimmed, updatedAt: now } : item
      )
    );
  };

  const deleteItem = (item: TodoSubtask) => {
    if (disabled) return;
    const count = item.attachments?.length ?? item.attachmentCount ?? 0;
    if (count > 0 && !confirm(`子任务 "${item.title}" 包含 ${count} 个图片附件，删除后将一并清除，确认删除？`)) {
      return;
    }
    if (editingId === item.id) {
      setEditingId(null);
    }
    if (expandedSubtaskId === item.id) {
      setExpandedSubtaskId(null);
      if (mediaHandlers?.activeMediaSubtaskId === item.id) {
        mediaHandlers.onActivateTarget(null);
      }
    }
    void onChange(subtasks.filter(entry => entry.id !== item.id));
  };

  const moveItem = (index: number, delta: -1 | 1) => {
    if (disabled) return;
    const target = index + delta;
    if (target < 0 || target >= subtasks.length) return;
    const next = [...subtasks];
    const [picked] = next.splice(index, 1);
    next.splice(target, 0, picked);
    const now = String(Date.now());
    void onChange(
      next.map((item, idx) => ({
        ...item,
        position: String(idx).padStart(4, '0'),
        updatedAt: now
      }))
    );
  };

  const toggleSubtaskMedia = (subtaskId: string) => {
    setExpandedSubtaskId(prev => {
      const next = prev === subtaskId ? null : subtaskId;
      mediaHandlers?.onActivateTarget(next);
      return next;
    });
  };

  return (
    <section className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListChecks size={14} className="text-sky-300" />
          <span className="text-[12px] font-bold text-slate-200">子任务清单</span>
          {total > 0 && (
            <span className="rounded-full bg-white/[0.07] px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-300">
              {completedCount}/{total}
            </span>
          )}
        </div>
        {total > 0 && (
          <span className="font-mono text-[10px] text-slate-400">{progressPercent}%</span>
        )}
      </div>

      {total > 0 && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={`h-full transition-all duration-300 ${
              progressPercent === 100 ? 'bg-emerald-400' : 'bg-sky-400'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      <div className="mt-3 space-y-2">
        {subtasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/[0.07] px-3 py-2.5 text-[11px] text-slate-500">
            暂无子任务，在下方输入内容后按回车即可拆分子步骤；展开任意子任务可直接拍照/截屏/传图。
          </div>
        ) : (
          subtasks.map((item, index) => {
            const isEditing = editingId === item.id;
            const subAttachments = item.attachments || [];
            const subAttachmentCount = item.attachmentCount ?? subAttachments.length;
            const isExpanded = expandedSubtaskId === item.id;
            const isTargetFocused = mediaHandlers?.activeMediaSubtaskId === item.id;

            return (
              <div
                key={item.id}
                className={`rounded-lg border transition-colors ${
                  isExpanded
                    ? isTargetFocused
                      ? 'border-sky-400/40 bg-white/[0.045]'
                      : 'border-white/[0.12] bg-white/[0.04]'
                    : 'border-white/[0.06] bg-white/[0.03] hover:border-white/[0.12] hover:bg-white/[0.05]'
                }`}
              >
                <div className="group flex items-center gap-2 px-2.5 py-2">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleItem(item.id)}
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors ${
                      item.completed
                        ? 'border-emerald-400/70 bg-emerald-500/80 text-white'
                        : 'border-slate-500/70 bg-transparent hover:border-sky-300'
                    }`}
                    title={item.completed ? '标为未完成' : '标为已完成'}
                  >
                    {item.completed && <Check size={11} strokeWidth={3} />}
                  </button>

                  {isEditing ? (
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <input
                        autoFocus
                        value={editingTitle}
                        onChange={event => setEditingTitle(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            event.stopPropagation();
                            commitEdit();
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            event.stopPropagation();
                            setEditingId(null);
                          }
                        }}
                        onBlur={commitEdit}
                        className="h-7 min-w-0 flex-1 rounded border border-sky-400/40 bg-slate-950/60 px-2 text-[12px] text-slate-100 outline-none"
                      />
                      <button
                        type="button"
                        onMouseDown={event => {
                          event.preventDefault();
                          commitEdit();
                        }}
                        className="rounded p-1 text-emerald-300 hover:bg-emerald-500/15"
                        title="保存"
                      >
                        <Check size={12} />
                      </button>
                      <button
                        type="button"
                        onMouseDown={event => {
                          event.preventDefault();
                          setEditingId(null);
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-white/10"
                        title="取消"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onDoubleClick={() => startEdit(item)}
                        onClick={() => startEdit(item)}
                        className={`min-w-0 flex-1 truncate text-left text-[12px] ${
                          item.completed ? 'text-slate-500 line-through' : 'text-slate-200'
                        }`}
                        title="点击编辑子任务内容"
                      >
                        {item.title}
                      </button>

                      {/* Inline mini preview thumbs + media drawer toggle */}
                      {mediaHandlers && (
                        <button
                          type="button"
                          onClick={() => toggleSubtaskMedia(item.id)}
                          className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                            isExpanded || subAttachmentCount > 0
                              ? 'border-sky-400/30 bg-sky-400/10 text-sky-200 hover:bg-sky-400/20'
                              : 'border-white/[0.08] bg-white/[0.04] text-slate-400 opacity-75 hover:bg-white/[0.1] hover:text-slate-200 group-hover:opacity-100'
                          }`}
                          title={isExpanded ? '收起子任务多媒体区' : '展开子任务拍照/截屏/图片附件'}
                        >
                          {subAttachments.slice(0, 2).map(att => {
                            const src = att.thumbUrl || att.assetUrl;
                            return src ? (
                              <img
                                key={att.id}
                                src={src}
                                alt=""
                                className="h-4 w-4 rounded-sm object-cover"
                              />
                            ) : null;
                          })}
                          <Camera size={11} />
                          {subAttachmentCount > 0 && (
                            <span className="font-mono">{subAttachmentCount}</span>
                          )}
                          {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        </button>
                      )}

                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          disabled={disabled || index === 0}
                          onClick={() => moveItem(index, -1)}
                          className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100 disabled:opacity-30"
                          title="上移"
                        >
                          <ArrowUp size={11} />
                        </button>
                        <button
                          type="button"
                          disabled={disabled || index === subtasks.length - 1}
                          onClick={() => moveItem(index, 1)}
                          className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100 disabled:opacity-30"
                          title="下移"
                        >
                          <ArrowDown size={11} />
                        </button>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => startEdit(item)}
                          className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100"
                          title="编辑"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => deleteItem(item)}
                          className="rounded p-1 text-slate-400 hover:bg-rose-500/20 hover:text-rose-200"
                          title="删除子任务"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {isExpanded && mediaHandlers && (
                  <div className="border-t border-white/[0.06] p-2.5">
                    <TodoAttachmentsSection
                      compact
                      title={`子任务「${item.title}」附件`}
                      attachments={subAttachments}
                      coverAttachmentId={mediaHandlers.coverAttachmentId}
                      isUploading={mediaHandlers.isUploading}
                      onActivateTarget={() => mediaHandlers.onActivateTarget(item.id)}
                      onOpenCamera={() => mediaHandlers.onOpenCamera(item.id)}
                      onStartSnip={() => mediaHandlers.onStartSnip(item.id)}
                      onPickImage={() => mediaHandlers.onPickImage(item.id)}
                      onUploadFiles={files => mediaHandlers.onUploadFiles(item.id, files)}
                      onSetCover={mediaHandlers.onSetCover}
                      onUpdateMeta={(attachmentId, patch) =>
                        mediaHandlers.onUpdateMeta(item.id, attachmentId, patch)
                      }
                      onDeleteAttachment={attachmentId =>
                        mediaHandlers.onDeleteAttachment(item.id, attachmentId)
                      }
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <input
          value={newTitle}
          disabled={disabled}
          onChange={event => setNewTitle(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitAdd();
            }
          }}
          placeholder="输入子任务标题，回车新增..."
          className="h-8 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-400/40"
        />
        <button
          type="button"
          disabled={disabled || !newTitle.trim()}
          onClick={commitAdd}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-sky-400/20 px-2.5 text-[11px] font-semibold text-sky-100 hover:bg-sky-400/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={13} />
          添加
        </button>
      </div>
    </section>
  );
};
