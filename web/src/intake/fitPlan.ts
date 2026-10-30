export interface Fit {
  canvasW: number;
  canvasH: number;
  /** canvas px per plan meter */
  scale: number;
  /** plan coordinate drawn at canvas (0,0) */
  originX: number;
  originY: number;
}

const LONG_SIDE_PX = 1000;
const MARGIN_FRAC = 0.1;
const MIN_EXTENT_M = 0.5;

interface Seg {
  a: readonly [number, number];
  b: readonly [number, number];
}

/** Virtual canvas that fits the plan (meters) with a margin, aspect preserved. Used when there is no photo. */
export function fitPlan(walls: readonly Seg[]): Fit {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const w of walls) {
    for (const p of [w.a, w.b]) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = MIN_EXTENT_M;
    maxY = MIN_EXTENT_M;
  }
  const w = Math.max(maxX - minX, MIN_EXTENT_M);
  const h = Math.max(maxY - minY, MIN_EXTENT_M);
  const longest = Math.max(w, h);
  const scale = (LONG_SIDE_PX * (1 - 2 * MARGIN_FRAC)) / longest;
  const margin = LONG_SIDE_PX * MARGIN_FRAC;
  return {
    canvasW: w * scale + 2 * margin,
    canvasH: h * scale + 2 * margin,
    scale,
    originX: minX - margin / scale,
    originY: minY - margin / scale,
  };
}

export function planToCanvas(fit: Fit, x: number, y: number): { x: number; y: number } {
  return { x: (x - fit.originX) * fit.scale, y: (y - fit.originY) * fit.scale };
}

export function canvasToPlan(fit: Fit, px: number, py: number): { x: number; y: number } {
  return { x: px / fit.scale + fit.originX, y: py / fit.scale + fit.originY };
}
