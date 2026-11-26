export type SnipPoint = { x: number; y: number };
export type SnipRect = { x: number; y: number; width: number; height: number };
export type SnipViewportSize = { width: number; height: number };

export type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export const MIN_SNIP_SIZE = 8;

function resolveViewport(viewport?: SnipViewportSize): SnipViewportSize {
  if (viewport) return viewport;
  if (typeof window === 'undefined') {
    return { width: 1920, height: 1080 };
  }
  return {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight)
  };
}

/** Return center coordinate of the current snip viewport. */
export function centerPoint(viewport?: SnipViewportSize): SnipPoint {
  const bounds = resolveViewport(viewport);
  return {
    x: Math.round(bounds.width / 2),
    y: Math.round(bounds.height / 2)
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
export function viewportRect(viewport?: SnipViewportSize): SnipRect {
  const bounds = resolveViewport(viewport);
  return {
    x: 0,
    y: 0,
    width: bounds.width,
    height: bounds.height
  };
}

/** Clamp a rectangle so it never overflows the current viewport bounds. */
export function clampRectToViewport(rect: SnipRect, viewport?: SnipViewportSize): SnipRect {
  const bounds = resolveViewport(viewport);
  const width = Math.max(0, Math.min(rect.width, bounds.width));
  const height = Math.max(0, Math.min(rect.height, bounds.height));
  const maxX = Math.max(0, bounds.width - width);
  const maxY = Math.max(0, bounds.height - height);

  return {
    x: Math.max(0, Math.min(rect.x, maxX)),
    y: Math.max(0, Math.min(rect.y, maxY)),
    width,
    height
  };
}

/** Translate a selection rectangle cleanly while keeping size fixed inside viewport bounds. */
export function moveRectWithinViewport(
  origin: SnipRect,
  delta: SnipPoint,
  viewport?: SnipViewportSize
): SnipRect {
  return clampRectToViewport(
    {
      x: origin.x + delta.x,
      y: origin.y + delta.y,
      width: origin.width,
      height: origin.height
    },
    viewport
  );
}

/**
 * Resize an existing selection rectangle from any of the 8 compass handles,
 * honoring minimum dimensions and clamping cleanly within viewport bounds.
 */
export function resizeRectByHandle(
  origin: SnipRect,
  handle: ResizeHandle,
  delta: SnipPoint,
  viewport?: SnipViewportSize,
  minSize: number = MIN_SNIP_SIZE
): SnipRect {
  const bounds = resolveViewport(viewport);
  const effectiveMin = Math.max(1, Math.min(minSize, bounds.width, bounds.height));

  let left = origin.x;
  let top = origin.y;
  let right = origin.x + origin.width;
  let bottom = origin.y + origin.height;

  if (handle.includes('w')) {
    const nextLeft = Math.max(0, Math.min(right - effectiveMin, origin.x + delta.x));
    left = nextLeft;
  }
  if (handle.includes('e')) {
    const nextRight = Math.min(bounds.width, Math.max(left + effectiveMin, right + delta.x));
    right = nextRight;
  }
  if (handle.includes('n')) {
    const nextTop = Math.max(0, Math.min(bottom - effectiveMin, origin.y + delta.y));
    top = nextTop;
  }
  if (handle.includes('s')) {
    const nextBottom = Math.min(bounds.height, Math.max(top + effectiveMin, bottom + delta.y));
    bottom = nextBottom;
  }

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(effectiveMin, Math.round(right - left)),
    height: Math.max(effectiveMin, Math.round(bottom - top))
  };
}

/** Check whether a point falls inside a rectangle with optional tolerance padding. */
export function pointInRect(point: SnipPoint, rect: SnipRect, padding = 0): boolean {
  return (
    point.x >= rect.x - padding &&
    point.x <= rect.x + rect.width + padding &&
    point.y >= rect.y - padding &&
    point.y <= rect.y + rect.height + padding
  );
}

/** Snap an endpoint relative to start to 0/45/90 deg when Shift modifier is pressed. */
export function snapAnglePoint(start: SnipPoint, end: SnipPoint): SnipPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-3) return end;
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: start.x + Math.cos(snapped) * dist,
    y: start.y + Math.sin(snapped) * dist
  };
}

/** Snap box endpoint to square bounds when Shift modifier is pressed. */
export function snapSquarePoint(start: SnipPoint, end: SnipPoint): SnipPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + (dx >= 0 ? size : -size),
    y: start.y + (dy >= 0 ? size : -size)
  };
}

/**
 * Compute optimal floating toolbar top-left position anchored to the selection rectangle
 * without clipping outside the viewport.
 */
export function computeFloatingToolbarPosition(
  selection: SnipRect,
  toolbarSize: SnipViewportSize,
  viewport?: SnipViewportSize,
  gap = 10
): { x: number; y: number; placement: 'below' | 'above' | 'inside' } {
  const bounds = resolveViewport(viewport);
  const edgeMargin = 8;

  const preferredX = selection.x + selection.width - toolbarSize.width;
  const x = Math.max(
    edgeMargin,
    Math.min(preferredX, Math.max(edgeMargin, bounds.width - toolbarSize.width - edgeMargin))
  );

  const belowY = selection.y + selection.height + gap;
  if (belowY + toolbarSize.height <= bounds.height - edgeMargin) {
    return { x, y: belowY, placement: 'below' };
  }

  const aboveY = selection.y - toolbarSize.height - gap;
  if (aboveY >= edgeMargin) {
    return { x, y: aboveY, placement: 'above' };
  }

  // Fallback inside bottom of large/fullscreen selections
  const insideY = Math.max(
    edgeMargin,
    Math.min(
      selection.y + selection.height - toolbarSize.height - gap,
      bounds.height - toolbarSize.height - edgeMargin
    )
  );
  return { x, y: insideY, placement: 'inside' };
}

/** Map logical viewport selection coordinates to exact clamped physical image pixels. */
export function logicalRectToPhysical(
  rect: SnipRect,
  viewport: SnipViewportSize,
  imageSize: SnipViewportSize
): { x: number; y: number; width: number; height: number; scaleX: number; scaleY: number } {
  const safeViewportW = Math.max(1, viewport.width);
  const safeViewportH = Math.max(1, viewport.height);
  const scaleX = imageSize.width / safeViewportW;
  const scaleY = imageSize.height / safeViewportH;

  const x = Math.max(0, Math.min(Math.round(rect.x * scaleX), Math.max(0, imageSize.width - 1)));
  const y = Math.max(0, Math.min(Math.round(rect.y * scaleY), Math.max(0, imageSize.height - 1)));
  const width = Math.max(1, Math.min(Math.round(rect.width * scaleX), imageSize.width - x));
  const height = Math.max(1, Math.min(Math.round(rect.height * scaleY), imageSize.height - y));

  return { x, y, width, height, scaleX, scaleY };
}
