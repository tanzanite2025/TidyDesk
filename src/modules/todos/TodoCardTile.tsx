import React from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { TodoCard } from '../../types/todo';

function cardSummary(content: string) {
  return content
    .split(/\r?\n/)
    .map(line => line.replace(/^#+\s*/, '').replace(/^- \[[ xX]\]\s*/, '').trim())
    .find(Boolean) || '没有描述';
}

interface TodoCardTileProps {
  card: TodoCard;
  isSelected: boolean;
  onSelect: () => void;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
}

/**
 * Kanban card tile rendering an optional 360px cover thumbnail, title, summary, and attachment count.
 */
export const TodoCardTile: React.FC<TodoCardTileProps> = ({
  card,
  isSelected,
  onSelect,
  onDragStart
}) => {
  const attachmentCount = card.attachmentCount ?? card.attachments?.length ?? 0;

  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={onSelect}
      className={`w-full overflow-hidden rounded-lg border text-left transition-all ${
        isSelected
          ? 'border-sky-300/35 bg-sky-400/14'
          : 'border-white/[0.07] bg-white/[0.055] hover:bg-white/[0.09]'
      }`}
    >
      {card.coverThumbUrl && (
        <div className="h-28 w-full overflow-hidden border-b border-white/[0.06] bg-black/30">
          <img
            src={card.coverThumbUrl}
            alt={card.title}
            loading="lazy"
            draggable={false}
            className="h-full w-full object-cover"
          />
        </div>
      )}
      <div className="p-3">
        <div className="line-clamp-2 text-[12px] font-bold leading-4 text-slate-100">{card.title}</div>
        <div className="mt-2 line-clamp-2 text-[10px] leading-4 text-slate-500">{cardSummary(card.content)}</div>
        {attachmentCount > 0 && (
          <div className="mt-2 inline-flex items-center gap-1 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-slate-300">
            <ImageIcon size={11} className="text-sky-300" />
            <span>{attachmentCount}</span>
          </div>
        )}
      </div>
    </button>
  );
};
