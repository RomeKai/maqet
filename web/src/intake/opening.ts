import type { Opening, Wall } from "../scene/types";

/** Small tolerance so clicks slightly off the line still count as "on wall". */
/** Narrowest acceptable door (m). */
export const DOOR_MIN_WIDTH_M = 0.8;
export const WINDOW_MIN_WIDTH_M = 0.5;
export const DEFAULT_DOOR_WIDTH_M = 0.9;
export const DEFAULT_WINDOW_WIDTH_M = 1.0;
export const ON_WALL_TOL_M = 0.12;

/** Derive Opening offset/width from two taps projected onto the wall's axis. */
export interface OpeningPlacement {
  wallId: string;
  kind: "door" | "window";
  offset_m: number;
  width_m: number;
  height_m: number;
  sill_m?: number | null;
}

export interface TapRejected {
  reason: "outside-wall" | "degenerate";
}

export interface FormInput {
  wallId: string;
  kind: "door" | "window";
  wallOffsetM: number;
  widthM: number;
  heightM: number;
  sillM?: number | null;
}

/** Project point p onto segment a->b. Returns t in [0,1] along a->b and perpendicular distance. */
export function projectOntoSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): { t: number; perp: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len <= 0) return { t: 0, perp: Infinity };
  const ux = dx / len;
  const uy = dy / len;
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const proj = apx * ux + apy * uy;
  const t = proj / len;
  // perpendicular component magnitude
  const alongX = ux * proj;
  const alongY = uy * proj;
  const perp = Math.hypot(apx - alongX, apy - alongY);
  return { t, perp };
}

/** Try to place an opening from two taps on a wall. Null => outside wall. */
export function tapsToPlacement(
  wall: Wall,
  kind: "door" | "window",
  p0: [number, number],
  p1: [number, number],
  tolM: number = ON_WALL_TOL_M,
): { placement: OpeningPlacement } | { rejected: TapRejected } {
  const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  if (len <= 0) return { rejected: { reason: "degenerate" } };

  const pr0 = projectOntoSegment(p0, wall.a, wall.b);
  const pr1 = projectOntoSegment(p1, wall.a, wall.b);
  if (pr0.perp > tolM || pr1.perp > tolM) return { rejected: { reason: "outside-wall" } };
  // Taps must lie within the wall span (inclusive with small slop = tol/len mapped to t).
  const tolT = tolM / len;
  if (pr0.t < -tolT || pr0.t > 1 + tolT || pr1.t < -tolT || pr1.t > 1 + tolT) {
    return { rejected: { reason: "outside-wall" } };
  }
  const t0 = Math.max(0, Math.min(1, pr0.t));
  const t1 = Math.max(0, Math.min(1, pr1.t));
  if (Math.abs(t0 - t1) < 1e-9) return { rejected: { reason: "degenerate" } };
  const tMin = Math.min(t0, t1);
  const tMax = Math.max(t0, t1);
  const offsetM = tMin * len;
  const widthM = (tMax - tMin) * len;
  const heightM = kind === "door" ? 2.05 : 1.4;
  const placement: OpeningPlacement = {
    wallId: wall.id,
    kind,
    offset_m: offsetM,
    width_m: widthM,
    height_m: heightM,
    ...(kind === "window" ? { sill_m: 0.8 } : {}),
  };
  return { placement };
}

/** Build placement from form inputs. Same output shape as taps. */
export function formToPlacement(input: FormInput): { placement: OpeningPlacement } | { rejected: TapRejected } {
  const { wallId, kind, wallOffsetM, widthM, heightM, sillM } = input;
  if (!Number.isFinite(wallOffsetM) || !Number.isFinite(widthM) || !Number.isFinite(heightM)) {
    return { rejected: { reason: "degenerate" } };
  }
  if (widthM <= 0 || heightM <= 0 || wallOffsetM < 0) {
    return { rejected: { reason: "degenerate" } };
  }
  const placement: OpeningPlacement = {
    wallId,
    kind,
    offset_m: wallOffsetM,
    width_m: widthM,
    height_m: heightM,
    ...(kind === "window" ? { sill_m: sillM ?? 0.8 } : {}),
  };
  return { placement };
}

export function validateAgainstWall(
  wall: Wall,
  offsetM: number,
  widthM: number,
  tolM: number = ON_WALL_TOL_M,
): TapRejected | null {
  const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  if (len <= 0) return { reason: "degenerate" };
  if (offsetM < -tolM || offsetM + widthM > len + tolM) return { reason: "outside-wall" };
  if (widthM <= 0) return { reason: "degenerate" };
  return null;
}

export function placementToOpening(placement: OpeningPlacement, id: string): Opening {
  return {
    id,
    wall_id: placement.wallId,
    kind: placement.kind,
    offset_m: placement.offset_m,
    width_m: placement.width_m,
    height_m: placement.height_m,
    ...(placement.kind === "window" ? { sill_m: placement.sill_m ?? 0.8 } : {}),
  };
}

