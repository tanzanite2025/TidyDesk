import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nativeClient } from '../../../native/native-client';
import type {
  SnipMonitorMeta,
  SnipOutputAction,
  SnipTargetKind
} from '../../../types/tidydesk-api';
import {
  clearAnnotationHistory,
  commitAnnotationOp,
  createEmptyHistory,
  findTopmostAnnotationAtPoint,
  nextStepNumber,
  redoAnnotationHistory,
  replaceAnnotationOps,
  translateAnnotationOp,
  undoAnnotationHistory,
  type AnnotationHistoryState
} from '../annotations/history';
import {
  exportAnnotatedSelectionPng,
  loadBackdropImageElement,
  uint8ArrayToBase64
} from '../annotations/compositor';
import {
  createAnnotationId,
  DEFAULT_ANNOTATION_STYLE,
  type AnnotationOp,
  type AnnotationStyle,
  type AnnotationTool
} from '../annotations/types';
import {
  centerPoint,
  clampRectToViewport,
  MIN_SNIP_SIZE,
  moveRectWithinViewport,
  pointInRect,
  rectFromPoints,
  resizeRectByHandle,
  snapAnglePoint,
  snapSquarePoint,
  viewportRect,
  type ResizeHandle,
  type SnipPoint,
  type SnipRect
} from '../snipGeometry';

export type SnipPhase =
  | 'idle'
  | 'selecting'
  | 'ready'
  | 'moving'
  | 'resizing'
  | 'annotating'
  | 'moving_annotation'
  | 'editing_text'
  | 'committing';

export interface TextDraftState {
  position: SnipPoint;
  value: string;
}

type DragSession =
  | { kind: 'selecting'; start: SnipPoint }
  | { kind: 'moving'; startCursor: SnipPoint; originRect: SnipRect }
  | { kind: 'resizing'; handle: ResizeHandle; startCursor: SnipPoint; originRect: SnipRect }
  | { kind: 'moving_annotation'; opId: string; startCursor: SnipPoint; originOp: AnnotationOp; baseOps: AnnotationOp[] }
  | { kind: 'annotating'; tool: Exclude<AnnotationTool, 'select' | 'text' | 'step'>; startPoint: SnipPoint; points: SnipPoint[]; opId: string };

function buildDraftAnnotation(
  drag: Extract<DragSession, { kind: 'annotating' }>,
  currentPoint: SnipPoint,
  shiftKey: boolean,
  style: AnnotationStyle
): AnnotationOp {
  const { tool, startPoint, points, opId } = drag;
  switch (tool) {
    case 'rect': {
      const targetEnd = shiftKey ? snapSquarePoint(startPoint, currentPoint) : currentPoint;
      const box = rectFromPoints(startPoint, targetEnd);
      return { id: opId, type: 'rect', ...box, cornerRadius: 2, style: { ...style } };
    }
    case 'ellipse': {
      const targetEnd = shiftKey ? snapSquarePoint(startPoint, currentPoint) : currentPoint;
      const box = rectFromPoints(startPoint, targetEnd);
      return { id: opId, type: 'ellipse', ...box, style: { ...style } };
    }
    case 'arrow': {
      const targetEnd = shiftKey ? snapAnglePoint(startPoint, currentPoint) : currentPoint;
      return { id: opId, type: 'arrow', start: startPoint, end: targetEnd, style: { ...style } };
    }
    case 'line': {
      const targetEnd = shiftKey ? snapAnglePoint(startPoint, currentPoint) : currentPoint;
      return { id: opId, type: 'line', start: startPoint, end: targetEnd, style: { ...style } };
    }
    case 'brush':
    case 'highlighter':
    case 'mosaic':
      return {
        id: opId,
        type: tool,
        points: points.length > 0 ? points : [startPoint, currentPoint],
        style: { ...style }
      };
  }
}

/**
 * Finite-state controller for full-screen snip selection, 8-handle adjustments,
 * non-destructive vector/mosaic annotations, undo/redo, and multi-sink export.
 */
