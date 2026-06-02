import React, { useEffect, useMemo, useState } from 'react';
import { nativeClient } from '../../native/native-client';

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };


function rectFromPoints(start: Point, end: Point): Rect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  return { x, y, width, height };
}

export const SnipOverlayApp: React.FC = () => {
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [endPoint, setEndPoint] = useState<Point | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const selection = useMemo(() => {
    if (!startPoint || !endPoint) return null;
    return rectFromPoints(startPoint, endPoint);
  }, [startPoint, endPoint]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        nativeClient.isAvailable() && nativeClient.capture.cancelSnip();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const completeSelection = async (rect: Rect) => {
    if (isCapturing) return;
    if (rect.width < 8 || rect.height < 8) {
      nativeClient.isAvailable() && nativeClient.capture.cancelSnip();
      return;
    }

    setIsCapturing(true);
    try {
      if (nativeClient.isAvailable()) {
        await nativeClient.capture.completeSnipSelection(rect);
      }
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div
      className="snip-overlay-root relative h-screen w-screen cursor-crosshair select-none overflow-hidden text-white"
      style={{ backgroundColor: 'transparent' }}
      onMouseDown={event => {
        if (isCapturing) return;
        const point = { x: event.clientX, y: event.clientY };
        setStartPoint(point);
        setEndPoint(point);
      }}
      onMouseMove={event => {
        if (!startPoint || isCapturing) return;
        setEndPoint({ x: event.clientX, y: event.clientY });
      }}
      onMouseUp={() => {
        if (!selection) return;
        completeSelection(selection);
      }}
    >
      <div className="pointer-events-none absolute left-1/2 top-7 -translate-x-1/2 rounded-lg border border-white/15 bg-black/55 px-4 py-2 text-[12px] font-medium shadow-2xl">
        拖选截图区域，Esc 取消
      </div>

      {selection && (
        <div
          className="pointer-events-none absolute border border-sky-200 bg-sky-300/12 shadow-[0_0_0_9999px_rgba(0,0,0,0.42)]"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height
          }}
        >
          <div className="absolute -top-7 left-0 rounded bg-sky-200 px-2 py-1 text-[11px] font-bold text-slate-950">
            {Math.round(selection.width)} x {Math.round(selection.height)}
          </div>
        </div>
      )}

      {isCapturing && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/35 text-[13px] font-bold">
          正在生成贴图...
        </div>
      )}
    </div>
  );
};
