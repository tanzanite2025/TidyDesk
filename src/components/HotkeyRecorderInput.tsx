import React from 'react';

interface HotkeyRecorderInputProps {
  value: string | null;
  displayValue?: string | null;
  disabled?: boolean;
  onChange: (value: string | null) => void;
}

function mainKeyFromEvent(event: React.KeyboardEvent<HTMLButtonElement>): string | null {
  const key = event.key;
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;
  if (key === ' ') return 'Space';
  if (key === 'Escape') return 'Esc';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function hotkeyFromEvent(event: React.KeyboardEvent<HTMLButtonElement>): string | null {
  const mainKey = mainKeyFromEvent(event);
  if (!mainKey) return null;
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Win');
  parts.push(mainKey);
  return parts.join('+');
}

export const HotkeyRecorderInput: React.FC<HotkeyRecorderInputProps> = ({
  value,
  displayValue,
  disabled = false,
  onChange
}) => {
  const [isRecording, setIsRecording] = React.useState(false);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!isRecording || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setIsRecording(false);
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      onChange(null);
      setIsRecording(false);
      return;
    }
    const nextValue = hotkeyFromEvent(event);
    if (nextValue) {
      onChange(nextValue);
      setIsRecording(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsRecording(true)}
        onKeyDown={handleKeyDown}
        className={`min-w-40 rounded-lg border px-3 py-2 text-left text-[12px] transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
          isRecording
            ? 'border-sky-400/60 bg-sky-500/10 text-sky-100'
            : 'border-white/[0.08] bg-slate-950/45 text-slate-100 hover:border-white/[0.18]'
        }`}
      >
        {isRecording ? '请按新的组合键' : displayValue || value || '未设置'}
      </button>
      <button
        type="button"
        disabled={disabled || !value}
        onClick={() => onChange(null)}
        className="rounded-md border border-white/[0.08] px-2 py-1 text-[11px] text-slate-400 hover:bg-white/[0.08] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        清空
      </button>
    </div>
  );
};
