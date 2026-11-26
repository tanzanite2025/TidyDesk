import type { SnipPoint } from '../snipGeometry';
import type {
  AnnotationOp,
  ArrowAnnotationOp,
  EllipseAnnotationOp,
  LineAnnotationOp,
  RectAnnotationOp,
  StepAnnotationOp,
  StrokeAnnotationOp,
  TextAnnotationOp
} from './types';

export interface RenderTransform {
  /** Logical backdrop X offset before scaling (e.g. -selection.x when exporting cropped PNG). */
  offsetX?: number;
  /** Logical backdrop Y offset before scaling (e.g. -selection.y when exporting cropped PNG). */
  offsetY?: number;
  /** X scale from logical backdrop coords to canvas pixels. */
  scaleX?: number;
  /** Y scale from logical backdrop coords to canvas pixels. */
  scaleY?: number;
  /** Physical scale from logical backdrop coords into backdropImage pixel coords. */
  backdropScaleX?: number;
  backdropScaleY?: number;
}

export interface RenderAnnotationsOptions {
  transform?: RenderTransform;
  backdropImage?: HTMLImageElement | null;
  selectedId?: string | null;
  scratchCanvas?: HTMLCanvasElement | null;
  mosaicCache?: Map<number, HTMLCanvasElement>;
}

const DEFAULT_FONT_FAMILY = '"Microsoft YaHei UI", "Segoe UI", system-ui, -apple-system, sans-serif';

function mapPoint(pt: SnipPoint, t: Required<Pick<RenderTransform, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY'>>): SnipPoint {
  return {
    x: (pt.x + t.offsetX) * t.scaleX,
    y: (pt.y + t.offsetY) * t.scaleY
  };
}

function getStrokeScale(t: Required<Pick<RenderTransform, 'scaleX' | 'scaleY'>>): number {
  return (t.scaleX + t.scaleY) / 2;
}

function buildMosaicGridCanvas(
  backdropImage: HTMLImageElement,
  blockSize: number
): HTMLCanvasElement {
  const imgW = Math.max(1, backdropImage.naturalWidth || backdropImage.width);
  const imgH = Math.max(1, backdropImage.naturalHeight || backdropImage.height);
  const effectiveBlock = Math.max(4, Math.round(blockSize));
  const smallW = Math.max(1, Math.ceil(imgW / effectiveBlock));
  const smallH = Math.max(1, Math.ceil(imgH / effectiveBlock));

  const smallCanvas = document.createElement('canvas');
  smallCanvas.width = smallW;
  smallCanvas.height = smallH;
  const smallCtx = smallCanvas.getContext('2d');
  if (smallCtx) {
    smallCtx.imageSmoothingEnabled = true;
    smallCtx.drawImage(backdropImage, 0, 0, smallW, smallH);
  }

  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = imgW;
  gridCanvas.height = imgH;
  const gridCtx = gridCanvas.getContext('2d');
  if (gridCtx) {
    gridCtx.imageSmoothingEnabled = false;
    gridCtx.drawImage(smallCanvas, 0, 0, smallW, smallH, 0, 0, imgW, imgH);
  }
  return gridCanvas;
}

function drawSmoothStrokePath(
  ctx: CanvasRenderingContext2D,
  points: readonly SnipPoint[],
  t: Required<Pick<RenderTransform, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY'>>
): void {
  if (points.length === 0) return;
  const first = mapPoint(points[0], t);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  if (points.length === 1) {
    ctx.lineTo(first.x + 0.01, first.y + 0.01);
    return;
  }
  for (let i = 1; i < points.length - 1; i++) {
    const curr = mapPoint(points[i], t);
    const next = mapPoint(points[i + 1], t);
    const midX = (curr.x + next.x) / 2;
    const midY = (curr.y + next.y) / 2;
    ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
  }
  const last = mapPoint(points[points.length - 1], t);
  ctx.lineTo(last.x, last.y);
}

function drawRectOp(
  ctx: CanvasRenderingContext2D,
  op: RectAnnotationOp,
  t: Required<Pick<RenderTransform, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY'>>
): void {
  const x = (op.x + t.offsetX) * t.scaleX;
  const y = (op.y + t.offsetY) * t.scaleY;
  const w = op.width * t.scaleX;
  const h = op.height * t.scaleY;
  const lineWidth = Math.max(1, op.style.strokeWidth * getStrokeScale(t));
  const r = Math.min((op.cornerRadius ?? 2) * getStrokeScale(t), Math.abs(w) / 2, Math.abs(h) / 2);

  ctx.save();
  ctx.globalAlpha = op.style.opacity;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = op.style.color;
  ctx.fillStyle = op.style.color;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function' && r > 0) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
  if (op.style.filled) {
    ctx.fill();
  } else {
    ctx.stroke();
  }
  ctx.restore();
}