/** Screen-px snap: project point onto nearest wall within maxPx; null if none. */
export function snapPointToWallPx(
  point: [number, number],
  walls: Wall[],
  toDisplay: (x: number, y: number) => { x: number; y: number },
  maxPx = 24,
): { wall: Wall; point: [number, number]; t: number } | null {
  let best: { wall: Wall; point: [number, number]; t: number; dpx: number } | null = null;
  for (const wall of walls) {
    const wA: [number, number] = [wall.a[0] as number, wall.a[1] as number];
    const wB: [number, number] = [wall.b[0] as number, wall.b[1] as number];
    // project in scene meters, then measure distance in screen px
    const len = Math.hypot(wB[0] - wA[0], wB[1] - wA[1]);
    if (len <= 0) continue;
    const dx = wB[0] - wA[0];
    const dy = wB[1] - wA[1];
    const ux = dx / len;
    const uy = dy / len;
    const apx = point[0] - wA[0];
    const apy = point[1] - wA[1];
    const proj = apx * ux + apy * uy;
    const t = Math.max(0, Math.min(1, proj / len));
    const closest: [number, number] = [wA[0] + ux * (t * len), wA[1] + uy * (t * len)];
    const screenPt = toDisplay(point[0], point[1]);
    const screenClosest = toDisplay(closest[0], closest[1]);
    const dpx = Math.hypot(screenPt.x - screenClosest.x, screenPt.y - screenClosest.y);
    if (dpx <= maxPx && (best === null || dpx < best.dpx)) {
      best = { wall, point: closest, t, dpx };
    }
  }
  return best ? { wall: best.wall, point: best.point, t: best.t } : null;
}

export function nearestWallDistancePx(
  point: [number, number],
  walls: Wall[],
  toDisplay: (x: number, y: number) => { x: number; y: number },
): number {
  let best = Infinity;
  for (const wall of walls) {
    const wA: [number, number] = [wall.a[0] as number, wall.a[1] as number];
    const wB: [number, number] = [wall.b[0] as number, wall.b[1] as number];
    const len = Math.hypot(wB[0] - wA[0], wB[1] - wA[1]);
    if (len <= 0) continue;
    const ux = (wB[0] - wA[0]) / len;
    const uy = (wB[1] - wA[1]) / len;
    const apx = point[0] - wA[0];
    const apy = point[1] - wA[1];
    const proj = apx * ux + apy * uy;
    const t = Math.max(0, Math.min(1, proj / len));
    const closest: [number, number] = [wA[0] + ux * (t * len), wA[1] + uy * (t * len)];
    const dpx = Math.hypot(
      toDisplay(point[0], point[1]).x - toDisplay(closest[0], closest[1]).x,
      toDisplay(point[0], point[1]).y - toDisplay(closest[0], closest[1]).y,
    );
    best = Math.min(best, dpx);
  }
  return best;
}

/** Opening placement from two already-snapped wall points (no rejection). */
export function openPlacemenFromSnappedTap(
  wall: Wall,
  kind: "door" | "window",
  p0: [number, number],
  p1: [number, number],
): { placement: OpeningPlacement } | { rejected: TapRejected } {
  const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  if (len <= 0) return { rejected: { reason: "degenerate" } };
  const pr0 = projectOntoSegment(p0, wall.a as [number, number], wall.b as [number, number]);
  const pr1 = projectOntoSegment(p1, wall.a as [number, number], wall.b as [number, number]);
  const t0 = Math.max(0, Math.min(1, pr0.t));
  const t1 = Math.max(0, Math.min(1, pr1.t));
  const tMin = Math.min(t0, t1);
  const tMax = Math.max(t0, t1);
  const span = (tMax - tMin) * len;
  const minSpan = kind === "door" ? DOOR_MIN_WIDTH_M : WINDOW_MIN_WIDTH_M;
  if (span < minSpan) {
    // Taps too close together: use the default size centred between them.
    const width = kind === "door" ? DEFAULT_DOOR_WIDTH_M : DEFAULT_WINDOW_WIDTH_M;
    if (width > len) return { rejected: { reason: "degenerate" } };
    const centre = ((tMin + tMax) / 2) * len;
    return {
      placement: {
        wallId: wall.id,
        kind,
        offset_m: Math.max(0, Math.min(len - width, centre - width / 2)),
        width_m: width,
        height_m: kind === "door" ? 2.05 : 1.4,
        ...(kind === "window" ? { sill_m: 0.8 } : {}),
      },
    };
  }
  return {
    placement: {
      wallId: wall.id,
      kind,
      offset_m: tMin * len,
      width_m: (tMax - tMin) * len,
      height_m: kind === "door" ? 2.05 : 1.4,
      ...(kind === "window" ? { sill_m: 0.8 } : {}),
    },
  };
}