export function useSnipSession() {
  const [phase, setPhase] = useState<SnipPhase>('idle');
  const [selection, setSelection] = useState<SnipRect | null>(null);
  const [cursorPoint, setCursorPoint] = useState<SnipPoint>(centerPoint);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [backdropElement, setBackdropElement] = useState<HTMLImageElement | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [targetKind, setTargetKind] = useState<SnipTargetKind>('standard');
  const [monitorMeta, setMonitorMeta] = useState<SnipMonitorMeta | null>(null);

  const [activeTool, setActiveTool] = useState<AnnotationTool>('select');
  const [style, setStyle] = useState<AnnotationStyle>(DEFAULT_ANNOTATION_STYLE);
  const [history, setHistory] = useState<AnnotationHistoryState>(createEmptyHistory);
  const [draftOp, setDraftOp] = useState<AnnotationOp | null>(null);
  const [selectedOpId, setSelectedOpId] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraftState | null>(null);

  const dragSessionRef = useRef<DragSession | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ point: SnipPoint; shiftKey: boolean } | null>(null);
  const loadRequestIdRef = useRef(0);

  const stateRef = useRef({
    phase,
    selection,
    activeTool,
    style,
    history,
    selectedOpId,
    textDraft,
    bgImage,
    backdropElement,
    sessionId,
    targetKind
  });
  stateRef.current = {
    phase,
    selection,
    activeTool,
    style,
    history,
    selectedOpId,
    textDraft,
    bgImage,
    backdropElement,
    sessionId,
    targetKind
  };

  const defaultConfirmAction: SnipOutputAction =
    targetKind === 'todo_card' ? 'attach_todo' : 'copy';

  const cancelPendingPointerFrame = useCallback(() => {
    if (pointerFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerFrameRef.current);
      pointerFrameRef.current = null;
    }
    pendingMoveRef.current = null;
  }, []);

  const cancelSnip = useCallback(() => {
    if (!nativeClient.isAvailable()) return;
    void nativeClient.capture.cancelSnip().catch(err => {
      console.error('[TIDYDESK] Failed to cancel snip:', err);
    });
  }, []);

  const resetOverlay = useCallback(() => {
    cancelPendingPointerFrame();
    dragSessionRef.current = null;
    setPhase('idle');
    setSelection(null);
    setCursorPoint(centerPoint());
    setBgImage(null);
    setBackdropElement(null);
    setBgError(null);
    setSessionId(null);
    setTargetKind('standard');
    setMonitorMeta(null);
    setActiveTool('select');
    setStyle(DEFAULT_ANNOTATION_STYLE);
    setHistory(createEmptyHistory());
    setDraftOp(null);
    setSelectedOpId(null);
    setTextDraft(null);
  }, [cancelPendingPointerFrame]);

  const loadBackgroundImage = useCallback(() => {
    const requestId = ++loadRequestIdRef.current;
    nativeClient.capture
      .getBackgroundImage()
      .then(async result => {
        if (requestId !== loadRequestIdRef.current) return;
        if (result.success && result.imageUrl) {
          setBgImage(result.imageUrl);
          setSessionId(result.sessionId ?? null);
          setTargetKind(result.targetKind ?? 'standard');
          setMonitorMeta(result.monitor ?? null);
          setBgError(null);
          try {
            const imgEl = await loadBackdropImageElement(result.imageUrl);
            if (requestId === loadRequestIdRef.current) {
              setBackdropElement(imgEl);
            }
          } catch (decodeErr) {
            console.error('[TIDYDESK] Backdrop image decode error:', decodeErr);
            if (requestId === loadRequestIdRef.current) {
              setBgError(
                decodeErr instanceof Error ? decodeErr.message : '无法解码桌面截图背景'
              );
            }
          }
        } else {
          setBgImage(null);
          setBackdropElement(null);
          setBgError(result.error || '无法获取当前桌面截图，请取消后重试');
        }
      })
      .catch(err => {
        if (requestId !== loadRequestIdRef.current) return;
        console.error('[TIDYDESK] Failed to fetch background image:', err);
        setBgImage(null);
        setBackdropElement(null);
        setBgError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const cancelTextDraft = useCallback(() => {
    if (!stateRef.current.textDraft) return;
    stateRef.current.textDraft = null;
    setTextDraft(null);
    setPhase(stateRef.current.selection ? 'ready' : 'idle');
  }, []);

  const commitTextDraft = useCallback((valueOverride?: string) => {
    const currentDraft = stateRef.current.textDraft;
    if (!currentDraft) return;
    // Clear ref synchronously before blur/unmount re-entry can trigger a duplicate commit.
    stateRef.current.textDraft = null;
    const textValue = (valueOverride ?? currentDraft.value).trimEnd();
    setTextDraft(null);
    setPhase(stateRef.current.selection ? 'ready' : 'idle');
    if (textValue.trim().length === 0) {
      return;
    }
    const op: AnnotationOp = {
      id: createAnnotationId('text'),
      type: 'text',
      position: currentDraft.position,
      text: textValue,
      style: { ...stateRef.current.style }
    };
    setHistory(prev => commitAnnotationOp(prev, op));
    setSelectedOpId(op.id);
  }, []);

  const undo = useCallback(() => {
    setDraftOp(null);
    setSelectedOpId(null);
    setHistory(prev => undoAnnotationHistory(prev));
  }, []);

  const redo = useCallback(() => {
    setDraftOp(null);
    setSelectedOpId(null);
    setHistory(prev => redoAnnotationHistory(prev));
  }, []);

  const clearAnnotations = useCallback(() => {
    setDraftOp(null);
    setSelectedOpId(null);
    setTextDraft(null);
    setHistory(prev => clearAnnotationHistory(prev));
  }, []);

  const deleteSelectedAnnotation = useCallback(() => {
    const id = stateRef.current.selectedOpId;
    if (!id) return;
    setSelectedOpId(null);
    setHistory(prev => replaceAnnotationOps(prev, prev.present.filter(op => op.id !== id)));
  }, []);

  const completeSelection = useCallback(
    async (action: SnipOutputAction = defaultConfirmAction, rectOverride?: SnipRect) => {
      const current = stateRef.current;
      if (current.phase === 'committing') return;

      // Flush open text draft before exporting
      let effectiveOps = current.history.present;
      if (current.textDraft && current.textDraft.value.trim().length > 0) {
        const textOp: AnnotationOp = {
          id: createAnnotationId('text'),
          type: 'text',
          position: current.textDraft.position,
          text: current.textDraft.value.trimEnd(),
          style: { ...current.style }
        };
        effectiveOps = [...effectiveOps, textOp];
        stateRef.current.textDraft = null;
        setTextDraft(null);
        setHistory(prev => commitAnnotationOp(prev, textOp));
      } else if (current.textDraft) {
        stateRef.current.textDraft = null;
        setTextDraft(null);
      }

      const rect = rectOverride ?? current.selection;
      if (!rect || rect.width < MIN_SNIP_SIZE || rect.height < MIN_SNIP_SIZE) {
        setBgError('请先框选有效的截图区域（至少 8x8 px）');
        return;
      }
      if (!current.bgImage) {
        setBgError('没有可用的桌面截图，无法完成输出');
        return;
      }

      const hasAnnotations = effectiveOps.length > 0;
      setPhase('committing');
      setBgError(null);

      try {
        let compositedPngBase64: string | undefined;
        if (hasAnnotations) {
          const backdrop =
            current.backdropElement ?? (await loadBackdropImageElement(current.bgImage));
          const pngBytes = await exportAnnotatedSelectionPng({
            backdropImage: backdrop,
            selection: rect,
            viewport: {
              width: Math.max(1, window.innerWidth),
              height: Math.max(1, window.innerHeight)
            },
            ops: effectiveOps
          });
          compositedPngBase64 = uint8ArrayToBase64(pngBytes);
        }

        if (nativeClient.isAvailable()) {
          await nativeClient.capture.completeSnipSelection({
            ...rect,
            action,
            hasAnnotations,
            compositedPngBase64,
            sessionId: current.sessionId ?? undefined
          });
        }
      } catch (error) {
        console.error('[TIDYDESK] Failed to complete snip selection:', error);
        setBgError(error instanceof Error ? error.message : String(error));
        setPhase('ready');
      }
    },
    [defaultConfirmAction]
  );

  const beginCreateSelection = useCallback((point: SnipPoint) => {
    dragSessionRef.current = { kind: 'selecting', start: point };
    setPhase('selecting');
    setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
    setSelectedOpId(null);
  }, []);

  const beginMoveSelection = useCallback((point: SnipPoint) => {
    const sel = stateRef.current.selection;
    if (!sel || stateRef.current.phase === 'committing') return;
    dragSessionRef.current = { kind: 'moving', startCursor: point, originRect: sel };
    setPhase('moving');
    setSelectedOpId(null);
  }, []);

  const beginResizeHandle = useCallback((handle: ResizeHandle, point: SnipPoint) => {
    const sel = stateRef.current.selection;
    if (!sel || stateRef.current.phase === 'committing') return;
    dragSessionRef.current = { kind: 'resizing', handle, startCursor: point, originRect: sel };
    setPhase('resizing');
    setSelectedOpId(null);
  }, []);

  const handleRootMouseDown = useCallback(
    (point: SnipPoint, button: number) => {
      const current = stateRef.current;
      if (current.phase === 'committing') return;
      if (button !== 0) {
        if (current.phase === 'editing_text') {
          commitTextDraft();
          return;
        }
        cancelSnip();
        return;
      }

      if (current.phase === 'editing_text') {
        commitTextDraft();
        return;
      }

      if (current.phase === 'idle' || !current.selection) {
        beginCreateSelection(point);
        return;
      }

      // Clicking outside selection resets only when no annotations exist and select tool active
      if (!pointInRect(point, current.selection)) {
        if (current.history.present.length === 0 && current.activeTool === 'select') {
          beginCreateSelection(point);
        }
        return;
      }

      // Inside selection: route according to active tool
      const tool = current.activeTool;
      if (tool === 'select') {
        const hitOp = findTopmostAnnotationAtPoint(current.history.present, point);
        if (hitOp) {
          setSelectedOpId(hitOp.id);
          dragSessionRef.current = {
            kind: 'moving_annotation',
            opId: hitOp.id,
            startCursor: point,
            originOp: hitOp,
            baseOps: current.history.present
          };
          setPhase('moving_annotation');
        } else {
          beginMoveSelection(point);
        }
        return;
      }

      if (tool === 'text') {
        setSelectedOpId(null);
        const clampedPos: SnipPoint = {
          x: Math.max(8, Math.min(point.x, Math.max(8, window.innerWidth - 180))),
          y: Math.max(8, Math.min(point.y, Math.max(8, window.innerHeight - 64)))
        };
        const nextDraft = { position: clampedPos, value: '' };
        stateRef.current.textDraft = nextDraft;
        setTextDraft(nextDraft);
        setPhase('editing_text');
        return;
      }

      if (tool === 'step') {
        const nextNum = nextStepNumber(current.history.present);
        const radius = Math.max(12, Math.round(current.style.strokeWidth * 1.9 + 7));
        const op: AnnotationOp = {
          id: createAnnotationId('step'),
          type: 'step',
          position: point,
          number: nextNum,
          radius,
          style: { ...current.style }
        };
        setHistory(prev => commitAnnotationOp(prev, op));
        setSelectedOpId(op.id);
        return;
      }

      const opId = createAnnotationId(tool);
      const initialDrag: Extract<DragSession, { kind: 'annotating' }> = {
        kind: 'annotating',
        tool,
        startPoint: point,
        points: [point],
        opId
      };
      dragSessionRef.current = initialDrag;
      setSelectedOpId(null);
      setDraftOp(buildDraftAnnotation(initialDrag, point, false, current.style));
      setPhase('annotating');
    },
    [beginCreateSelection, beginMoveSelection, cancelSnip, commitTextDraft]
  );

  const processPointerMove = useCallback((point: SnipPoint, shiftKey: boolean) => {
    setCursorPoint(point);
    const drag = dragSessionRef.current;
    if (!drag) return;

    switch (drag.kind) {
      case 'selecting': {
        setSelection(clampRectToViewport(rectFromPoints(drag.start, point)));
        break;
      }
      case 'moving': {
        setSelection(
          moveRectWithinViewport(drag.originRect, {
            x: point.x - drag.startCursor.x,
            y: point.y - drag.startCursor.y
          })
        );
        break;
      }
      case 'resizing': {
        setSelection(
          resizeRectByHandle(drag.originRect, drag.handle, {
            x: point.x - drag.startCursor.x,
            y: point.y - drag.startCursor.y
          })
        );
        break;
      }
      case 'moving_annotation': {
        const dx = point.x - drag.startCursor.x;
        const dy = point.y - drag.startCursor.y;
        const moved = translateAnnotationOp(drag.originOp, dx, dy);
        setHistory(prev => ({
          ...prev,
          present: drag.baseOps.map(op => (op.id === drag.opId ? moved : op))
        }));
        break;
      }
      case 'annotating': {
        if (drag.tool === 'brush' || drag.tool === 'highlighter' || drag.tool === 'mosaic') {
          const last = drag.points[drag.points.length - 1];
          if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 2) {
            drag.points.push(point);
          }
        }
        setDraftOp(buildDraftAnnotation(drag, point, shiftKey, stateRef.current.style));
        break;
      }
    }
  }, []);

  const schedulePointerMove = useCallback(
    (point: SnipPoint, shiftKey: boolean) => {
      pendingMoveRef.current = { point, shiftKey };
      if (pointerFrameRef.current !== null) return;
      pointerFrameRef.current = window.requestAnimationFrame(() => {
        pointerFrameRef.current = null;
        const next = pendingMoveRef.current;
        pendingMoveRef.current = null;
        if (next) {
          processPointerMove(next.point, next.shiftKey);
        }
      });
    },
    [processPointerMove]
  );

  const finishPointerInteraction = useCallback(
    (point: SnipPoint, shiftKey: boolean) => {
      cancelPendingPointerFrame();
      const drag = dragSessionRef.current;
      dragSessionRef.current = null;
      if (!drag) return;

      switch (drag.kind) {
        case 'selecting': {
          const next = clampRectToViewport(rectFromPoints(drag.start, point));
          if (next.width < MIN_SNIP_SIZE || next.height < MIN_SNIP_SIZE) {
            setSelection(null);
            setPhase('idle');
          } else {
            setSelection(next);
            setPhase('ready');
          }
          break;
        }
        case 'moving':
        case 'resizing': {
          setPhase('ready');
          break;
        }
        case 'moving_annotation': {
          const dx = point.x - drag.startCursor.x;
          const dy = point.y - drag.startCursor.y;
          if (Math.hypot(dx, dy) >= 2) {
            const moved = translateAnnotationOp(drag.originOp, dx, dy);
            const nextList = drag.baseOps.map(op => (op.id === drag.opId ? moved : op));
            // Commit from original base snapshot into undo stack cleanly
            setHistory(prev => ({
              past: [...prev.past, drag.baseOps].slice(-100),
              present: nextList,
              future: []
            }));
          }
          setPhase('ready');
          break;
        }
        case 'annotating': {
          const finalOp = buildDraftAnnotation(drag, point, shiftKey, stateRef.current.style);
          setDraftOp(null);
          setPhase('ready');
          const valid =
            finalOp.type === 'rect' || finalOp.type === 'ellipse'
              ? finalOp.width >= 3 || finalOp.height >= 3
              : finalOp.type === 'arrow' || finalOp.type === 'line'
              ? Math.hypot(finalOp.end.x - finalOp.start.x, finalOp.end.y - finalOp.start.y) >= 4
              : true;
          if (valid) {
            setHistory(prev => commitAnnotationOp(prev, finalOp));
          }
          break;
        }
      }
    },
    [cancelPendingPointerFrame]
  );

  // Global window pointer listeners prevent lost mouseup when dragging outside overlay edges.
  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      schedulePointerMove({ x: event.clientX, y: event.clientY }, event.shiftKey);
    };
    const onMouseUp = (event: MouseEvent) => {
      if (dragSessionRef.current) {
        finishPointerInteraction({ x: event.clientX, y: event.clientY }, event.shiftKey);
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [finishPointerInteraction, schedulePointerMove]);

  useEffect(() => {
    if (!nativeClient.isAvailable()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    import('@tauri-apps/api/event')
      .then(api =>
        api.listen('snip-reset', () => {
          resetOverlay();
          loadBackgroundImage();
        })
      )
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
      const current = stateRef.current;
      if (current.phase === 'committing') return;

      // While typing text inline, let editor handle keys except Escape
      if (current.phase === 'editing_text') {
        if (event.key === 'Escape') {
          event.preventDefault();
          setTextDraft(null);
          setPhase(current.selection ? 'ready' : 'idle');
        }
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        if (current.selectedOpId) {
          setSelectedOpId(null);
          return;
        }
        if (current.activeTool !== 'select') {
          setActiveTool('select');
          return;
        }
        if (current.selection && current.history.present.length === 0) {
          setSelection(null);
          setPhase('idle');
          return;
        }
        cancelSnip();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        ((event.shiftKey && event.key.toLowerCase() === 'z') || event.key.toLowerCase() === 'y')
      ) {
        event.preventDefault();
        redo();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && current.selection) {
        event.preventDefault();
        void completeSelection('copy');
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelection(viewportRect());
        setPhase('ready');
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && current.selectedOpId) {
        event.preventDefault();
        deleteSelectedAnnotation();
        return;
      }

      if (event.key === 'Enter' && current.selection) {
        event.preventDefault();
        void completeSelection(current.targetKind === 'todo_card' ? 'attach_todo' : 'copy');
        return;
      }

      if (event.key === ' ' && current.selection && current.activeTool === 'select') {
        event.preventDefault();
        void completeSelection(current.targetKind === 'todo_card' ? 'attach_todo' : 'copy');
        return;
      }

      if (!current.selection) return;

      const step = event.shiftKey ? 10 : 1;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setSelection(prev => (prev ? moveRectWithinViewport(prev, { x: -step, y: 0 }) : prev));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setSelection(prev => (prev ? moveRectWithinViewport(prev, { x: step, y: 0 }) : prev));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelection(prev => (prev ? moveRectWithinViewport(prev, { x: 0, y: -step }) : prev));
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelection(prev => (prev ? moveRectWithinViewport(prev, { x: 0, y: step }) : prev));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelSnip, completeSelection, deleteSelectedAnnotation, redo, undo]);

  const renderedOps = useMemo(() => {
    return draftOp ? [...history.present, draftOp] : history.present;
  }, [draftOp, history.present]);

  const updateStyle = useCallback((patch: Partial<AnnotationStyle>) => {
    setStyle(prev => ({ ...prev, ...patch }));
  }, []);

  const selectTool = useCallback((tool: AnnotationTool) => {
    if (stateRef.current.textDraft) {
      commitTextDraft();
    }
    setSelectedOpId(null);
    setActiveTool(tool);
  }, [commitTextDraft]);

  return {
    phase,
    selection,
    cursorPoint,
    bgImage,
    backdropElement,
    bgError,
    targetKind,
    monitorMeta,
    activeTool,
    style,
    history,
    renderedOps,
    selectedOpId,
    textDraft,
    defaultConfirmAction,
    isDraggingSelection: phase === 'selecting' || phase === 'moving' || phase === 'resizing',
    isCapturing: phase === 'committing',
    setTextDraft,
    commitTextDraft,
    cancelTextDraft,
    selectTool,
    updateStyle,
    undo,
    redo,
    clearAnnotations,
    cancelSnip,
    completeSelection,
    handleRootMouseDown,
    beginResizeHandle
  };
}