function drawEllipseOp(
  ctx: CanvasRenderingContext2D,
  op: EllipseAnnotationOp,
  t: Required<Pick<RenderTransform, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY'>>
): void {
  const rx = Math.max(0.5, (op.width * t.scaleX) / 2);
  const ry = Math.max(0.5, (op.height * t.scaleY) / 2);
  const cx = (op.x + t.offsetX) * t.scaleX + rx;
  const cy = (op.y + t.offsetY) * t.scaleY + ry;
  const lineWidth = Math.max(1, op.style.strokeWidth * getStrokeScale(t));

  ctx.save();
  ctx.globalAlpha = op.style.opacity;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = op.style.color;
  ctx.fillStyle = op.style.color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  if (op.style.filled) {
    ctx.fill();
  } else {
    ctx.stroke();
  }
  ctx.restore();
}

function drawLineOp(
  ctx: CanvasRenderingContext2D,
  op: LineAnnotationOp,
  t: Required<Pick<RenderTransform, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY'>>
): void {
  const start = mapPoint(op.start, t);
  const end = mapPoint(op.end, t);
  ctx.save();
  ctx.globalAlpha = op.style.opacity;
  ctx.strokeStyle = op.style.color;
  ctx.lineWidth = Math.max(1, op.style.strokeWidth * getStrokeScale(t));
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.restore();
}

