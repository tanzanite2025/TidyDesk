import React, { useEffect, useMemo, useRef, useState } from 'react';
import { renderAnnotationsLayer } from './annotations/renderer';
import { canRedo, canUndo } from './annotations/history';
import { SnipMagnifier } from './components/SnipMagnifier';
import { SnipTextEditor } from './components/SnipTextEditor';
import { SnipToolbar } from './components/SnipToolbar';
import { useSnipSession } from './selection/useSnipSession';
import {
  computeFloatingToolbarPosition,
  logicalRectToPhysical,
  type ResizeHandle
} from './snipGeometry';

const HANDLE_DEFINITIONS: readonly {
  handle: ResizeHandle;
  cursor: string;
  style: React.CSSProperties;
}[] = [
  { handle: 'nw', cursor: 'nwse-resize', style: { left: -5, top: -5 } },
  { handle: 'n', cursor: 'ns-resize', style: { left: '50%', top: -5, transform: 'translateX(-50%)' } },
  { handle: 'ne', cursor: 'nesw-resize', style: { right: -5, top: -5 } },
  { handle: 'e', cursor: 'ew-resize', style: { right: -5, top: '50%', transform: 'translateY(-50%)' } },
  { handle: 'se', cursor: 'nwse-resize', style: { right: -5, bottom: -5 } },
  { handle: 's', cursor: 'ns-resize', style: { left: '50%', bottom: -5, transform: 'translateX(-50%)' } },
  { handle: 'sw', cursor: 'nesw-resize', style: { left: -5, bottom: -5 } },
  { handle: 'w', cursor: 'ew-resize', style: { left: -5, top: '50%', transform: 'translateY(-50%)' } }
];

