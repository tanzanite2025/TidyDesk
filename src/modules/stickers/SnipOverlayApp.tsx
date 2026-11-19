import React from 'react';
import { useSnipSelection } from './useSnipSelection';

export const SnipOverlayApp: React.FC = () => {
  const {
    bgImage,
    bgError,
    cursorPoint,
    selection,
    isDragging,
    isCapturing,
    hasStartPoint,
    cancelSnip,
    completeSelection,
    schedulePointerUpdate,
    beginDrag,
    finishDrag
  } = useSnipSelection();

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
        beginDrag({ x: event.clientX, y: event.clientY });
      }}
      onMouseMove={event => {
        schedulePointerUpdate(
          { x: event.clientX, y: event.clientY },
          Boolean(hasStartPoint && isDragging && !isCapturing)
        );
      }}
      onMouseUp={event => {
        finishDrag({ x: event.clientX, y: event.clientY });
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

      <div className="pointer-events-none absolute left-1/2 top-7 -translate-x-1/2 rounded-xl border border-white/20 bg-black/80 px-4 py-3 text-[12px] font-medium shadow-2xl">
        {selection
          ? 'Enter/空格 确认 | 方向键 微调 | Shift+方向键 快速微调 | Esc 取消'
          : '拖拽鼠标框选 | Ctrl + A 全屏截图 | 右键/Esc 取消'}
      </div>

      {!selection && !isDragging && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/18 bg-slate-950/85 px-5 py-4 text-center shadow-2xl">
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
          {/* 使用四块纯色遮罩替代超大 9999px box-shadow，避免拖拽时每帧全屏重绘光栅化 */}
          <div
            className="pointer-events-none absolute left-0 right-0 top-0 bg-black/40"
            style={{ height: selection.y }}
          />
          <div
            className="pointer-events-none absolute bottom-0 left-0 right-0 bg-black/40"
            style={{ top: selection.y + selection.height }}
          />
          <div
            className="pointer-events-none absolute left-0 bg-black/40"
            style={{
              top: selection.y,
              height: selection.height,
              width: selection.x
            }}
          />
          <div
            className="pointer-events-none absolute right-0 bg-black/40"
            style={{
              top: selection.y,
              height: selection.height,
              left: selection.x + selection.width
            }}
          />
          <div
            className={`absolute border border-sky-400 ${isCapturing ? 'pointer-events-none' : 'cursor-move'}`}
            style={{
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height
            }}
            onDoubleClick={() => void completeSelection(selection)}
          >
            <div className="pointer-events-none absolute -top-7 left-0 rounded bg-sky-200 px-2 py-1 text-[11px] font-bold text-slate-950">
              {Math.round(selection.width)} x {Math.round(selection.height)} | {Math.round(selection.x)},{' '}
              {Math.round(selection.y)}
            </div>

            {!isDragging && (
              <div
                className="absolute -bottom-10 right-0 flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/95 p-1 shadow-xl"
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
                  onClick={() => void completeSelection(selection)}
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
