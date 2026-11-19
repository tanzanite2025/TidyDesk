import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nativeClient } from '../../native/native-client';
import {
  centerPoint,
  clampRectToViewport,
  pointsFromRect,
  rectFromPoints,
  viewportRect,
  type SnipPoint,
  type SnipRect
} from './snipGeometry';

/**
 * Manage snip background loading, pointer selection RAF throttling, and keyboard shortcuts.
 */
export function useSnipSelection() {
  const [startPoint, setStartPoint] = useState<SnipPoint | null>(null);
  const [endPoint, setEndPoint] = useState<SnipPoint | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [cursorPoint, setCursorPoint] = useState<SnipPoint>(centerPoint);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const pendingPointRef = useRef<SnipPoint | null>(null);
  const pendingEndPointRef = useRef(false);

  const cancelSnip = useCallback(() => {
    if (!nativeClient.isAvailable()) return;
    void nativeClient.capture.cancelSnip().catch(err => {
      console.error('[TIDYDESK] Failed to cancel snip:', err);
    });
  }, []);

  const selection = useMemo(() => {
    if (!startPoint || !endPoint) return null;
    return rectFromPoints(startPoint, endPoint);
  }, [startPoint, endPoint]);

  const selectionRef = useRef<SnipRect | null>(null);
  selectionRef.current = selection;

  const cancelPendingPointerFrame = useCallback(() => {
    if (pointerFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerFrameRef.current);
      pointerFrameRef.current = null;
    }
    pendingPointRef.current = null;
    pendingEndPointRef.current = false;
  }, []);

  const schedulePointerUpdate = useCallback((point: SnipPoint, updateEndPoint: boolean) => {
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

  const clearSelection = useCallback(() => {
    cancelPendingPointerFrame();
    setIsDragging(false);
    setStartPoint(null);
    setEndPoint(null);
  }, [cancelPendingPointerFrame]);

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

  const applySelection = useCallback((rect: SnipRect) => {
    const clamped = clampRectToViewport(rect);
    const { start, end } = pointsFromRect(clamped);
    setStartPoint(start);
    setEndPoint(end);
  }, []);

  const nudgeSelection = useCallback((dx: number, dy: number) => {
    const current = selectionRef.current;
    if (!current || isCapturing) return;
    const moved = clampRectToViewport({
      x: current.x + dx,
      y: current.y + dy,
      width: current.width,
      height: current.height
    });
    applySelection(moved);
  }, [applySelection, isCapturing]);

  const completeSelection = useCallback(async (rect: SnipRect) => {
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
  }, [bgImage, cancelSnip, clearSelection, isCapturing]);

  const completeSelectionRef = useRef(completeSelection);
  completeSelectionRef.current = completeSelection;

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

      const currentSelection = selectionRef.current;
      if ((event.key === 'Enter' || event.key === ' ') && currentSelection && !isCapturing) {
        event.preventDefault();
        void completeSelectionRef.current(currentSelection);
        return;
      }

      if (!currentSelection || isCapturing) {
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
  }, [applySelection, cancelSnip, isCapturing, nudgeSelection]);

  const beginDrag = useCallback((point: SnipPoint) => {
    cancelPendingPointerFrame();
    setCursorPoint(point);
    setIsDragging(true);
    setStartPoint(point);
    setEndPoint(point);
  }, [cancelPendingPointerFrame]);

  const finishDrag = useCallback((point: SnipPoint) => {
    if (!startPoint || !isDragging || isCapturing) return;
    cancelPendingPointerFrame();
    setCursorPoint(point);
    setIsDragging(false);
    setEndPoint(point);
  }, [cancelPendingPointerFrame, isCapturing, isDragging, startPoint]);

  return {
    bgImage,
    bgError,
    cursorPoint,
    selection,
    isDragging,
    isCapturing,
    hasStartPoint: Boolean(startPoint),
    cancelSnip,
    completeSelection,
    schedulePointerUpdate,
    beginDrag,
    finishDrag
  };
}
