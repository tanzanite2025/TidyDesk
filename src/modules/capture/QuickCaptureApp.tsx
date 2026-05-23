import React, { useEffect, useMemo, useState } from 'react';
import { Check, Clipboard, Loader2, X } from 'lucide-react';
import { CreateTodoCardInput, TodoState } from '../../types/todo';

type TidyDeskCaptureApi = {
  windowControl: (action: string) => void;
  getClipboardText?: () => Promise<string>;
  createTodoCard?: (payload: CreateTodoCardInput) => Promise<TodoState>;
  onCaptureOpened?: (callback: (payload: { clipboardText?: string }) => void) => () => void;
};

const tidyDeskApi: TidyDeskCaptureApi | null = (window as any).tidyDesk || null;

function titleFromContent(content: string) {
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean)
    ?.slice(0, 80) || '快速记录';
}

export const QuickCaptureApp: React.FC = () => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    tidyDeskApi?.getClipboardText?.().then(text => {
      if (text.trim()) {
        setContent(text);
        setTitle(titleFromContent(text));
      }
    }).catch(() => undefined);

    return tidyDeskApi?.onCaptureOpened?.(payload => {
      const text = payload.clipboardText || '';
      setContent(text);
      setTitle(titleFromContent(text));
      setNotice(null);
    });
  }, []);

  const derivedTitle = useMemo(() => title.trim() || titleFromContent(content), [content, title]);

  const close = () => tidyDeskApi?.windowControl('close-panel');

  const save = async () => {
    if (!tidyDeskApi?.createTodoCard || (!title.trim() && !content.trim())) return;

    setIsSaving(true);
    setNotice(null);
    try {
      await tidyDeskApi.createTodoCard({
        title: derivedTitle,
        content: content.trim() ? content : `# ${derivedTitle}`,
        columnId: 'todo'
      });
      setTitle('');
      setContent('');
      close();
    } catch (err) {
      setNotice(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="flex h-screen w-full select-none flex-col overflow-hidden rounded-xl border border-white/[0.1] bg-[#121621]/96 text-slate-100 shadow-2xl"
      onKeyDown={event => {
        if (event.key === 'Escape') close();
        if (event.ctrlKey && event.key === 'Enter') {
          event.preventDefault();
          save();
        }
      }}
    >
      <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="flex min-w-0 items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sky-400/15 text-sky-100">
            <Clipboard size={16} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-black">快速记录</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Markdown todo capture</div>
          </div>
        </div>
        <button type="button" onClick={close} className="rounded-md p-2 text-slate-500 hover:bg-rose-500/15 hover:text-rose-200" title="关闭" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <X size={14} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <input
          autoFocus
          value={title}
          onChange={event => setTitle(event.target.value)}
          className="h-10 rounded-lg border border-white/[0.08] bg-white/[0.055] px-3 text-[13px] font-bold text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-300/35"
          placeholder="标题"
        />
        <textarea
          value={content}
          onChange={event => {
            setContent(event.target.value);
            if (!title.trim()) setTitle(titleFromContent(event.target.value));
          }}
          className="min-h-0 flex-1 resize-none rounded-lg border border-white/[0.08] bg-white/[0.045] p-3 text-[12px] leading-5 text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-300/35"
          placeholder="复制内容后按 Ctrl+Alt+N，或直接写一条待办..."
        />
        {notice && <div className="text-[11px] text-rose-200">{notice}</div>}
      </div>

      <div className="flex items-center justify-between border-t border-white/[0.08] px-4 py-3 text-[10px] text-slate-500">
        <span>Ctrl+Enter 保存，Esc 关闭</span>
        <button
          type="button"
          onClick={save}
          disabled={isSaving || (!title.trim() && !content.trim())}
          className="flex h-9 items-center gap-2 rounded-lg bg-sky-400/18 px-3 text-[12px] font-bold text-sky-100 hover:bg-sky-400/26 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          保存
        </button>
      </div>
    </div>
  );
};