function drawSolidArrowOp(
  ctx: CanvasRenderingContext2D,
  op: ArrowAnnotationOp,
  t: Required<Pick<RenderTransform, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY'>>
): void {
  const start = mapPoint(op.start, t);
  const end = mapPoint(op.end, t);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const stroke = Math.max(1, op.style.strokeWidth * getStrokeScale(t));

  ctx.save();
  ctx.globalAlpha = op.style.opacity;
  ctx.fillStyle = op.style.color;

  if (length < 2) {
    ctx.beginPath();
    ctx.arc(start.x, start.y, stroke * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;

  const headLength = Math.max(11 * getStrokeScale(t), Math.min(length * 0.55, stroke * 4.2 + 8));
  const headHalfW = headLength * 0.44;
  const neckHalfW = stroke * 0.52;
  const tailHalfW = Math.max(0.8, stroke * 0.16);
  const neckDist = Math.max(0, length - headLength * 0.78);

  const neckX = start.x + ux * neckDist;
  const neckY = start.y + uy * neckDist;
  const barbX = start.x + ux * (length - headLength);
  const barbY = start.y + uy * (length - headLength);

  ctx.beginPath();
  ctx.moveTo(start.x + px * tailHalfW, start.y + py * tailHalfW);
  ctx.lineTo(neckX + px * neckHalfW, neckY + py * neckHalfW);
  ctx.lineTo(barbX + px * headHalfW, barbY + py * headHalfW);
  ctx.lineTo(end.x, end.y);
  ctx.lineTo(barbX - px * headHalfW, barbY - py * headHalfW);
  ctx.lineTo(neckX - px * neckHalfW, neckY - py * neckHalfW);
  ctx.lineTo(start.x - px * tailHalfW, start.y - py * tailHalfW);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBrushOrHighlighterOp(
  ctx: CanvasRenderingContext2D,
  op: StrokeAnnotationOp,
  t: Required<Pick<RenderTransform, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY'>>
): void {
  const scale = getStrokeScale(t);
  const isHighlighter = op.type === 'highlighter';
  const lineWidth = Math.max(
    1,
    op.style.strokeWidth * scale * (isHighlighter ? 3.4 : 1)
  );

  ctx.save();
  ctx.globalAlpha = isHighlighter ? Math.min(0.42, op.style.opacity * 0.42) : op.style.opacity;
  ctx.strokeStyle = op.style.color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  drawSmoothStrokePath(ctx, op.points, t);
  ctx.stroke();
  ctx.restore();
}

function drawMosaicOp(
  ctx: CanvasRenderingContext2D,
  op: StrokeAnnotationOp,
  t: Required<
    Pick<
      RenderTransform,
      'offsetX' | 'offsetY' | 'scaleX' | 'scaleY' | 'backdropScaleX' | 'backdropScaleY'
    >
  >,
  options: RenderAnnotationsOptions
): void {
  const canvasW = ctx.canvas.width;
  const canvasH = ctx.canvas.height;
  if (canvasW <= 0 || canvasH <= 0) return;

  const scale = getStrokeScale(t);
  const brushWidth = Math.max(10 * scale, op.style.strokeWidth * scale * 4.2);

  if (!options.backdropImage) {
    // Graceful unit-test / fallback stroke if image element isn't loaded yet.
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.lineWidth = brushWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawSmoothStrokePath(ctx, op.points, t);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const blockKey = Math.max(4, Math.round(op.style.mosaicBlockSize * Math.max(1, t.backdropScaleX)));
  let gridCanvas = options.mosaicCache?.get(blockKey);
  if (!gridCanvas) {
    gridCanvas = buildMosaicGridCanvas(options.backdropImage, blockKey);
    options.mosaicCache?.set(blockKey, gridCanvas);
  }

  const scratch = options.scratchCanvas ?? document.createElement('canvas');
  if (scratch.width !== canvasW || scratch.height !== canvasH) {
    scratch.width = canvasW;
    scratch.height = canvasH;
  }
  const sCtx = scratch.getContext('2d');
  if (!sCtx) return;

  sCtx.save();
  sCtx.setTransform(1, 0, 0, 1, 0, 0);
  sCtx.clearRect(0, 0, canvasW, canvasH);
  sCtx.globalCompositeOperation = 'source-over';
  sCtx.strokeStyle = '#000000';
  sCtx.lineWidth = brushWidth;
  sCtx.lineCap = 'round';
  sCtx.lineJoin = 'round';
  drawSmoothStrokePath(sCtx, op.points, t);
  sCtx.stroke();

  sCtx.globalCompositeOperation = 'source-in';
  sCtx.imageSmoothingEnabled = false;
  // Source crop in physical backdrop coords matching rendered canvas viewport slice:
  // canvas px (0..canvasW) corresponds to logical (-offsetX .. -offsetX + canvasW/scaleX)
  const sx = Math.max(0, -t.offsetX * t.backdropScaleX);
  const sy = Math.max(0, -t.offsetY * t.backdropScaleY);
  const sw = Math.min(gridCanvas.width - sx, (canvasW / t.scaleX) * t.backdropScaleX);
  const sh = Math.min(gridCanvas.height - sy, (canvasH / t.scaleY) * t.backdropScaleY);
  if (sw > 0 && sh > 0) {
    sCtx.drawImage(gridCanvas, sx, sy, sw, sh, 0, 0, canvasW, canvasH);
  }
  sCtx.restore();

  ctx.save();
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

function drawTextOp(
  ctx: CanvasRenderingContext2D,
  op: TextAnnotationOp,
  t: Required<Pick<RenderTransform, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY'>>
): void {
  if (!op.text.trim()) return;
  const pos = mapPoint(op.position, t);
  const scale = getStrokeScale(t);
  const fontSize = Math.max(10, Math.round(op.style.fontSize * scale));
  const lineHeight = fontSize * 1.28;
  const isDarkInk = op.style.color.toLowerCase() === '#0f172a';

  ctx.save();
  ctx.globalAlpha = op.style.opacity;
  ctx.font = `700 ${fontSize}px ${DEFAULT_FONT_FAMILY}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = op.style.color;
  ctx.shadowColor = isDarkInk ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.65)';
  ctx.shadowBlur = 3 * scale;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1 * scale;

  const lines = op.text.split('\n');
  lines.forEach((line, index) => {
    ctx.fillText(line, pos.x, pos.y + index * lineHeight);
  });
  ctx.restore();
}

function drawStepOp(
  ctx: CanvasRenderingContext2D,
  op: StepAnnotationOp,
  t: Required<Pick<RenderTransform, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY'>>
): void {
  const pos = mapPoint(op.position, t);
  const scale = getStrokeScale(t);
  const radius = Math.max(10 * scale, op.radius * scale);
  const colorLower = op.style.color.toLowerCase();
  const useDarkText = colorLower === '#ffffff' || colorLower === '#eab308';

  ctx.save();
  ctx.globalAlpha = op.style.opacity;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 4 * scale;
  ctx.fillStyle = op.style.color;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1.2, 1.8 * scale);
  ctx.strokeStyle = useDarkText ? 'rgba(15, 23, 42, 0.7)' : 'rgba(255, 255, 255, 0.92)';
  ctx.stroke();

  ctx.fillStyle = useDarkText ? '#0f172a' : '#ffffff';
  ctx.font = `800 ${Math.round(radius * 1.15)}px ${DEFAULT_FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(op.number), pos.x, pos.y + 0.5 * scale);
  ctx.restore();
}

function drawSelectionOutline(
  ctx: CanvasRenderingContext2D,
  op: AnnotationOp,
  t: Required<Pick<RenderTransform, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY'>>
): void {
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;

  switch (op.type) {
    case 'rect':
    case 'ellipse':
      minX = (op.x + t.offsetX) * t.scaleX;
      minY = (op.y + t.offsetY) * t.scaleY;
      maxX = minX + op.width * t.scaleX;
      maxY = minY + op.height * t.scaleY;
      break;
    case 'arrow':
    case 'line': {
      const a = mapPoint(op.start, t);
      const b = mapPoint(op.end, t);
      minX = Math.min(a.x, b.x);
      minY = Math.min(a.y, b.y);
      maxX = Math.max(a.x, b.x);
      maxY = Math.max(a.y, b.y);
      break;
    }
    case 'brush':
    case 'highlighter':
    case 'mosaic': {
      if (op.points.length === 0) return;
      const mapped = op.points.map(p => mapPoint(p, t));
      minX = Math.min(...mapped.map(p => p.x));
      minY = Math.min(...mapped.map(p => p.y));
      maxX = Math.max(...mapped.map(p => p.x));
      maxY = Math.max(...mapped.map(p => p.y));
      break;
    }
    case 'text': {
      const pos = mapPoint(op.position, t);
      const scale = getStrokeScale(t);
      const lines = op.text.split('\n');
      const maxChars = Math.max(1, ...lines.map(l => l.length));
      minX = pos.x;
      minY = pos.y;
      maxX = pos.x + Math.max(24, maxChars * op.style.fontSize * 0.72 * scale);
      maxY = pos.y + Math.max(op.style.fontSize * 1.4, lines.length * op.style.fontSize * 1.28) * scale;
      break;
    }
    case 'step': {
      const pos = mapPoint(op.position, t);
      const r = op.radius * getStrokeScale(t);
      minX = pos.x - r;
      minY = pos.y - r;
      maxX = pos.x + r;
      maxY = pos.y + r;
      break;
    }
  }

  const pad = 6 * getStrokeScale(t);
  ctx.save();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = Math.max(1, 1.5 * getStrokeScale(t));
  ctx.setLineDash([4 * getStrokeScale(t), 3 * getStrokeScale(t)]);
  ctx.strokeRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
  ctx.restore();
}

/** Render an ordered list of annotation operations onto any 2D Canvas context. */
export function renderAnnotationsLayer(
  ctx: CanvasRenderingContext2D,
  ops: readonly AnnotationOp[],
  options: RenderAnnotationsOptions = {}
): void {
  const scaleX = options.transform?.scaleX ?? 1;
  const scaleY = options.transform?.scaleY ?? 1;
  const t = {
    offsetX: options.transform?.offsetX ?? 0,
    offsetY: options.transform?.offsetY ?? 0,
    scaleX,
    scaleY,
    backdropScaleX: options.transform?.backdropScaleX ?? scaleX,
    backdropScaleY: options.transform?.backdropScaleY ?? scaleY
  };

  for (const op of ops) {
    switch (op.type) {
      case 'rect':
        drawRectOp(ctx, op, t);
        break;
      case 'ellipse':
        drawEllipseOp(ctx, op, t);
        break;
      case 'line':
        drawLineOp(ctx, op, t);
        break;
      case 'arrow':
        drawSolidArrowOp(ctx, op, t);
        break;
      case 'brush':
      case 'highlighter':
        drawBrushOrHighlighterOp(ctx, op, t);
        break;
      case 'mosaic':
        drawMosaicOp(ctx, op, t, options);
        break;
      case 'text':
        drawTextOp(ctx, op, t);
        break;
      case 'step':
        drawStepOp(ctx, op, t);
        break;
    }

    if (options.selectedId && op.id === options.selectedId) {
      drawSelectionOutline(ctx, op, t);
    }
  }
}
