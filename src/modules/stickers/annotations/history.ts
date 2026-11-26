import type { SnipPoint } from '../snipGeometry';
import type { AnnotationOp } from './types';

const MAX_HISTORY_STEPS = 100;

export interface AnnotationHistoryState {
  past: AnnotationOp[][];
  present: AnnotationOp[];
  future: AnnotationOp[][];
}

export function createEmptyHistory(): AnnotationHistoryState {
  return {
    past: [],
    present: [],
    future: []
  };
}

export function canUndo(state: AnnotationHistoryState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: AnnotationHistoryState): boolean {
  return state.future.length > 0;
}

function pushSnapshot(
  state: AnnotationHistoryState,
  nextPresent: AnnotationOp[]
): AnnotationHistoryState {
  const nextPast = [...state.past, state.present].slice(-MAX_HISTORY_STEPS);
  return {
    past: nextPast,
    present: nextPresent,
    future: []
  };
}

/** Append a committed annotation operation as an undoable history entry. */
export function commitAnnotationOp(
  state: AnnotationHistoryState,
  op: AnnotationOp
): AnnotationHistoryState {
  return pushSnapshot(state, [...state.present, op]);
}

/** Replace the full active annotation list atomically (used for move/delete/clear). */
export function replaceAnnotationOps(
  state: AnnotationHistoryState,
  nextOps: AnnotationOp[]
): AnnotationHistoryState {
  return pushSnapshot(state, nextOps);
}

/** Clear all annotations as an undoable operation; no-op when already empty. */
export function clearAnnotationHistory(
  state: AnnotationHistoryState
): AnnotationHistoryState {
  if (state.present.length === 0) return state;
  return pushSnapshot(state, []);
}

export function undoAnnotationHistory(
  state: AnnotationHistoryState
): AnnotationHistoryState {
  if (state.past.length === 0) return state;
  const previous = state.past[state.past.length - 1];
  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future]
  };
}

export function redoAnnotationHistory(
  state: AnnotationHistoryState
): AnnotationHistoryState {
  if (state.future.length === 0) return state;
  const [next, ...rest] = state.future;
  return {
    past: [...state.past, state.present].slice(-MAX_HISTORY_STEPS),
    present: next,
    future: rest
  };
}

/** Compute next sequential badge counter (1, 2, 3...) based on existing step ops. */
export function nextStepNumber(ops: readonly AnnotationOp[]): number {
  let maxStep = 0;
  for (const op of ops) {
    if (op.type === 'step' && op.number > maxStep) {
      maxStep = op.number;
    }
  }
  return maxStep + 1;
}

/** Translate any annotation operation uniformly in Backdrop coordinates. */
export function translateAnnotationOp(op: AnnotationOp, dx: number, dy: number): AnnotationOp {
  switch (op.type) {
    case 'rect':
    case 'ellipse':
      return { ...op, x: op.x + dx, y: op.y + dy };
    case 'arrow':
    case 'line':
      return {
        ...op,
        start: { x: op.start.x + dx, y: op.start.y + dy },
        end: { x: op.end.x + dx, y: op.end.y + dy }
      };
    case 'brush':
    case 'highlighter':
    case 'mosaic':
      return {
        ...op,
        points: op.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy }))
      };
    case 'text':
    case 'step':
      return {
        ...op,
        position: { x: op.position.x + dx, y: op.position.y + dy }
      };
  }
}

function distanceToSegment(p: SnipPoint, a: SnipPoint, b: SnipPoint): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** Hit-test an annotation op from topmost order for selection/drag/delete support. */
export function hitTestAnnotationOp(op: AnnotationOp, point: SnipPoint, tolerance = 8): boolean {
  const strokeTol = Math.max(tolerance, op.style.strokeWidth + 4);
  switch (op.type) {
    case 'rect': {
      if (op.style.filled) {
        return (
          point.x >= op.x - tolerance &&
          point.x <= op.x + op.width + tolerance &&
          point.y >= op.y - tolerance &&
          point.y <= op.y + op.height + tolerance
        );
      }
      const nearTop = distanceToSegment(point, { x: op.x, y: op.y }, { x: op.x + op.width, y: op.y }) <= strokeTol;
      const nearBottom =
        distanceToSegment(
          point,
          { x: op.x, y: op.y + op.height },
          { x: op.x + op.width, y: op.y + op.height }
        ) <= strokeTol;
      const nearLeft = distanceToSegment(point, { x: op.x, y: op.y }, { x: op.x, y: op.y + op.height }) <= strokeTol;
      const nearRight =
        distanceToSegment(
          point,
          { x: op.x + op.width, y: op.y },
          { x: op.x + op.width, y: op.y + op.height }
        ) <= strokeTol;
      return nearTop || nearBottom || nearLeft || nearRight;
    }
    case 'ellipse': {
      const rx = Math.max(1, op.width / 2);
      const ry = Math.max(1, op.height / 2);
      const cx = op.x + rx;
      const cy = op.y + ry;
      const normDist = Math.hypot((point.x - cx) / rx, (point.y - cy) / ry);
      if (op.style.filled) {
        return normDist <= 1 + strokeTol / Math.min(rx, ry);
      }
      const rimDistancePx = Math.abs(normDist - 1) * Math.min(rx, ry);
      return rimDistancePx <= strokeTol;
    }
    case 'arrow':
    case 'line':
      return distanceToSegment(point, op.start, op.end) <= strokeTol + 4;
    case 'brush':
    case 'highlighter':
    case 'mosaic': {
      const pts = op.points;
      if (pts.length === 0) return false;
      if (pts.length === 1) {
        return Math.hypot(point.x - pts[0].x, point.y - pts[0].y) <= strokeTol;
      }
      for (let i = 1; i < pts.length; i++) {
        if (distanceToSegment(point, pts[i - 1], pts[i]) <= strokeTol + 3) {
          return true;
        }
      }
      return false;
    }
    case 'text': {
      const lines = op.text.split('\n');
      const maxChars = Math.max(1, ...lines.map(l => l.length));
      const approxW = Math.max(24, maxChars * op.style.fontSize * 0.72);
      const approxH = Math.max(op.style.fontSize * 1.4, lines.length * op.style.fontSize * 1.3);
      return (
        point.x >= op.position.x - tolerance &&
        point.x <= op.position.x + approxW + tolerance &&
        point.y >= op.position.y - tolerance &&
        point.y <= op.position.y + approxH + tolerance
      );
    }
    case 'step': {
      return Math.hypot(point.x - op.position.x, point.y - op.position.y) <= op.radius + tolerance;
    }
  }
}

/** Find topmost annotation id at the given backdrop coordinate. */
export function findTopmostAnnotationAtPoint(
  ops: readonly AnnotationOp[],
  point: SnipPoint
): AnnotationOp | null {
  for (let i = ops.length - 1; i >= 0; i--) {
    if (hitTestAnnotationOp(ops[i], point)) {
      return ops[i];
    }
  }
  return null;
}
