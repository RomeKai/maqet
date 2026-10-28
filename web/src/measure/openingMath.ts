import type { Opening, Wall } from "../scene/types";
import { isValidCorner, type Vec3 } from "./cornerMath";

/**
 * Pure opening math for Mode A AR tracing (no three.js).
 *
 * Taps arrive as 3D corners (Vec3 = [x, y, z] in meters) but wall geometry is
 * floor-plane: plan = [x, -z], the same convention as pairCornersToNewWall in
 * cornerMath.ts. Tap height never leaks into the opening.
 */

/**
 * Full-height door leaf default in meters. Sits below the 2.60 m Scene
 * default (server/scene/rules.py DEFAULT_CEILING_HEIGHT_M); the remaining
 * head goes to the lintel/bond beam, resolved deterministically at takeoff.
 */
export const AR_DOOR_HEIGHT_M = 2.0;

/**
 * Maqet AR-tracing default window sill in meters (rule of thumb, unverified).
 * NOT a code citation: server/scene/rules.py defines no window sill/height
 * default. Sill 0.90 + height 1.20 puts the head at 2.10, under the ceiling.
 */
export const AR_WINDOW_SILL_M = 0.9;

/**
 * Maqet AR-tracing default window height in meters (rule of thumb,
 * unverified). See AR_WINDOW_SILL_M for why these live here, not in rules.py.
 */
export const AR_WINDOW_HEIGHT_M = 1.2;

/**
 * Minimum door width in meters. Mirrors the server backstop
 * (server/scene/rules.py MIN_DOOR_WIDTH_M): doors narrower than this fail
 * server validation, so the client rejects them with a HUD message instead.
 */
export const MIN_DOOR_WIDTH_M = 0.8;

/** Opening placement along its wall, in meters from wall.a. */
export interface OpeningProjection {
  offset_m: number;
  width_m: number;
}

/** AR tap -> plan [x east, y north] (mirrors cornerMath pairCornersToNewWall). */
function toPlan(tap: Vec3): [number, number] {
  return [tap[0], -tap[2]];
}

/**
 * Project two AR edge taps onto an existing plan wall. Offset is the distance
 * from wall.a to the nearer projection (clamped >= 0 so a tap before the wall
 * start still yields a valid opening); width is the distance between the two
 * projections, so tap order never matters. Returns null for degenerate pairs
 * (non-finite taps, zero-length wall, coincident projections) — the caller
 * keeps the previous state and asks the technician to tap again.
 */
export function projectEdgesToOpening(
  wall: Wall,
  edge1: Vec3,
  edge2: Vec3,
): OpeningProjection | null {
  if (!isValidCorner(edge1) || !isValidCorner(edge2)) return null;
  const axisX = wall.b[0] - wall.a[0];
  const axisY = wall.b[1] - wall.a[1];
  const wallLen = Math.hypot(axisX, axisY);
  if (!(wallLen > 0) || !Number.isFinite(wallLen)) return null;
  const unitX = axisX / wallLen;
  const unitY = axisY / wallLen;
  const p1 = toPlan(edge1);
  const p2 = toPlan(edge2);
  const t1 = (p1[0] - wall.a[0]) * unitX + (p1[1] - wall.a[1]) * unitY;
  const t2 = (p2[0] - wall.a[0]) * unitX + (p2[1] - wall.a[1]) * unitY;
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  const widthM = Math.abs(t2 - t1);
  if (!(widthM > 0)) return null;
  return { offset_m: Math.max(0, Math.min(t1, t2)), width_m: widthM };
}

export interface OpeningDefaults {
  height_m: number;
  sill_m: number | null;
}

/**
 * Deterministic opening dimensions by kind. Doors run full-height
 * (AR_DOOR_HEIGHT_M, sill null); windows use the Maqet AR-tracing defaults
 * (AR_WINDOW_SILL_M / AR_WINDOW_HEIGHT_M).
 */
export function openingDefaults(kind: "door" | "window"): OpeningDefaults {
  if (kind === "door") return { height_m: AR_DOOR_HEIGHT_M, sill_m: null };
  return { height_m: AR_WINDOW_HEIGHT_M, sill_m: AR_WINDOW_SILL_M };
}

/**
 * Floor-plane distance from an AR tap to a plan wall segment (point-to-segment
 * on [x, -z]). Non-finite when the tap or wall is degenerate.
 */
