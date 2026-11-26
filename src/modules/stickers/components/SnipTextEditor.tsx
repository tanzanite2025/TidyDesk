import React, { useEffect, useRef } from 'react';
import type { TextDraftState } from '../selection/useSnipSession';

interface SnipTextEditorProps {
  draft: TextDraftState;
  color: string;
  fontSize: number;
  onChange: (value: string) => void;
  onCommit: (value?: string) => void;
  onCancel: () => void;
}

/** Inline overlay textarea mounted at pointer drop point for crisp screenshot text input. */
export const SnipTextEditor: React.FC<SnipTextEditorProps> = ({
  draft,
  color,
  fontSize,
  onChange,
  onCommit,
  onCancel
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
  }, []);

  const lineCount = Math.max(1, draft.value.split('\n').length);

  return (
    <textarea
      ref={textareaRef}
      data-testid="snip-text-editor"
      value={draft.value}
      placeholder="输入文字 (Ctrl+Enter 完成)"
      rows={lineCount}
      onChange={event => onChange(event.target.value)}
      onMouseDown={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          onCommit(event.currentTarget.value);
        }
      }}
      onBlur={() => onCommit(textareaRef.current?.value)}
      className="fixed z-40 min-w-[140px] max-w-[420px] resize-none rounded border border-dashed border-sky-400 bg-slate-950/65 px-1.5 py-0.5 font-bold leading-[1.28] outline-none shadow-lg backdrop-blur-[2px]"
      style={{
        left: draft.position.x,
        top: draft.position.y,
        color,
        fontSize,
        textShadow:
          color.toLowerCase() === '#0f172a'
            ? '0 1px 2px rgba(255,255,255,0.85)'
            : '0 1px 3px rgba(0,0,0,0.7)'
      }}
    />
  );
};
