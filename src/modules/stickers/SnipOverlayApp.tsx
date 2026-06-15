import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nativeClient } from '../../native/native-client';

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

function centerPoint(): Point {
  return {
    x: Math.round(window.innerWidth / 2),
    y: Math.round(window.innerHeight / 2)
  };
}

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
  const [cursorPoint, setCursorPoint] = useState<Point>(centerPoint);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const pendingPointRef = useRef<Point | null>(null);
  const pendingEndPointRef = useRef(false);

  const cancelSnip = () => {
    if (!nativeClient.isAvailable()) return;
    void nativeClient.capture.cancelSnip().catch(() => {});
  };

  const selection = useMemo(() => {
    if (!startPoint || !endPoint) return null;
    return rectFromPoints(startPoint, endPoint);
  }, [startPoint, endPoint]);

  const cancelPendingPointerFrame = useCallback(() => {
    if (pointerFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerFrameRef.current);
      pointerFrameRef.current = null;
    }
    pendingPointRef.current = null;
    pendingEndPointRef.current = false;
  }, []);

  const schedulePointerUpdate = useCallback((point: Point, updateEndPoint: boolean) => {
    pendingPointRef.current = point;
    pendingEndPointRef.current = updateEndPoint;
    if (pointerFrameRef.current !== null) return;

    pointerFrameRef.current = window.requestAnimationFrame(() => {
      pointerFrameRef.current = null;
      const nextPoint = pendingPointRef.current;
      const shouldUpdateEndPoint = pendingEndPointRef.current;
      pendingPointRef.current = null;
      pendingEndPointRef.current = false;
      if (!nextPoint) return;
      setCursorPoint(nextPoint);
      if (shouldUpdateEndPoint) {
        setEndPoint(nextPoint);
      }
    });
  }, []);

  const clearSelection = () => {
    cancelPendingPointerFrame();
    setIsDragging(false);
    setStartPoint(null);
    setEndPoint(null);
  };

  const resetOverlay = useCallback(() => {
    cancelPendingPointerFrame();
    setIsDragging(false);
    setIsCapturing(false);
    setStartPoint(null);
    setEndPoint(null);
    setCursorPoint(centerPoint());
    setBgImage(null);
    setBgError(null);
  }, [cancelPendingPointerFrame]);

  const loadBackgroundImage = useCallback(() => {
    nativeClient.capture.getBackgroundImage().then(result => {
      if (result.success && result.imageUrl) {
        setBgImage(result.imageUrl);
        setBgError(null);
      } else {
        setBgImage(null);
        setBgError(result.error || '无法获取当前桌面截图，请取消后重试');
      }
    }).catch(err => {
      console.error('[TIDYDESK] Failed to fetch background image:', err);
      setBgImage(null);
      setBgError(err instanceof Error ? err.message : String(err));
    });
  }, []);

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
    if (!nativeClient.isAvailable()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    import('@tauri-apps/api/event')
      .then(api => api.listen('snip-reset', () => {
        resetOverlay();
        loadBackgroundImage();
      }))
      .then(nextUnlisten => {
        if (disposed) nextUnlisten();
        else unlisten = nextUnlisten;
      })
      .catch(error => {
        console.error('[TIDYDESK] Failed to bind snip reset listener:', error);
      });

    loadBackgroundImage();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [loadBackgroundImage, resetOverlay]);

  useEffect(() => cancelPendingPointerFrame, [cancelPendingPointerFrame]);

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
    if (!bgImage) {
      setBgError('没有可用的桌面截图，无法生成贴纸');
      return;
    }
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
      data-testid="snip-overlay-root"
      className="snip-overlay-root relative h-screen w-screen cursor-crosshair select-none overflow-hidden text-white bg-slate-950"
      style={{
        backgroundImage: bgImage ? `url(${bgImage})` : 'none',
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat'
      }}
      onMouseDown={event => {
        if (isCapturing) return;
        if (event.button !== 0) {
          cancelSnip();
          return;
        }
        cancelPendingPointerFrame();
        const point = { x: event.clientX, y: event.clientY };
        setCursorPoint(point);
        setIsDragging(true);
        setStartPoint(point);
        setEndPoint(point);
      }}
      onMouseMove={event => {
        const point = { x: event.clientX, y: event.clientY };
        schedulePointerUpdate(point, Boolean(startPoint && isDragging && !isCapturing));
      }}
      onMouseUp={event => {
        if (!startPoint || !isDragging || isCapturing) return;
        cancelPendingPointerFrame();
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
      {!selection && (
        <div className="pointer-events-none absolute inset-0 bg-black/40" />
      )}

      {bgError && (
        <div className="pointer-events-none absolute left-1/2 top-24 z-10 w-[420px] max-w-[calc(100vw-48px)] -translate-x-1/2 rounded-xl border border-rose-300/25 bg-rose-950/78 px-4 py-3 text-center text-[12px] font-semibold leading-5 text-rose-50 shadow-2xl backdrop-blur-sm">
          {bgError}
        </div>
      )}

      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-white/25"
        style={{ left: cursorPoint.x }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 h-px bg-white/25"
        style={{ top: cursorPoint.y }}
      />

      <div className="pointer-events-none absolute left-1/2 top-7 -translate-x-1/2 rounded-xl border border-white/20 bg-black/70 px-4 py-3 text-[12px] font-medium shadow-2xl backdrop-blur-sm">
        {selection
          ? 'Enter/空格 确认 | 方向键 微调 | Shift+方向键 快速微调 | Esc 取消'
          : '拖拽鼠标框选 | Ctrl + A 全屏截图 | 右键/Esc 取消'}
      </div>

      {!selection && !isDragging && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/18 bg-slate-950/68 px-5 py-4 text-center shadow-2xl backdrop-blur-md">
          <div className="text-sm font-semibold tracking-[0.08em] text-white/95">
            请点击并拖拽进行框选
          </div>
          <div className="mt-2 text-[12px] leading-5 text-white/70">
            松开鼠标完成框选，按 Enter/空格 或 双击选区 确认截图，生成桌面贴纸。
          </div>
        </div>
      )}

      {selection && (
        <>
          <div
            className={`absolute border border-sky-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)] ${isCapturing ? 'pointer-events-none' : 'cursor-move'}`}
            style={{
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height
            }}
            onDoubleClick={() => completeSelection(selection)}
          >
            <div className="pointer-events-none absolute -top-7 left-0 rounded bg-sky-200 px-2 py-1 text-[11px] font-bold text-slate-950">
              {Math.round(selection.width)} x {Math.round(selection.height)} | {Math.round(selection.x)},{' '}
              {Math.round(selection.y)}
            </div>

            {!isDragging && (
              <div
                className="absolute -bottom-10 right-0 flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/90 p-1 shadow-xl backdrop-blur-md"
                onMouseDown={e => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => cancelSnip()}
                  className="rounded px-3 py-1 text-[11px] font-bold text-slate-300 hover:bg-white/10 hover:text-white"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => completeSelection(selection)}
                  className="rounded bg-sky-500 px-3 py-1 text-[11px] font-bold text-white hover:bg-sky-400"
                >
                  确认截图
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {isCapturing && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40 text-[13px] font-bold">
          正在生成贴纸...
        </div>
      )}
    </div>
  );
};