export const SnipOverlayApp: React.FC = () => {
  const {
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
    isDraggingSelection,
    isCapturing,
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
  } = useSnipSession();

  const [viewportSize, setViewportSize] = useState(() => ({
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight)
  }));

  useEffect(() => {
    const syncViewport = () => {
      setViewportSize({
        width: Math.max(1, window.innerWidth),
        height: Math.max(1, window.innerHeight)
      });
    };
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mosaicCacheRef = useRef<Map<number, HTMLCanvasElement>>(new Map());

  // Clear cached mosaic grids whenever a fresh snip backdrop arrives.
  useEffect(() => {
    mosaicCacheRef.current.clear();
  }, [backdropElement]);

  // Repaint live annotation overlay canvas at crisp devicePixelRatio resolution.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const vw = viewportSize.width;
    const vh = viewportSize.height;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const targetW = Math.round(vw * dpr);
    const targetH = Math.round(vh * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, targetW, targetH);

    if (renderedOps.length === 0) return;

    if (!scratchCanvasRef.current) {
      scratchCanvasRef.current = document.createElement('canvas');
    }

    const backdropScaleX = backdropElement
      ? (backdropElement.naturalWidth || vw) / vw
      : monitorMeta?.scaleFactor ?? dpr;
    const backdropScaleY = backdropElement
      ? (backdropElement.naturalHeight || vh) / vh
      : monitorMeta?.scaleFactor ?? dpr;

    renderAnnotationsLayer(ctx, renderedOps, {
      backdropImage: backdropElement,
      selectedId: phase === 'editing_text' ? null : selectedOpId,
      scratchCanvas: scratchCanvasRef.current,
      mosaicCache: mosaicCacheRef.current,
      transform: {
        offsetX: 0,
        offsetY: 0,
        scaleX: dpr,
        scaleY: dpr,
        backdropScaleX,
        backdropScaleY
      }
    });
  }, [backdropElement, monitorMeta?.scaleFactor, phase, renderedOps, selectedOpId, viewportSize]);

  const physicalSize = useMemo(() => {
    if (!selection) return null;
    const vw = viewportSize.width;
    const vh = viewportSize.height;
    const imgSize = backdropElement
      ? {
          width: backdropElement.naturalWidth || vw,
          height: backdropElement.naturalHeight || vh
        }
      : {
          width: monitorMeta?.width ?? Math.round(vw * (monitorMeta?.scaleFactor ?? 1)),
          height: monitorMeta?.height ?? Math.round(vh * (monitorMeta?.scaleFactor ?? 1))
        };
    return logicalRectToPhysical(selection, { width: vw, height: vh }, imgSize);
  }, [backdropElement, monitorMeta, selection, viewportSize]);

  const toolbarPosition = useMemo(() => {
    if (!selection) return null;
    const estimatedWidth = targetKind === 'todo_card' ? 545 : 535;
    const estimatedHeight = activeTool === 'select' ? 42 : 76;
    return computeFloatingToolbarPosition(
      selection,
      {
        width: estimatedWidth,
        height: estimatedHeight
      },
      viewportSize
    );
  }, [activeTool, selection, targetKind, viewportSize]);

  const showCrosshair = !selection || phase === 'selecting' || phase === 'resizing';
  const showMagnifier =
    Boolean(backdropElement) &&
    !isCapturing &&
    (phase === 'idle' || phase === 'selecting' || phase === 'resizing');
  const selectionCursorClass =
    isCapturing
      ? 'pointer-events-none'
      : activeTool === 'select'
      ? 'cursor-move'
      : activeTool === 'text'
      ? 'cursor-text'
      : 'cursor-crosshair';

  return (
    <div
      data-testid="snip-overlay-root"
      className={`snip-overlay-root relative h-screen w-screen select-none overflow-hidden bg-slate-950 text-white ${
        selection && activeTool === 'select' ? 'cursor-default' : 'cursor-crosshair'
      }`}
      style={{
        backgroundImage: bgImage ? `url(${bgImage})` : 'none',
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat'
      }}
      onMouseDown={event => {
        handleRootMouseDown({ x: event.clientX, y: event.clientY }, event.button);
      }}
      onContextMenu={event => {
        event.preventDefault();
        if (!isCapturing) {
          cancelSnip();
        }
      }}
    >
      {/* 实时矢量/马赛克标注合成预览层 */}
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      {!selection && <div className="pointer-events-none absolute inset-0 bg-black/45" />}

      {bgError && (
        <div className="pointer-events-none absolute left-1/2 top-24 z-50 w-[460px] max-w-[calc(100vw-48px)] -translate-x-1/2 rounded-xl border border-rose-300/35 bg-rose-950/90 px-4 py-3 text-center text-[12px] font-semibold leading-5 text-rose-50 shadow-2xl backdrop-blur-sm">
          {bgError}
        </div>
      )}

      {showCrosshair && (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-px bg-sky-300/45"
            style={{ left: cursorPoint.x }}
          />
          <div
            className="pointer-events-none absolute inset-x-0 z-10 h-px bg-sky-300/45"
            style={{ top: cursorPoint.y }}
          />
        </>
      )}

      {!selection && phase === 'idle' && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-7 z-20 -translate-x-1/2 rounded-xl border border-white/20 bg-slate-950/85 px-4 py-2.5 text-[12px] font-medium shadow-2xl backdrop-blur-md">
            拖拽鼠标框选区域 | Ctrl+A 全屏 | 右键或 Esc 取消
          </div>

          <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 w-[340px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/18 bg-slate-950/88 px-5 py-4 text-center shadow-2xl backdrop-blur-md">
            <div className="text-sm font-semibold tracking-[0.06em] text-white">
              请点击并拖拽进行框选
            </div>
            <div className="mt-2 text-[12px] leading-5 text-slate-300">
              框选后支持 8 方位缩放、画箭头、框选、打码、文字标注，并一键复制、贴到桌面或另存为文件。
            </div>
          </div>
        </>
      )}

      {selection && (
        <>
          {/* 四象限遮罩置于 live canvas 之上、边框之下，让选区外溢标注自动变暗 */}
          <div
            className="pointer-events-none absolute left-0 right-0 top-0 z-10 bg-black/45"
            style={{ height: selection.y }}
          />
          <div
            className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 bg-black/45"
            style={{ top: selection.y + selection.height }}
          />
          <div
            className="pointer-events-none absolute left-0 z-10 bg-black/45"
            style={{
              top: selection.y,
              height: selection.height,
              width: selection.x
            }}
          />
          <div
            className="pointer-events-none absolute right-0 z-10 bg-black/45"
            style={{
              top: selection.y,
              height: selection.height,
              left: selection.x + selection.width
            }}
          />

          <div
            data-testid="snip-selection-box"
            className={`absolute z-20 border-2 border-sky-400 shadow-[0_0_0_1px_rgba(255,255,255,0.45)] ${selectionCursorClass}`}
            style={{
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height
            }}
            onDoubleClick={() => {
              if (activeTool === 'select' && !isCapturing) {
                void completeSelection(defaultConfirmAction);
              }
            }}
          >
            {/* 选区物理分辨率与逻辑起点读数 */}
            <div
              className="pointer-events-none absolute left-0 flex items-center gap-1.5 rounded bg-slate-950/90 px-2 py-0.5 font-mono text-[11px] font-semibold text-sky-200 border border-white/15 shadow"
              style={{ top: selection.y >= 28 ? -26 : 6, left: selection.y >= 28 ? 0 : 6 }}
            >
              <span>
                {physicalSize ? `${physicalSize.width} × ${physicalSize.height}` : `${Math.round(selection.width)} × ${Math.round(selection.height)}`}
              </span>
              <span className="text-slate-400">px</span>
            </div>

            {/* 8 方位拉伸锚点：拖拽标注工具激活期间亦保留可见，但只在非绘图拖拽时允许触发调整 */}
            {!isDraggingSelection &&
              !isCapturing &&
              HANDLE_DEFINITIONS.map(({ handle, cursor, style: handleStyle }) => (
                <div
                  key={handle}
                  data-testid={`snip-handle-${handle}`}
                  className="absolute z-30 h-2.5 w-2.5 rounded-full border-[1.5px] border-white bg-sky-500 shadow"
                  style={{ ...handleStyle, cursor }}
                  onMouseDown={event => {
                    event.stopPropagation();
                    if (event.button === 0) {
                      beginResizeHandle(handle, { x: event.clientX, y: event.clientY });
                    }
                  }}
                />
              ))}
          </div>

          {!isDraggingSelection && phase !== 'annotating' && phase !== 'moving_annotation' && toolbarPosition && (
            <SnipToolbar
              x={toolbarPosition.x}
              y={toolbarPosition.y}
              activeTool={activeTool}
              style={style}
              canUndo={canUndo(history)}
              canRedo={canRedo(history)}
              hasAnnotations={history.present.length > 0}
              targetKind={targetKind}
              disabled={isCapturing}
              onSelectTool={selectTool}
              onUpdateStyle={updateStyle}
              onUndo={undo}
              onRedo={redo}
              onClearAnnotations={clearAnnotations}
              onAction={action => void completeSelection(action)}
              onCancel={cancelSnip}
            />
          )}
        </>
      )}

      {phase === 'editing_text' && textDraft && (
        <SnipTextEditor
          draft={textDraft}
          color={style.color}
          fontSize={style.fontSize}
          onChange={value =>
            setTextDraft(prev => (prev ? { ...prev, value } : prev))
          }
          onCommit={commitTextDraft}
          onCancel={cancelTextDraft}
        />
      )}

      {backdropElement && (
        <SnipMagnifier
          cursorPoint={cursorPoint}
          backdropElement={backdropElement}
          visible={showMagnifier}
        />
      )}

      {isCapturing && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-black/45 text-[13px] font-bold backdrop-blur-[1px]">
          <div className="rounded-xl border border-white/15 bg-slate-950/90 px-4 py-2.5 shadow-2xl">
            正在合成并导出截图...
          </div>
        </div>
      )}
    </div>
  );
};
