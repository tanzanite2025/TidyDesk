export type SnipPoint = { x: number; y: number };
export type SnipRect = { x: number; y: number; width: number; height: number };

/** Return center coordinate of the current snip viewport. */
export function centerPoint(): SnipPoint {
  return {
    x: Math.round(window.innerWidth / 2),
    y: Math.round(window.innerHeight / 2)
  };
}

/** Build a normalized rectangle from two corner coordinates. */
export function rectFromPoints(start: SnipPoint, end: SnipPoint): SnipRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  return { x, y, width, height };
}

/** Convert a rectangle back to top-left and bottom-right points. */
export function pointsFromRect(rect: SnipRect): { start: SnipPoint; end: SnipPoint } {
  return {
    start: { x: rect.x, y: rect.y },
    end: { x: rect.x + rect.width, y: rect.y + rect.height }
  };
}

/** Return the full current viewport bounds as a selection rectangle. */
export function viewportRect(): SnipRect {
  return {
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight
  };
}

/** Clamp a rectangle so it never overflows the current viewport bounds. */
export function clampRectToViewport(rect: SnipRect): SnipRect {
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
