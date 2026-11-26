import { describe, expect, it, vi } from 'vitest';
import { uint8ArrayToBase64 } from './annotations/compositor';
import {
  clearAnnotationHistory,
  commitAnnotationOp,
  createEmptyHistory,
  findTopmostAnnotationAtPoint,
  hitTestAnnotationOp,
  nextStepNumber,
  redoAnnotationHistory,
  replaceAnnotationOps,
  translateAnnotationOp,
  undoAnnotationHistory
} from './annotations/history';
import { renderAnnotationsLayer } from './annotations/renderer';
import { DEFAULT_ANNOTATION_STYLE, type AnnotationOp } from './annotations/types';
import {
  computeFloatingToolbarPosition,
  logicalRectToPhysical,
  moveRectWithinViewport,
  resizeRectByHandle,
  snapAnglePoint,
  snapSquarePoint
} from './snipGeometry';

describe('snipGeometry selection & HiDPI transforms', () => {
  const viewport = { width: 1280, height: 720 };

  it('resizes selection from all compass handles while clamping to viewport and min size', () => {
    const origin = { x: 100, y: 100, width: 200, height: 150 };

    const grownNW = resizeRectByHandle(origin, 'nw', { x: -150, y: -20 }, viewport);
    expect(grownNW).toEqual({ x: 0, y: 80, width: 300, height: 170 });

    const shrunkMinSE = resizeRectByHandle(origin, 'se', { x: -300, y: -300 }, viewport);
    expect(shrunkMinSE).toEqual({ x: 100, y: 100, width: 8, height: 8 });

    const movedRight = resizeRectByHandle(origin, 'e', { x: 2000, y: 0 }, viewport);
    expect(movedRight).toEqual({ x: 100, y: 100, width: 1180, height: 150 });
  });

  it('moves selection smoothly inside viewport bounds without changing dimensions', () => {
    const origin = { x: 50, y: 60, width: 200, height: 100 };
    const clampedTopLeft = moveRectWithinViewport(origin, { x: -200, y: -200 }, viewport);
    expect(clampedTopLeft).toEqual({ x: 0, y: 0, width: 200, height: 100 });

    const clampedBottomRight = moveRectWithinViewport(origin, { x: 2000, y: 2000 }, viewport);
    expect(clampedBottomRight).toEqual({ x: 1080, y: 620, width: 200, height: 100 });
  });

  it('snaps shift angles and square boxes accurately', () => {
    const snappedHorizontal = snapAnglePoint({ x: 10, y: 10 }, { x: 110, y: 18 });
    expect(Math.round(snappedHorizontal.y)).toBe(10);
    expect(snappedHorizontal.x).toBeGreaterThan(105);

    const square = snapSquarePoint({ x: 50, y: 50 }, { x: 120, y: 80 });
    expect(square).toEqual({ x: 120, y: 120 });
  });

  it('flips floating toolbar above or inside selection near viewport edges', () => {
    const normal = computeFloatingToolbarPosition(
      { x: 300, y: 200, width: 400, height: 200 },
      { width: 480, height: 70 },
      viewport
    );
    expect(normal.placement).toBe('below');

    const nearBottom = computeFloatingToolbarPosition(
      { x: 300, y: 450, width: 400, height: 250 },
      { width: 480, height: 70 },
      viewport
    );
    expect(nearBottom.placement).toBe('above');

    const fullScreen = computeFloatingToolbarPosition(
      { x: 0, y: 0, width: 1280, height: 720 },
      { width: 480, height: 70 },
      viewport
    );
    expect(fullScreen.placement).toBe('inside');
  });

  it('maps logical viewport rects into exact clamped HiDPI physical image pixels', () => {
    const physical = logicalRectToPhysical(
      { x: 100, y: 50, width: 300, height: 200 },
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 }
    );
    expect(physical).toEqual({
      x: 150,
      y: 75,
      width: 450,
      height: 300,
      scaleX: 1.5,
      scaleY: 1.5
    });
  });
});

