import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Check,
  CheckSquare,
  Edit3,
  Eye,
  FileText,
  Heading1,
  Italic,
  Link,
  List,
  Loader2,
  Table2,
  Trash2,
  X
} from 'lucide-react';
import { useTodos } from '../../context/TodoContext';
import type {
  TodoAttachmentFocalPoint,
  TodoAttachmentPreviewMode,
  TodoCard,
  TodoSubtask
} from '../../types/todo';
import { MarkdownPreview } from './MarkdownPreview';
import { isAttachmentFileOversized, isImageFile } from './mediaUtils';
import { TodoAttachmentsSection } from './TodoAttachmentsSection';
import { TodoCameraModal } from './TodoCameraModal';
import { TodoSubtasksSection } from './TodoSubtasksSection';

type EditorMode = 'write' | 'preview';

const MarkdownToolbar: React.FC<{
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onInsert: (before: string, after?: string, placeholder?: string) => void;
}> = ({ mode, onModeChange, onInsert }) => (
  <div className="flex flex-wrap items-center gap-1 border-b border-white/[0.08] bg-white/[0.03] px-3 py-1.5">
    <button
      type="button"
      title="标题"
      onClick={() => onInsert('# ', '', '标题')}
      className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100"
    >
      <Heading1 size={14} />
    </button>
    <button
      type="button"
      title="列表"
      onClick={() => onInsert('- ', '', '列表项')}
      className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100"
    >
      <List size={14} />
    </button>
    <button
      type="button"
      title="任务项"
      onClick={() => onInsert('- [ ] ', '', '任务')}
      className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100"
    >
      <CheckSquare size={14} />
    </button>
    <button
      type="button"
      title="加粗"
      onClick={() => onInsert('**', '**', '加粗')}
      className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100"
    >
      <Bold size={14} />
    </button>
    <button
      type="button"
      title="斜体"
      onClick={() => onInsert('*', '*', '斜体')}
      className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100"
    >
      <Italic size={14} />
    </button>
    <button
      type="button"
      title="链接"
      onClick={() => onInsert('[', '](https://)', '链接文字')}
      className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100"
    >
      <Link size={14} />
    </button>
    <button
      type="button"
      title="表格"
      onClick={() => onInsert('\n| 项目 | 说明 |\n| --- | --- |\n| ', ' |  |\n', '内容')}
      className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100"
    >
      <Table2 size={14} />
    </button>
    <div className="ml-auto flex rounded-md border border-white/[0.08] bg-black/20 p-0.5">
      <button
        type="button"
        title="编辑"
        onClick={() => onModeChange('write')}
        className={`rounded px-2 py-1 ${
          mode === 'write' ? 'bg-white/[0.12] text-slate-100' : 'text-slate-500 hover:text-slate-200'
        }`}
      >
        <Edit3 size={13} />
      </button>
      <button
        type="button"
        title="预览"
        onClick={() => onModeChange('preview')}
        className={`rounded px-2 py-1 ${
          mode === 'preview'
            ? 'bg-white/[0.12] text-slate-100'
            : 'text-slate-500 hover:text-slate-200'
        }`}
      >
        <Eye size={13} />
      </button>
    </div>
  </div>
);

interface TodoCardModalProps {
  mode: 'create' | 'detail';
  defaultColumnId?: string;
  selectedCardSummary: TodoCard | null;
  onSwitchToDetail: (cardId: string) => void;
  onClose: () => void;
}

/**
 * Unified centered Create & Detail workbench modal: adapts between 2-column desktop workbench
 * (left description/subtasks, right layered media gallery) on >=1024px viewports and single-column scroll on narrow screens.
 */
