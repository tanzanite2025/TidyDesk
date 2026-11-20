import React, { useState } from 'react';
import { Camera, ImagePlus, Loader2, Scissors, Star, Trash2, X } from 'lucide-react';
import type { TodoAttachment } from '../../types/todo';

interface TodoAttachmentsSectionProps {
  attachments: TodoAttachment[];
  coverAttachmentId: string | null;
  isUploading: boolean;
  onOpenCamera: () => void;
  onStartSnip: () => void;
  onPickImage: () => void;
  onSetCover: (attachmentId: string | null) => void;
  onDeleteAttachment: (attachmentId: string) => void;
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Attachment strip inside Todo card detail drawer: camera capture, screenshot snip, file picker, cover selection, and full-size lightbox.
 */
export const TodoAttachmentsSection: React.FC<TodoAttachmentsSectionProps> = ({
  attachments,
  coverAttachmentId,
  isUploading,
  onOpenCamera,
  onStartSnip,
  onPickImage,
  onSetCover,
  onDeleteAttachment
}) => {
  const [previewAttachment, setPreviewAttachment] = useState<TodoAttachment | null>(null);

  return (
    <div className="border-b border-white/[0.08] bg-white/[0.02] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-slate-300">
          图片附件 {attachments.length > 0 ? `(${attachments.length})` : ''}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={isUploading}
            onClick={onOpenCamera}
            className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/[0.1] disabled:opacity-50"
            title="调用摄像头拍照"
          >
            <Camera size={12} className="text-sky-300" />
            拍照
          </button>
          <button
            type="button"
            disabled={isUploading}
            onClick={onStartSnip}
            className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/[0.1] disabled:opacity-50"
            title="框选屏幕截图加入卡片"
          >
            <Scissors size={12} className="text-emerald-300" />
            截屏
          </button>
          <button
            type="button"
            disabled={isUploading}
            onClick={onPickImage}
            className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/[0.1] disabled:opacity-50"
            title="从本地选择图片（也支持直接 Ctrl+V 粘贴图片）"
          >
            {isUploading ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} className="text-amber-300" />}
            选图
          </button>
        </div>
      </div>

      {attachments.length > 0 ? (
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          {attachments.map(att => {
            const isCover = coverAttachmentId === att.id;
            const thumbSrc = att.thumbUrl || att.assetUrl;
            return (
              <div
                key={att.id}
                className={`group relative overflow-hidden rounded-lg border bg-black/30 ${
                  isCover ? 'border-sky-400/50' : 'border-white/[0.08]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setPreviewAttachment(att)}
                  className="block h-20 w-full overflow-hidden text-left"
                  title={`${att.originalName} (${att.width}x${att.height})`}
                >
                  {thumbSrc ? (
                    <img
                      src={thumbSrc}
                      alt={att.originalName}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-[10px] text-slate-500">
                      无预览
                    </div>
                  )}
                </button>

                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/85 via-black/45 to-transparent px-1.5 py-1 opacity-95">
                  <button
                    type="button"
                    onClick={() => onSetCover(isCover ? null : att.id)}
                    className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold ${
                      isCover
                        ? 'bg-sky-500/80 text-white'
                        : 'bg-black/40 text-slate-200 hover:bg-white/20'
                    }`}
                    title={isCover ? '取消看板封面' : '设为看板封面'}
                  >
                    <Star size={9} fill={isCover ? 'currentColor' : 'none'} />
                    {isCover ? '封面' : '设封面'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`删除图片附件 "${att.originalName}"？`)) {
                        onDeleteAttachment(att.id);
                      }
                    }}
                    className="rounded p-0.5 text-slate-300 hover:bg-rose-500/70 hover:text-white"
                    title="删除图片"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-2 text-[10px] text-slate-500">
          支持拍照、框选截屏、本地选图，或在编辑区直接按 Ctrl+V 粘贴图片。
        </div>
      )}

      {previewAttachment && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
          onClick={() => setPreviewAttachment(null)}
        >
          <div
            className="flex max-h-full max-w-full flex-col overflow-hidden rounded-xl border border-white/15 bg-[#121622] shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-white/[0.08] px-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-[12px] font-bold text-slate-100">{previewAttachment.originalName}</div>
                <div className="text-[10px] text-slate-400">
                  {previewAttachment.width} x {previewAttachment.height} · {formatBytes(previewAttachment.sizeBytes)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewAttachment(null)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[80vh] max-w-[85vw] overflow-auto bg-black/50 p-3">
              <img
                src={previewAttachment.assetUrl || previewAttachment.thumbUrl}
                alt={previewAttachment.originalName}
                className="mx-auto max-h-[75vh] max-w-full rounded object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
