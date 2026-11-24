import React, { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Star,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import type {
  TodoAttachment,
  TodoAttachmentFocalPoint,
  TodoAttachmentPreviewMode
} from '../../types/todo';
import { formatBytes, formatOrientationLabel } from './mediaUtils';

interface TodoLightboxModalProps {
  attachments: TodoAttachment[];
  activeIndex: number;
  coverAttachmentId: string | null;
  onIndexChange: (nextIndex: number) => void;
  onSetCover: (attachmentId: string | null) => void;
  onUpdateMeta: (
    attachmentId: string,
    patch: { focalPoint?: TodoAttachmentFocalPoint; previewMode?: TodoAttachmentPreviewMode }
  ) => void;
  onClose: () => void;
}

const FOCAL_PRESETS: Array<{ label: string; point: TodoAttachmentFocalPoint }> = [
  { label: '偏上取景', point: { x: 0.5, y: 0.25 } },
  { label: '居中取景', point: { x: 0.5, y: 0.5 } },
  { label: '偏下取景', point: { x: 0.5, y: 0.78 } }
];

/**
 * Fullscreen lossless original-image lightbox with fit/1:1 zoom modes and non-destructive
 * card thumbnail framing controls (cover focal presets vs uncropped contain fit).
 */
export const TodoLightboxModal: React.FC<TodoLightboxModalProps> = ({
  attachments,
  activeIndex,
  coverAttachmentId,
  onIndexChange,
  onSetCover,
  onUpdateMeta,
  onClose
}) => {
  const [zoomScale, setZoomScale] = useState<'fit' | 1 | 1.5 | 2>('fit');
  const [imageLoadError, setImageLoadError] = useState(false);
  const clampedIndex =
    attachments.length > 0 ? Math.min(Math.max(activeIndex, 0), attachments.length - 1) : 0;
  const active = attachments[clampedIndex];

  useEffect(() => {
    if (attachments.length === 0) {
      onClose();
    } else if (activeIndex !== clampedIndex) {
      onIndexChange(clampedIndex);
    }
  }, [activeIndex, attachments.length, clampedIndex, onClose, onIndexChange]);

  useEffect(() => {
    setZoomScale('fit');
    setImageLoadError(false);
  }, [clampedIndex, active?.id]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      } else if (event.key === 'ArrowLeft' && attachments.length > 1) {
        onIndexChange((activeIndex - 1 + attachments.length) % attachments.length);
      } else if (event.key === 'ArrowRight' && attachments.length > 1) {
        onIndexChange((activeIndex + 1) % attachments.length);
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [activeIndex, attachments.length, onClose, onIndexChange]);

  if (!active) return null;

  const isCover = coverAttachmentId === active.id;
  const isContain = active.previewMode === 'contain';
  const originalSrc = active.assetUrl || active.thumbUrl;

  const cycleZoom = (dir: 1 | -1) => {
    const order: Array<'fit' | 1 | 1.5 | 2> = ['fit', 1, 1.5, 2];
    const current = order.indexOf(zoomScale);
    const next = Math.max(0, Math.min(order.length - 1, current + dir));
    setZoomScale(order[next]);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/88 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-[92vw] max-w-[1440px] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#10131e] shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        {/* Top Metadata & Navigation Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-bold text-slate-100">
              {active.originalName}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-slate-400">
              <span>
                {activeIndex + 1} / {attachments.length}
              </span>
              <span>·</span>
              <span>{formatOrientationLabel(active)}</span>
              <span>·</span>
              <span>
                {active.width} × {active.height}
              </span>
              <span>·</span>
              <span>{formatBytes(active.sizeBytes)}</span>
              {active.sha256 && (
                <>
                  <span>·</span>
                  <span>SHA {active.sha256.slice(0, 8)}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => onSetCover(isCover ? null : active.id)}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${
                isCover
                  ? 'bg-sky-500/80 text-white'
                  : 'border border-white/10 bg-white/[0.05] text-slate-200 hover:bg-white/10'
              }`}
            >
              <Star size={12} fill={isCover ? 'currentColor' : 'none'} />
              {isCover ? '当前封面' : '设为封面'}
            </button>

            <div className="flex items-center rounded-lg border border-white/10 bg-white/[0.04] p-0.5">
              <button
                type="button"
                disabled={zoomScale === 'fit'}
                onClick={() => cycleZoom(-1)}
                className="rounded p-1 text-slate-300 hover:bg-white/10 disabled:opacity-35"
                title="缩小"
              >
                <ZoomOut size={13} />
              </button>
              <button
                type="button"
                onClick={() => setZoomScale(zoomScale === 'fit' ? 1 : 'fit')}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-200 hover:bg-white/10"
                title="切换适应屏幕 / 原始像素比例"
              >
                {zoomScale === 'fit' ? (
                  <>
                    <Minimize2 size={11} />
                    适应窗口
                  </>
                ) : (
                  <>
                    <Maximize2 size={11} />
                    {Math.round(zoomScale * 100)}%
                  </>
                )}
              </button>
              <button
                type="button"
                disabled={zoomScale === 2}
                onClick={() => cycleZoom(1)}
                className="rounded p-1 text-slate-300 hover:bg-white/10 disabled:opacity-35"
                title="放大"
              >
                <ZoomIn size={13} />
              </button>
            </div>

            {attachments.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    onIndexChange((activeIndex - 1 + attachments.length) % attachments.length)
                  }
                  className="rounded-lg border border-white/10 p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                  title="上一张 (←)"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => onIndexChange((activeIndex + 1) % attachments.length)}
                  className="rounded-lg border border-white/10 p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                  title="下一张 (→)"
                >
                  <ChevronRight size={15} />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
              title="关闭 (Esc)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Original Lossless Image Viewport */}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#07090f] p-4">
          {originalSrc && !imageLoadError ? (
            <img
              src={originalSrc}
              alt={active.originalName}
              onError={() => setImageLoadError(true)}
              style={
                zoomScale === 'fit' || active.width <= 0
                  ? zoomScale === 'fit'
                    ? undefined
                    : { transform: `scale(${zoomScale})`, transformOrigin: 'center center' }
                  : {
                      width: `${Math.round(active.width * zoomScale)}px`,
                      maxWidth: 'none',
                      height: 'auto'
                    }
              }
              className={
                zoomScale === 'fit'
                  ? 'max-h-full max-w-full rounded object-contain shadow-xl'
                  : 'rounded object-contain shadow-xl'
              }
            />
          ) : (
            <div className="text-[12px] text-slate-400">
              {imageLoadError ? '原图文件丢失或损坏，无法加载' : '原图不可用'}
            </div>
          )}
        </div>

        {/* Non-destructive Card Framing Controls Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] bg-slate-950/60 px-4 py-2 text-[11px]">
          <span className="text-slate-400">
            卡片略缩图非破坏性取景设置（原图始终完整保存，不影响点开全览）：
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {FOCAL_PRESETS.map(preset => {
              const isActive =
                !isContain &&
                Math.abs((active.focalPoint?.y ?? 0.5) - preset.point.y) < 0.08;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() =>
                    onUpdateMeta(active.id, {
                      previewMode: 'cover',
                      focalPoint: preset.point
                    })
                  }
                  className={`rounded-md px-2 py-1 text-[10px] font-semibold ${
                    isActive
                      ? 'bg-sky-500/25 text-sky-100 ring-1 ring-sky-400/40'
                      : 'bg-white/[0.06] text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() =>
                onUpdateMeta(active.id, {
                  previewMode: isContain ? 'cover' : 'contain'
                })
              }
              className={`rounded-md px-2 py-1 text-[10px] font-semibold ${
                isContain
                  ? 'bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/40'
                  : 'bg-white/[0.06] text-slate-300 hover:bg-white/10'
              }`}
            >
              {isContain ? '当前：完整不裁切' : '完整适应（不裁切）'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
