import React, { useEffect, useRef, useState } from 'react';
import type { SnipPoint } from '../snipGeometry';

interface SnipMagnifierProps {
  cursorPoint: SnipPoint;
  backdropElement: HTMLImageElement;
  visible: boolean;
}

const SAMPLE_COLS = 15;
const SAMPLE_ROWS = 11;
const PIXEL_SCALE = 8;

/** Real-time pixel loupe showing zoomed backdrop pixels and coordinate telemetry. */
export const SnipMagnifier: React.FC<SnipMagnifierProps> = ({
  cursorPoint,
  backdropElement,
  visible
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hexColor, setHexColor] = useState('#000000');

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    const imgW = Math.max(1, backdropElement.naturalWidth || vw);
    const imgH = Math.max(1, backdropElement.naturalHeight || vh);
    const scaleX = imgW / vw;
    const scaleY = imgH / vh;
    const physX = Math.max(0, Math.min(imgW - 1, Math.round(cursorPoint.x * scaleX)));
    const physY = Math.max(0, Math.min(imgH - 1, Math.round(cursorPoint.y * scaleY)));

    const halfW = Math.floor(SAMPLE_COLS / 2);
    const halfH = Math.floor(SAMPLE_ROWS / 2);
    const desiredSx = physX - halfW;
    const desiredSy = physY - halfH;
    const desiredEndX = desiredSx + SAMPLE_COLS;
    const desiredEndY = desiredSy + SAMPLE_ROWS;

    // Clip source bounds explicitly inside image dimensions so edge pixels never shift/compress under crosshair.
    const clipSx = Math.max(0, desiredSx);
    const clipSy = Math.max(0, desiredSy);
    const clipEndX = Math.min(imgW, desiredEndX);
    const clipEndY = Math.min(imgH, desiredEndY);
    const clipSw = Math.max(0, clipEndX - clipSx);
    const clipSh = Math.max(0, clipEndY - clipSy);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    if (clipSw > 0 && clipSh > 0) {
      const destX = (clipSx - desiredSx) * PIXEL_SCALE;
      const destY = (clipSy - desiredSy) * PIXEL_SCALE;
      ctx.drawImage(
        backdropElement,
        clipSx,
        clipSy,
        clipSw,
        clipSh,
        destX,
        destY,
        clipSw * PIXEL_SCALE,
        clipSh * PIXEL_SCALE
      );
    }

    if (!sampleCanvasRef.current) {
      sampleCanvasRef.current = document.createElement('canvas');
      sampleCanvasRef.current.width = 1;
      sampleCanvasRef.current.height = 1;
    }
    const sampleCtx = sampleCanvasRef.current.getContext('2d', { willReadFrequently: true });
    if (sampleCtx) {
      sampleCtx.clearRect(0, 0, 1, 1);
      sampleCtx.drawImage(backdropElement, physX, physY, 1, 1, 0, 0, 1, 1);
      const data = sampleCtx.getImageData(0, 0, 1, 1).data;
      const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
      setHexColor(`#${toHex(data[0])}${toHex(data[1])}${toHex(data[2])}`);
    }
  }, [backdropElement, cursorPoint.x, cursorPoint.y, visible]);

  if (!visible) return null;

  const boxW = SAMPLE_COLS * PIXEL_SCALE;
  const boxH = SAMPLE_ROWS * PIXEL_SCALE;
  const totalH = boxH + 40;
  const offset = 18;
  const left =
    cursorPoint.x + offset + boxW + 12 > window.innerWidth
      ? Math.max(8, cursorPoint.x - boxW - offset)
      : cursorPoint.x + offset;
  const top =
    cursorPoint.y + offset + totalH > window.innerHeight
      ? Math.max(8, cursorPoint.y - totalH - offset)
      : cursorPoint.y + offset;

  return (
    <div
      className="pointer-events-none fixed z-40 overflow-hidden rounded-lg border border-white/25 bg-slate-950/92 shadow-2xl"
      style={{ left, top, width: boxW }}
    >
      <div className="relative" style={{ width: boxW, height: boxH }}>
        <canvas ref={canvasRef} width={boxW} height={boxH} className="block h-full w-full" />
        {/* 中心像素准星 */}
        <div
          className="pointer-events-none absolute border border-sky-400 shadow-[0_0_0_1px_rgba(255,255,255,0.75)]"
          style={{
            left: Math.floor(SAMPLE_COLS / 2) * PIXEL_SCALE,
            top: Math.floor(SAMPLE_ROWS / 2) * PIXEL_SCALE,
            width: PIXEL_SCALE,
            height: PIXEL_SCALE
          }}
        />
      </div>
      <div className="border-t border-white/10 px-2 py-1 font-mono text-[10px] leading-tight text-slate-200">
        <div className="flex items-center justify-between">
          <span>
            {Math.round(cursorPoint.x)}, {Math.round(cursorPoint.y)}
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm border border-white/40"
              style={{ backgroundColor: hexColor }}
            />
            {hexColor}
          </span>
        </div>
      </div>
    </div>
  );
};
