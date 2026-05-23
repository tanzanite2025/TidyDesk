import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Download, Pin, PinOff, X } from 'lucide-react';

type StickerData = {
  id: string;
  imageDataUrl: string;
  alwaysOnTop: boolean;
  createdAt: string;
};

type StickerApi = {
  getSticker: (stickerId: string) => Promise<StickerData | null>;
  toggleStickerPin: (stickerId: string) => Promise<{ success: boolean; alwaysOnTop?: boolean }>;
  copySticker: (stickerId: string) => Promise<any>;
  saveStickerAs: (stickerId: string) => Promise<any>;
  closeSticker: (stickerId: string) => Promise<any>;
  onStickerUpdated: (callback: (payload: { id: string; alwaysOnTop: boolean }) => void) => () => void;
};

const tidyDeskApi: StickerApi | null = (window as any).tidyDesk || null;

export const StickerApp: React.FC = () => {
  const stickerId = useMemo(() => new URLSearchParams(window.location.search).get('id') || '', []);
  const [sticker, setSticker] = useState<StickerData | null>(null);
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    if (!stickerId) return;
    tidyDeskApi?.getSticker?.(stickerId).then(setSticker).catch(() => setSticker(null));

    const unsubscribe = tidyDeskApi?.onStickerUpdated?.(payload => {
      if (payload.id !== stickerId) return;
      setSticker(prev => prev ? { ...prev, alwaysOnTop: payload.alwaysOnTop } : prev);
    });

    return () => unsubscribe?.();
  }, [stickerId]);

  const togglePin = async () => {
    if (!sticker) return;
    const result = await tidyDeskApi?.toggleStickerPin?.(sticker.id);
    if (result?.success && typeof result.alwaysOnTop === 'boolean') {
      setSticker(prev => prev ? { ...prev, alwaysOnTop: result.alwaysOnTop! } : prev);
    }
  };

  if (!sticker) {
    return (
      <div className="grid h-screen w-screen place-items-center rounded-lg border border-white/10 bg-[#121620]/95 text-[12px] text-slate-400">
        贴图不可用
      </div>
    );
  }

  return (
    <div
      className="relative h-screen w-screen overflow-hidden rounded-lg border border-white/12 bg-black/5 shadow-2xl"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <div className="absolute inset-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <img
          src={sticker.imageDataUrl}
          alt="截图贴纸"
          draggable={false}
          className="h-full w-full select-none object-contain"
        />
      </div>

      <div
        className={`absolute right-2 top-2 flex items-center gap-1 rounded-lg border border-white/12 bg-slate-950/72 p-1 text-slate-200 shadow-xl backdrop-blur transition-opacity ${
          isHovering ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button type="button" title={sticker.alwaysOnTop ? '取消置顶' : '置顶'} onClick={togglePin} className="rounded-md p-1.5 hover:bg-white/10">
          {sticker.alwaysOnTop ? <Pin size={14} /> : <PinOff size={14} />}
        </button>
        <button type="button" title="复制图片" onClick={() => tidyDeskApi?.copySticker?.(sticker.id)} className="rounded-md p-1.5 hover:bg-white/10">
          <Copy size={14} />
        </button>
        <button type="button" title="另存为" onClick={() => tidyDeskApi?.saveStickerAs?.(sticker.id)} className="rounded-md p-1.5 hover:bg-white/10">
          <Download size={14} />
        </button>
        <button type="button" title="关闭贴纸" onClick={() => tidyDeskApi?.closeSticker?.(sticker.id)} className="rounded-md p-1.5 hover:bg-rose-500/20 hover:text-rose-100">
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
