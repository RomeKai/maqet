import type { Wall } from "../scene/types";
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