function tapToWallDistanceM(wall: Wall, tap: Vec3): number {
  if (!isValidCorner(tap)) return NaN;
  const p = toPlan(tap);
  const axisX = wall.b[0] - wall.a[0];
  const axisY = wall.b[1] - wall.a[1];
  const wallLenSq = axisX * axisX + axisY * axisY;
  if (!(wallLenSq > 0) || !Number.isFinite(wallLenSq)) return NaN;
  const t = Math.min(
    1,
    Math.max(
      0,
      ((p[0] - wall.a[0]) * axisX + (p[1] - wall.a[1]) * axisY) / wallLenSq,
    ),
  );
  return Math.hypot(p[0] - (wall.a[0] + t * axisX), p[1] - (wall.a[1] + t * axisY));
}

/**
 * Nearest traced wall to an AR tap (floor-plane point-to-segment distance),
 * so door/window taps snap to the just-traced wall without a manual wall
 * pick. Returns null when there are no walls or the tap is invalid. Tap
 * height never leaks in: distance is plan-only, like projectEdgesToOpening.
 */
export function nearestWallToTap(walls: Wall[], tap: Vec3): Wall | null {
  if (!isValidCorner(tap)) return null;
  let best: Wall | null = null;
  let bestD = Infinity;
  for (const wall of walls) {
    const d = tapToWallDistanceM(wall, tap);
    if (Number.isFinite(d) && d < bestD) {
      bestD = d;
      best = wall;
    }
  }
  return best;
}

/**
 * Clamp an opening (offset from wall.a, width along it) to a wall of the
 * given length so offset + width <= length — the client-side twin of the
 * server `opening.overflows_wall` backstop. Returns null when nothing fits
 * (offset at or past the wall end, degenerate or non-finite input), so the
 * caller shows a re-tap message instead of emitting an opening the server
 * would reject.
 */
export function clampOpeningToWall(
  wallLenM: number,
  offsetM: number,
  widthM: number,
): OpeningProjection | null {
  if (
    !Number.isFinite(wallLenM) ||
    !Number.isFinite(offsetM) ||
    !Number.isFinite(widthM)
  ) {
    return null;
  }
  if (!(wallLenM > 0) || !(widthM > 0)) return null;
  const offset = Math.max(0, offsetM);
  if (!(offset < wallLenM)) return null;
  return { offset_m: offset, width_m: Math.min(widthM, wallLenM - offset) };
}

/**
 * Next stable opening id from the highest `opening-<n>` numeric suffix + 1,
 * so delete/undo never collides (the old length-based scheme reused ids).
 * Non-numeric suffixes are ignored (start at opening-1 when none parse).
 */
export function nextOpeningId(openings: Opening[]): string {
  let max = 0;
  for (const opening of openings) {
    const suffix = Number(opening.id.slice("opening-".length));
    if (Number.isInteger(suffix) && suffix > max) max = suffix;
  }
  return `opening-${max + 1}`;
}

/**
 * Opening placement failure reasons, so the HUD can say WHY the taps were
 * dropped instead of silently keeping the first edge. Exported for tests.
 */
export type OpeningFailure =
  | "unknown-wall"
  | "degenerate"
  | "no-fit"
  | "door-narrow";

/**
 * Build a markOpening payload for two edge taps on a measured wall: project
 * onto the wall, clamp the far end to the wall length, reject narrow doors
 * (server MIN_DOOR_WIDTH_M backstop). Returns the opening, or the failure
 * reason when the taps cannot map — never null, so the caller can surface
 * the HUD error copy for that reason.
 */
export function buildOpening(
  walls: Wall[],
  id: string,
  kind: "door" | "window",
  wallId: string,
  edge1: Vec3,
  edge2: Vec3,
): { opening: Opening } | { failure: OpeningFailure } {
  const wall = walls.find((w) => w.id === wallId);
  if (wall === undefined) return { failure: "unknown-wall" };
  const projection = projectEdgesToOpening(wall, edge1, edge2);
  if (projection === null) return { failure: "degenerate" };
  const wallLen = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const clamped = clampOpeningToWall(wallLen, projection.offset_m, projection.width_m);
  if (clamped === null) return { failure: "no-fit" };
  if (kind === "door" && clamped.width_m < MIN_DOOR_WIDTH_M - 1e-9) {
    return { failure: "door-narrow" };
  }
  const defaults = openingDefaults(kind);
  return {
    opening: {
      id,
      wall_id: wallId,
      kind,
      offset_m: clamped.offset_m,
      width_m: clamped.width_m,
      height_m: defaults.height_m,
      sill_m: defaults.sill_m,
    },
  };
}
