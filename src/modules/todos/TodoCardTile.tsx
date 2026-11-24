import React, { useState } from 'react';
import { CheckSquare, Film, Image as ImageIcon, Play, Star } from 'lucide-react';
import type { TodoAttachment, TodoCard } from '../../types/todo';
import { attachmentImageStyle, isAttachmentContainMode } from './mediaUtils';

function fallbackSummary(content: string): string {
  return (
    content
      .split(/\r?\n/)
      .map(line => line.replace(/^#+\s*/, '').replace(/^- \[[ xX]\]\s*/, '').trim())
      .find(Boolean) || ''
  );
}

function resolveCardMediaPreview(card: TodoCard): {
  items: TodoAttachment[];
  extraCount: number;
  totalCount: number;
} {
  const items = (card.previewAttachments || []).slice(0, 2);
  const totalCount = card.attachmentCount ?? items.length;
  const extraCount = card.extraAttachmentCount ?? Math.max(0, totalCount - items.length);
  return { items, extraCount, totalCount };
}

interface TodoCardTileProps {
  card: TodoCard;
  isSelected: boolean;
  onSelect: () => void;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
}

/**
 * Kanban card tile with responsive aspect-ratio locked media slots (max 2 previews + '+N' overflow),
 * non-destructive focal-point / contain framing, and subtask completion progress.
 */
export const TodoCardTile: React.FC<TodoCardTileProps> = ({
  card,
  isSelected,
  onSelect,
  onDragStart
}) => {
  const [brokenSrcs, setBrokenSrcs] = useState<Record<string, true>>({});
  const { items: previewItems, extraCount, totalCount } = resolveCardMediaPreview(card);
  const subtaskTotal = card.subtaskTotal ?? card.subtasks?.length ?? 0;
  const subtaskCompleted =
    card.subtaskCompleted ?? card.subtasks?.filter(item => item.completed).length ?? 0;
  const subtaskPercent = subtaskTotal > 0 ? Math.round((subtaskCompleted / subtaskTotal) * 100) : 0;
  const hasVideoPreview = previewItems.some(item => item.kind === 'video');
  const summary = card.summaryText?.trim() || fallbackSummary(card.content || '') || '没有描述';

  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={onSelect}
      className={`w-full overflow-hidden rounded-xl border text-left transition-all ${
        isSelected
          ? 'border-sky-300/40 bg-sky-400/15 ring-1 ring-sky-400/25'
          : 'border-white/[0.08] bg-white/[0.045] hover:border-white/[0.16] hover:bg-white/[0.08]'
      }`}
    >
      <div className="p-3">
        {/* Layer 1: Title & summary */}
        <div className="line-clamp-2 text-[12px] font-bold leading-4 text-slate-100">
          {card.title}
        </div>
        <div className="mt-1.5 line-clamp-2 text-[10px] leading-4 text-slate-400">{summary}</div>

        {/* Layer 2: Aspect-ratio locked media slots (max 2 previews; +N hint on slot #2) */}
        {previewItems.length > 0 && (
          <div
            className={`mt-2.5 grid gap-1.5 ${
              previewItems.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
            }`}
          >
            {previewItems.map((att, index) => {
              const thumbSrc = att.thumbUrl || att.assetUrl;
              const isCover = card.coverAttachmentId === att.id;
              const isOverflowSlot = index === 1 && extraCount > 0;
              const isVideo = att.kind === 'video';
              const useContain = isAttachmentContainMode(att);

              return (
                <div
                  key={att.id}
                  className={`relative w-full overflow-hidden rounded-lg border border-white/[0.08] bg-black/45 ${
                    previewItems.length === 1
                      ? 'aspect-[16/10] max-h-[220px]'
                      : 'aspect-[4/3]'
                  }`}
                >
                  {thumbSrc && !brokenSrcs[thumbSrc] ? (
                    <img
                      src={thumbSrc}
                      alt={att.originalName}
                      loading="lazy"
                      draggable={false}
                      onError={() =>
                        setBrokenSrcs(prev => (prev[thumbSrc] ? prev : { ...prev, [thumbSrc]: true }))
                      }
                      style={attachmentImageStyle(att)}
                      className={`h-full w-full ${
                        useContain ? 'object-contain p-0.5' : 'object-cover'
                      }`}
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-slate-500">
                      {isVideo ? <Film size={16} /> : <ImageIcon size={16} />}
                    </div>
                  )}

                  {isCover && !isOverflowSlot && (
                    <span
                      className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded bg-black/65 px-1 py-0.5 text-[9px] font-semibold text-sky-300 backdrop-blur-sm"
                      title="看板封面"
                    >
                      <Star size={8} fill="currentColor" />
                    </span>
                  )}

                  {isVideo && !isOverflowSlot && (
                    <span className="absolute inset-0 grid place-items-center bg-black/25">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white">
                        <Play size={11} fill="currentColor" />
                      </span>
                    </span>
                  )}

                  {isOverflowSlot && (
                    <div
                      className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/75 text-white backdrop-blur-[1px]"
                      title={`点击卡片查看全部 ${totalCount} 个多媒体附件`}
                    >
                      <span className="font-mono text-[13px] font-black tracking-tight">
                        +{extraCount}
                      </span>
                      <span className="text-[9px] text-slate-300">点击查看</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Layer 3: Subtask progress & media counter footer */}
        {(totalCount > 0 || subtaskTotal > 0) && (
          <div className="mt-2.5 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5">
                {subtaskTotal > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                      subtaskCompleted === subtaskTotal
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-white/[0.06] text-slate-300'
                    }`}
                  >
                    <CheckSquare size={10} />
                    <span>
                      {subtaskCompleted}/{subtaskTotal}
                    </span>
                  </span>
                )}
                {totalCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                    {hasVideoPreview ? (
                      <Film size={10} className="text-sky-300" />
                    ) : (
                      <ImageIcon size={10} className="text-sky-300" />
                    )}
                    <span>{totalCount}</span>
                  </span>
                )}
              </div>
              {extraCount > 0 && (
                <span className="text-[9px] text-slate-500">共 {totalCount} 项附件</span>
              )}
            </div>
            {subtaskTotal > 0 && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={`h-full transition-all ${
                    subtaskPercent === 100 ? 'bg-emerald-400' : 'bg-sky-400'
                  }`}
                  style={{ width: `${subtaskPercent}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </button>
  );
};