describe('annotations history, hit-testing & renderer', () => {
  it('supports undo, redo, clear, and sequential step numbering immutably', () => {
    let history = createEmptyHistory();
    const arrow: AnnotationOp = {
      id: 'a1',
      type: 'arrow',
      start: { x: 10, y: 10 },
      end: { x: 110, y: 110 },
      style: DEFAULT_ANNOTATION_STYLE
    };
    const step1: AnnotationOp = {
      id: 's1',
      type: 'step',
      position: { x: 200, y: 200 },
      number: nextStepNumber(history.present),
      radius: 14,
      style: DEFAULT_ANNOTATION_STYLE
    };

    history = commitAnnotationOp(history, arrow);
    history = commitAnnotationOp(history, step1);
    expect(history.present).toHaveLength(2);
    expect(nextStepNumber(history.present)).toBe(2);

    history = undoAnnotationHistory(history);
    expect(history.present).toHaveLength(1);
    expect(history.future).toHaveLength(1);

    history = redoAnnotationHistory(history);
    expect(history.present).toHaveLength(2);

    history = clearAnnotationHistory(history);
    expect(history.present).toHaveLength(0);

    history = undoAnnotationHistory(history);
    expect(history.present).toHaveLength(2);

    const moved = translateAnnotationOp(arrow, 20, -5);
    history = replaceAnnotationOps(history, [moved, step1]);
    expect((history.present[0] as typeof arrow).start).toEqual({ x: 30, y: 5 });
  });

  it('hit-tests topmost vector shapes accurately', () => {
    const rect: AnnotationOp = {
      id: 'r1',
      type: 'rect',
      x: 50,
      y: 50,
      width: 100,
      height: 80,
      style: DEFAULT_ANNOTATION_STYLE
    };
    const step: AnnotationOp = {
      id: 'st1',
      type: 'step',
      position: { x: 50, y: 50 },
      number: 1,
      radius: 14,
      style: DEFAULT_ANNOTATION_STYLE
    };

    expect(hitTestAnnotationOp(rect, { x: 50, y: 90 })).toBe(true);
    expect(hitTestAnnotationOp(rect, { x: 100, y: 90 })).toBe(false);
    expect(findTopmostAnnotationAtPoint([rect, step], { x: 50, y: 50 })?.id).toBe('st1');
  });

  it('renders solid arrows, boxes, ellipses, strokes, text, and step badges onto 2D context', () => {
    const ctx = {
      canvas: { width: 800, height: 600 },
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      roundRect: vi.fn(),
      rect: vi.fn(),
      ellipse: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      strokeRect: vi.fn(),
      setLineDash: vi.fn()
    } as unknown as CanvasRenderingContext2D;

    const ops: AnnotationOp[] = [
      { id: 'r1', type: 'rect', x: 10, y: 10, width: 80, height: 60, style: DEFAULT_ANNOTATION_STYLE },
      { id: 'e1', type: 'ellipse', x: 100, y: 10, width: 80, height: 60, style: DEFAULT_ANNOTATION_STYLE },
      { id: 'a1', type: 'arrow', start: { x: 20, y: 100 }, end: { x: 140, y: 180 }, style: DEFAULT_ANNOTATION_STYLE },
      { id: 'b1', type: 'brush', points: [{ x: 10, y: 200 }, { x: 40, y: 220 }], style: DEFAULT_ANNOTATION_STYLE },
      { id: 'h1', type: 'highlighter', points: [{ x: 50, y: 200 }, { x: 90, y: 200 }], style: DEFAULT_ANNOTATION_STYLE },
      { id: 'm1', type: 'mosaic', points: [{ x: 10, y: 250 }, { x: 60, y: 250 }], style: DEFAULT_ANNOTATION_STYLE },
      { id: 't1', type: 'text', position: { x: 200, y: 200 }, text: '测试标注', style: DEFAULT_ANNOTATION_STYLE },
      { id: 's1', type: 'step', position: { x: 240, y: 240 }, number: 1, radius: 14, style: DEFAULT_ANNOTATION_STYLE }
    ];

    renderAnnotationsLayer(ctx, ops, { selectedId: 'a1' });
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect((ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    expect((ctx.strokeRect as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('encodes multi-chunk binary PNG payloads cleanly to standard base64', () => {
    const sample = new Uint8Array(70_000);
    for (let i = 0; i < sample.length; i++) {
      sample[i] = (i * 31) & 0xff;
    }
    const encoded = uint8ArrayToBase64(sample);
    const decoded = Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0));
    expect(decoded.length).toBe(sample.length);
    expect(decoded[0]).toBe(sample[0]);
    expect(decoded[69_999]).toBe(sample[69_999]);
  });
});
