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

function pointsFromRect(rect: Rect): { start: Point; end: Point } {
  return {
    start: { x: rect.x, y: rect.y },
    end: { x: rect.x + rect.width, y: rect.y + rect.height }
  };
}

function viewportRect(): Rect {
  return {
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight
  };
}

function clampRectToViewport(rect: Rect): Rect {
  const viewport = viewportRect();
  const width = Math.min(rect.width, viewport.width);
  const height = Math.min(rect.height, viewport.height);
  const maxX = Math.max(0, viewport.width - width);
  const maxY = Math.max(0, viewport.height - height);

  return {
    x: Math.max(0, Math.min(rect.x, maxX)),
    y: Math.max(0, Math.min(rect.y, maxY)),
    width,
    height
  };
}

export const SnipOverlayApp: React.FC = () => {
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [endPoint, setEndPoint] = useState<Point | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [cursorPoint, setCursorPoint] = useState<Point>({
    x: Math.round(window.innerWidth / 2),
    y: Math.round(window.innerHeight / 2)
  });

  const cancelSnip = () => {
    if (!nativeClient.isAvailable()) return;
    void nativeClient.capture.cancelSnip().catch(() => {});
  };

  const selection = useMemo(() => {
    if (!startPoint || !endPoint) return null;
    return rectFromPoints(startPoint, endPoint);
  }, [startPoint, endPoint]);

  const clearSelection = () => {
    setIsDragging(false);
    setStartPoint(null);
    setEndPoint(null);
  };

  const applySelection = (rect: Rect) => {
    const clamped = clampRectToViewport(rect);
    const { start, end } = pointsFromRect(clamped);
    setStartPoint(start);
    setEndPoint(end);
  };

  const nudgeSelection = (dx: number, dy: number) => {
    if (!selection || isCapturing) return;
    const moved = clampRectToViewport({
      x: selection.x + dx,
      y: selection.y + dy,
      width: selection.width,
      height: selection.height
    });
    applySelection(moved);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isCapturing) {
        cancelSnip();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !isCapturing) {
        event.preventDefault();
        applySelection(viewportRect());
        return;
      }

      if ((event.key === 'Enter' || event.key === ' ') && selection && !isCapturing) {
        event.preventDefault();
        void completeSelection(selection);
        return;
      }

      if (!selection || isCapturing) {
        return;
      }

      const step = event.shiftKey ? 10 : 1;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        nudgeSelection(-step, 0);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        nudgeSelection(step, 0);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        nudgeSelection(0, -step);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        nudgeSelection(0, step);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isCapturing, selection]);

  const completeSelection = async (rect: Rect) => {
    if (isCapturing) return;
    if (rect.width < 8 || rect.height < 8) {
      clearSelection();
      return;
    }

    setIsCapturing(true);
    try {
      if (nativeClient.isAvailable()) {
        await nativeClient.capture.completeSnipSelection(rect);
      }
    } catch (error) {
      console.error('[TIDYDESK] Failed to complete snip selection:', error);
      cancelSnip();
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div
      className="snip-overlay-root relative h-screen w-screen cursor-crosshair select-none overflow-hidden text-white"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.12)' }}
      onMouseDown={event => {
        if (isCapturing) return;
        if (event.button !== 0) {
          cancelSnip();
          return;
        }
        const point = { x: event.clientX, y: event.clientY };
        setCursorPoint(point);
        setIsDragging(true);
        setStartPoint(point);
        setEndPoint(point);
      }}
      onMouseMove={event => {
        const point = { x: event.clientX, y: event.clientY };
        setCursorPoint(point);
        if (!startPoint || !isDragging || isCapturing) return;
        setEndPoint(point);
      }}
      onMouseUp={event => {
        if (!startPoint || !isDragging || isCapturing) return;
        const point = { x: event.clientX, y: event.clientY };
        setCursorPoint(point);
        setIsDragging(false);
        setEndPoint(point);
      }}
      onContextMenu={event => {
        event.preventDefault();
        if (!isCapturing) {
          cancelSnip();
        }
      }}
    >
      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-white/18"
        style={{ left: cursorPoint.x }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 h-px bg-white/18"
        style={{ top: cursorPoint.y }}
      />

      <div className="pointer-events-none absolute left-1/2 top-7 -translate-x-1/2 rounded-xl border border-white/15 bg-black/55 px-4 py-3 text-[12px] font-medium shadow-2xl backdrop-blur-sm">
        {selection ? 'Enter / Space 确认，方向键微调，Shift + 方向键快速移动，Esc 取消' : '拖拽创建选区，Ctrl + A 全屏，Esc 取消'}
      </div>

      {selection && (
        <div
          className="pointer-events-none absolute border border-sky-200 bg-sky-300/12 shadow-[0_0_0_9999px_rgba(2,6,23,0.42)]"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height
          }}
        >
          <div className="absolute -top-7 left-0 rounded bg-sky-200 px-2 py-1 text-[11px] font-bold text-slate-950">
            {Math.round(selection.width)} x {Math.round(selection.height)} | {Math.round(selection.x)}, {Math.round(selection.y)}
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