export const TodoCardModal: React.FC<TodoCardModalProps> = ({
  mode,
  defaultColumnId = 'todo',
  selectedCardSummary,
  onSwitchToDetail,
  onClose
}) => {
  const {
    board,
    isUploadingAttachment,
    error: contextError,
    createCard,
    updateCard,
    deleteCard,
    moveCard,
    getCardDetail,
    addAttachmentBytes,
    pickAndAddAttachment,
    deleteAttachment,
    setCardCover,
    updateAttachmentMeta,
    startSnipForCard,
    clearError
  } = useTodos();

  // Detail state hydrated on demand from Rust (driven by summary revision changes)
  const [detailCard, setDetailCard] = useState<TodoCard | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Shared draft state
  const [title, setTitle] = useState('');
  const [columnId, setColumnId] = useState(defaultColumnId);
  const [content, setContent] = useState('');
  const [subtasks, setSubtasks] = useState<TodoSubtask[]>([]);
  const [editorMode, setEditorMode] = useState<EditorMode>('write');
  const [isDirty, setIsDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalNotice, setModalNotice] = useState<string | null>(null);
  const [cameraTarget, setCameraTarget] = useState<{ subtaskId: string | null } | null>(null);
  const [activeMediaSubtaskId, setActiveMediaSubtaskId] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const draftRef = useRef({ cardId: null as string | null, title: '', content: '' });
  const subtaskSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Reset form when entering Create mode
  useEffect(() => {
    if (mode !== 'create') return;
    setDetailCard(null);
    setTitle('');
    setColumnId(defaultColumnId);
    setContent('');
    setSubtasks([]);
    setEditorMode('write');
    setIsDirty(false);
    setModalNotice(null);
    setCameraTarget(null);
    setActiveMediaSubtaskId(null);
  }, [defaultColumnId, mode]);

  // Hydrate Detail mode whenever cardId or card revision changes (Single Source of Truth)
  useEffect(() => {
    if (mode !== 'detail' || !selectedCardSummary) {
      return;
    }

    const isImmediateCardSwitch = detailCard !== null && detailCard.id !== selectedCardSummary.id;
    if (isImmediateCardSwitch) {
      setDetailCard(null);
      setTitle(selectedCardSummary.title);
      setColumnId(selectedCardSummary.columnId);
      setContent(selectedCardSummary.content ?? '');
      setSubtasks([]);
      setEditorMode('write');
      setIsDirty(false);
      setModalNotice(null);
      setCameraTarget(null);
      setActiveMediaSubtaskId(null);
    }

    let disposed = false;
    setIsLoadingDetail(prev => prev || detailCard?.id !== selectedCardSummary.id);
    void getCardDetail(selectedCardSummary.id)
      .then(detail => {
        if (disposed || !detail) return;
        const isInitialHydrate = detailCard?.id !== detail.id;
        setDetailCard(detail);
        if (isInitialHydrate) {
          setTitle(detail.title);
          setContent(detail.content ?? '');
          setEditorMode('write');
          setIsDirty(false);
          setModalNotice(null);
        } else if (!isDirty) {
          setTitle(detail.title);
          setContent(detail.content ?? '');
        }
        setColumnId(detail.columnId);
        setSubtasks(detail.subtasks || []);
      })
      .finally(() => {
        if (!disposed) setIsLoadingDetail(false);
      });

    return () => {
      disposed = true;
    };
  }, [
    detailCard?.id,
    getCardDetail,
    isDirty,
    mode,
    selectedCardSummary?.id,
    selectedCardSummary?.revision
  ]);

  useEffect(() => {
    draftRef.current = {
      cardId: mode === 'detail' ? selectedCardSummary?.id ?? null : null,
      title,
      content
    };
  }, [content, mode, selectedCardSummary?.id, title]);

  const activeCard = useMemo(() => {
    if (mode !== 'detail') return null;
    if (detailCard && selectedCardSummary && detailCard.id === selectedCardSummary.id) {
      return {
        ...detailCard,
        ...selectedCardSummary,
        content: detailCard.content ?? selectedCardSummary.content ?? '',
        subtasks: detailCard.subtasks ?? selectedCardSummary.subtasks ?? [],
        attachments: detailCard.attachments ?? selectedCardSummary.attachments ?? []
      };
    }
    return selectedCardSummary;
  }, [detailCard, mode, selectedCardSummary]);

  const saveDetailDraft = useCallback(
    async (cardId: string, nextTitle: string, nextContent: string) => {
      const saved = await updateCard({ id: cardId, title: nextTitle, content: nextContent });
      const latest = draftRef.current;
      if (saved && latest.cardId === cardId && latest.title === nextTitle && latest.content === nextContent) {
        setIsDirty(false);
      }
      return saved;
    },
    [updateCard]
  );

  useEffect(() => {
    if (mode !== 'detail' || !activeCard || !isDirty) return undefined;
    const cardId = activeCard.id;
    const nextTitle = title;
    const nextContent = content;
    const timer = window.setTimeout(() => {
      void saveDetailDraft(cardId, nextTitle, nextContent);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [activeCard, content, isDirty, mode, saveDetailDraft, title]);

  // Flush unsaved draft when window hides (e.g., user clicks window close button or minimizes)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && mode === 'detail' && activeCard && isDirty) {
        void saveDetailDraft(activeCard.id, title, content);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [activeCard, content, isDirty, mode, saveDetailDraft, title]);

  const handleRequestClose = async () => {
    if (isSubmitting) return;
    if (mode === 'create') {
      const hasDraft = Boolean(title.trim() || content.trim() || subtasks.length > 0);
      if (hasDraft && !confirm('当前新建任务尚未保存，确定放弃并关闭吗？')) {
        return;
      }
      onClose();
      return;
    }
    if (mode === 'detail' && activeCard && isDirty) {
      const saved = await saveDetailDraft(activeCard.id, title, content);
      if (!saved) {
        setModalNotice('保存任务修改失败，已保留当前编辑内容，请稍后重试。');
        return;
      }
    }
    clearError();
    onClose();
  };

  const materializeCreateCard = async (): Promise<TodoCard | null> => {
    if (isSubmitting) return null;
    setIsSubmitting(true);
    setModalNotice(null);
    clearError();
    try {
      const created = await createCard({
        title: title.trim() || '新待办',
        content,
        columnId,
        subtasks: subtasks.map(item => ({
          id: item.id,
          title: item.title,
          completed: item.completed,
          position: item.position || undefined
        }))
      });
      return created;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const created = await materializeCreateCard();
    if (created) {
      clearError();
      onClose();
    }
  };

  const uploadImageFiles = useCallback(
    async (cardId: string, files: FileList | File[], subtaskId: string | null = null) => {
      const fileList = Array.from(files);
      const unsupported: string[] = [];
      const oversized: string[] = [];

      for (const file of fileList) {
        if (!isImageFile(file)) {
          unsupported.push(file.name);
          continue;
        }
        if (isAttachmentFileOversized(file)) {
          oversized.push(file.name);
          continue;
        }
        const buffer = await file.arrayBuffer();
        await addAttachmentBytes({
          cardId,
          subtaskId,
          fileName: file.name || `image-${Date.now()}.png`,
          bytes: Array.from(new Uint8Array(buffer))
        });
      }

      const notices: string[] = [];
      if (unsupported.length > 0) {
        notices.push(`仅支持 PNG / JPG / WebP / GIF / BMP 位图格式，已跳过：${unsupported.join('、')}`);
      }
      if (oversized.length > 0) {
        notices.push(`单张图片不可超过 20 MB，已跳过：${oversized.join('、')}`);
      }
      setModalNotice(notices.length > 0 ? notices.join('；') : null);
    },
    [addAttachmentBytes]
  );

  const runMediaAction = async (fn: (cardId: string) => Promise<void>) => {
    if (mode === 'detail' && activeCard) {
      await subtaskSaveQueueRef.current;
      if (isDirty) {
        await saveDetailDraft(activeCard.id, title, content);
      }
      await fn(activeCard.id);
      return;
    }
    const created = await materializeCreateCard();
    if (!created) return;
    onSwitchToDetail(created.id);
    await fn(created.id);
  };

  const pasteActionRef = useRef<(blob: File) => Promise<void>>(async () => {});
  pasteActionRef.current = async (blob: File) => {
    const targetSubtaskId = activeMediaSubtaskId;
    await runMediaAction(cardId => uploadImageFiles(cardId, [blob], targetSubtaskId));
  };

  // Global modal paste listener so Ctrl+V works even when focus is outside input fields
  useEffect(() => {
    if (cameraTarget) return undefined;
    const onPaste = (event: ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items || []);
      const imageItem = items.find(
        item => item.type.startsWith('image/') && item.type !== 'image/svg+xml'
      );
      const blob = imageItem?.getAsFile();
      if (!blob) return;
      event.preventDefault();
      void pasteActionRef.current(blob);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [cameraTarget]);

  const handleSubtasksChange = async (nextSubtasks: TodoSubtask[]) => {
    setSubtasks(nextSubtasks);
    if (mode !== 'detail' || !activeCard) return;

    const cardId = activeCard.id;
    const serialized = nextSubtasks.map(item => ({
      id: item.id,
      title: item.title,
      completed: item.completed,
      position: item.position || undefined,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }));

    const task = subtaskSaveQueueRef.current.then(async () => {
      const ok = await updateCard({ id: cardId, subtasks: serialized });
      if (!ok) {
        const fresh = await getCardDetail(cardId);
        if (fresh && draftRef.current.cardId === cardId) {
          setDetailCard(fresh);
          setSubtasks(fresh.subtasks || []);
        }
      }
    });
    subtaskSaveQueueRef.current = task.catch(() => undefined);
    await task;
  };

  const handleUpdateAttachmentMeta = async (
    attachmentId: string,
    patch: { focalPoint?: TodoAttachmentFocalPoint; previewMode?: TodoAttachmentPreviewMode },
    subtaskId: string | null = null
  ) => {
    if (mode !== 'detail' || !activeCard) return;
    await updateAttachmentMeta({
      cardId: activeCard.id,
      subtaskId,
      attachmentId,
      focalPoint: patch.focalPoint,
      previewMode: patch.previewMode
    });
  };

  const insertMarkdown = (before: string, after = '', placeholder = '文本') => {
    const target = textareaRef.current;
    if (!target) {
      setContent(prev => `${prev}${before}${placeholder}${after}`);
      if (mode === 'detail') setIsDirty(true);
      return;
    }
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const selected = content.slice(start, end) || placeholder;
    const next = `${content.slice(0, start)}${before}${selected}${after}${content.slice(end)}`;
    setContent(next);
    if (mode === 'detail') setIsDirty(true);
    window.requestAnimationFrame(() => {
      target.focus();
      target.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const handleDeleteCard = async () => {
    if (!activeCard) return;
    if (!confirm(`删除待办 "${activeCard.title}"？`)) return;
    const deleted = await deleteCard(activeCard.id);
    if (deleted) {
      clearError();
      onClose();
    }
  };

  const attachments = activeCard?.attachments || [];
  const coverAttachmentId = activeCard?.coverAttachmentId ?? null;
  const visibleNotice = modalNotice || contextError;

  const preventExternalFileDrop = (event: React.DragEvent) => {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
    }
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onDragOver={preventExternalFileDrop}
      onDrop={preventExternalFileDrop}
      onClick={() => void handleRequestClose()}
      onKeyDown={event => {
        if (event.key === 'Escape' && !cameraTarget) {
          void handleRequestClose();
        }
      }}
    >
      <form
        onSubmit={event => {
          if (mode === 'create') {
            void handleSubmitCreate(event);
          } else {
            event.preventDefault();
            if (activeCard) void saveDetailDraft(activeCard.id, title, content);
          }
        }}
        onDragOver={preventExternalFileDrop}
        onDrop={preventExternalFileDrop}
        onClick={event => event.stopPropagation()}
        className="flex h-[94dvh] max-h-[920px] w-[96vw] max-w-[1280px] flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#141824] shadow-2xl sm:h-[88vh] sm:w-[90vw]"
      >
        {/* Top Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-3.5">
          <div className="flex min-w-[200px] flex-1 items-center gap-2.5">
            <span className="shrink-0 rounded-md bg-sky-400/20 px-2 py-0.5 font-mono text-[10px] font-bold text-sky-200">
              {mode === 'create' ? '新建任务' : `Rev ${activeCard?.revision ?? 1}`}
            </span>
            <input
              autoFocus
              value={title}
              onChange={event => {
                setTitle(event.target.value);
                if (mode === 'detail') setIsDirty(true);
              }}
              placeholder="输入任务标题..."
              className="min-w-0 flex-1 bg-transparent text-[15px] font-black text-slate-100 outline-none placeholder:text-slate-600"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {board?.columns.map(col => (
              <button
                key={col.id}
                type="button"
                onClick={() => {
                  setColumnId(col.id);
                  if (mode === 'detail' && activeCard && activeCard.columnId !== col.id) {
                    void moveCard({ id: activeCard.id, columnId: col.id });
                  }
                }}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  columnId === col.id
                    ? 'bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/40'
                    : 'bg-white/[0.05] text-slate-400 hover:bg-white/[0.1] hover:text-slate-200'
                }`}
              >
                {col.title}
              </button>
            ))}

            {mode === 'detail' && activeCard && (
              <>
                <div className="mx-1 h-4 w-px bg-white/[0.08]" />
                <button
                  type="button"
                  title="立即保存 (Ctrl+Enter)"
                  onClick={() => void saveDetailDraft(activeCard.id, title, content)}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-emerald-500/15 hover:text-emerald-200"
                >
                  <Check size={15} />
                </button>
                <button
                  type="button"
                  title="删除任务"
                  onClick={() => void handleDeleteCard()}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-rose-500/15 hover:text-rose-200"
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}

            <button
              type="button"
              title="关闭"
              onClick={() => void handleRequestClose()}
              className="ml-1 rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-slate-100"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {visibleNotice && (
          <div className="mx-5 mt-3 flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
            <span className="flex-1">{visibleNotice}</span>
            <button
              type="button"
              onClick={() => {
                setModalNotice(null);
                clearError();
              }}
              className="rounded p-0.5 text-amber-200/80 hover:bg-amber-400/15 hover:text-amber-50"
              title="关闭提示"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* Adaptive Workbench Body: Single column <1024px, Balanced Two-Column >=1024px */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.95fr)] lg:gap-5 lg:overflow-hidden">
          {/* Left Column: Description & Structured Subtasks */}
          <div className="space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025]">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-slate-400" />
                  <span className="text-[12px] font-bold text-slate-200">任务描述</span>
                </div>
                {isLoadingDetail && <Loader2 size={12} className="animate-spin text-slate-400" />}
              </div>
              <MarkdownToolbar
                mode={editorMode}
                onModeChange={setEditorMode}
                onInsert={insertMarkdown}
              />
              {editorMode === 'write' ? (
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={event => {
                    setContent(event.target.value);
                    if (mode === 'detail') setIsDirty(true);
                  }}
                  onKeyDown={event => {
                    if (mode === 'detail' && activeCard && event.ctrlKey && event.key === 'Enter') {
                      event.preventDefault();
                      void saveDetailDraft(activeCard.id, title, content);
                    }
                  }}
                  placeholder="填写任务说明、验收标准或链接（支持弹窗内 Ctrl+V 贴图）..."
                  className="min-h-[140px] max-h-[260px] w-full resize-y bg-transparent p-3.5 text-[12px] leading-5 text-slate-100 outline-none placeholder:text-slate-600"
                />
              ) : (
                <div className="min-h-[140px] max-h-[260px] overflow-y-auto p-3.5">
                  <MarkdownPreview content={content || '暂无描述'} />
                </div>
              )}
            </section>

            <TodoSubtasksSection
              subtasks={subtasks}
              onChange={handleSubtasksChange}
              disabled={isSubmitting}
              mediaHandlers={{
                coverAttachmentId,
                isUploading: isSubmitting || isUploadingAttachment,
                activeMediaSubtaskId,
                onActivateTarget: subtaskId => setActiveMediaSubtaskId(subtaskId),
                onOpenCamera: subtaskId =>
                  void runMediaAction(async () => {
                    setCameraTarget({ subtaskId });
                  }),
                onStartSnip: subtaskId =>
                  void runMediaAction(async cardId => {
                    await startSnipForCard(cardId, subtaskId);
                  }),
                onPickImage: subtaskId =>
                  void runMediaAction(async cardId => {
                    await pickAndAddAttachment(cardId, subtaskId);
                  }),
                onUploadFiles: (subtaskId, files) =>
                  runMediaAction(cardId => uploadImageFiles(cardId, files, subtaskId)),
                onSetCover: attachmentId =>
                  activeCard && void setCardCover(activeCard.id, attachmentId),
                onUpdateMeta: (subtaskId, attachmentId, patch) =>
                  void handleUpdateAttachmentMeta(attachmentId, patch, subtaskId),
                onDeleteAttachment: (subtaskId, attachmentId) =>
                  activeCard && void deleteAttachment(activeCard.id, attachmentId, subtaskId)
              }}
            />
          </div>

          {/* Right Column: Layered Media Attachments & Preview Gallery */}
          <div className="mt-4 lg:mt-0 lg:min-h-0 lg:overflow-y-auto lg:pl-1">
            <TodoAttachmentsSection
              attachments={attachments}
              coverAttachmentId={coverAttachmentId}
              isUploading={isSubmitting || isUploadingAttachment}
              onActivateTarget={() => setActiveMediaSubtaskId(null)}
              onOpenCamera={() =>
                void runMediaAction(async () => {
                  setCameraTarget({ subtaskId: null });
                })
              }
              onStartSnip={() =>
                void runMediaAction(async cardId => {
                  await startSnipForCard(cardId, null);
                })
              }
              onPickImage={() =>
                void runMediaAction(async cardId => {
                  await pickAndAddAttachment(cardId, null);
                })
              }
              onUploadFiles={files =>
                runMediaAction(cardId => uploadImageFiles(cardId, files, null))
              }
              onSetCover={attachmentId =>
                activeCard && void setCardCover(activeCard.id, attachmentId)
              }
              onUpdateMeta={(attachmentId, patch) =>
                void handleUpdateAttachmentMeta(attachmentId, patch, null)
              }
              onDeleteAttachment={attachmentId =>
                activeCard && void deleteAttachment(activeCard.id, attachmentId, null)
              }
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/[0.08] px-5 py-2.5 text-[11px] text-slate-500">
          {mode === 'create' ? (
            <>
              <span>直接拍照/拖图将自动创建任务并切入编辑视角</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void handleRequestClose()}
                  className="rounded-lg border border-white/[0.08] px-3.5 py-1.5 text-[12px] font-semibold text-slate-300 hover:bg-white/[0.08]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/25 px-4 py-1.5 text-[12px] font-bold text-sky-100 hover:bg-sky-500/35 disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  创建任务
                </button>
              </div>
            </>
          ) : (
            <>
              <span>{isDirty ? '正在等待自动保存...' : '所有修改已实时持久化'}</span>
              <span>Ctrl+Enter 保存 · Esc 关闭弹窗</span>
            </>
          )}
        </div>
      </form>

      {cameraTarget && activeCard && (
        <TodoCameraModal
          isUploading={isUploadingAttachment}
          onCapture={(fileName, bytes) =>
            addAttachmentBytes({
              cardId: activeCard.id,
              subtaskId: cameraTarget.subtaskId,
              fileName,
              bytes
            })
          }
          onClose={() => setCameraTarget(null)}
        />
      )}
    </div>
  );
};
