import type { Opening, Room, Scene, Wall } from "../scene/types";

/**
 * Scene -> declarative mesh descriptors (pure, no three.js here).
 *
 * Units are meters. Convention: plan coords are [x east, y north] and every
 * descriptor is Z-up ([x east, y north, z up]). The renderer maps Z-up onto
 * its own up-axis (three.js is Y-up: position [x, z, -y]).
 *
 * Covered (ADR-001, scene-model skill): wall boxes from the a->b centerline
 * (length, plan angle), thickness_m, height (height_m ?? ceiling_height_m ??
 * 2.6); openings split the wall run into solid segments around each
 * [offset_m, offset_m+width_m] interval; room floors as plan polygons.
 * Furniture GLBs come later with the catalog — NOT built here.
 *
 * P0 simplification (documented tradeoff): an opening subtracts the FULL wall
 * height over its run interval (doors and windows both become full-height
 * gaps). Vertical subdivision into sill/lintel boxes from sill_m/height_m is
 * the follow-up once real openings render.
 */

/** Plan-space point in meters: [x east, y north]. */
export type PlanPoint = readonly [number, number];

/** 3D point in meters, Z-up: [x east, y north, z up]. */
export type WorldPoint = readonly [number, number, number];

/** Fallback wall height in meters (ADR-023: ceiling 2.60 m). */
export const DEFAULT_CEILING_HEIGHT_M = 2.6;

/** Run lengths at or below this are degenerate (skipped, never rendered). */
const EPS_M = 1e-6;

export interface WallSegment {
  kind: "wall-segment";
  id: string;
  wallId: string;
  /** Box center in meters, Z-up. */
  center: WorldPoint;
  /** Box size in meters: [length along wall, thickness, height]. */
  size: readonly [number, number, number];
  /** Plan rotation about Z in radians, from +X (east) toward +Y (north). */
  rotationZ: number;
  wallKind: Wall["kind"];
}

export interface FloorMesh {
  kind: "floor";
  id: string;
  roomId: string;
  /**
   * Room polygon in plan meters. Triangulation choice: the renderer feeds
   * these points to THREE.Shape / ShapeGeometry, which triangulates with
   * earcut (THREE.ShapeUtils.triangulateShape) — either winding is accepted.
   */
  points: PlanPoint[];
  /** Floor planes always face up: [0, 0, 1]. */
  normal: WorldPoint;
}

export interface SceneMeshes {
  walls: WallSegment[];
  floors: FloorMesh[];
}

/** Effective wall height: wall override, else scene ceiling, else 2.6 m. */
export function wallHeightM(wall: Wall, scene: Scene): number {
  const h = wall.height_m ?? scene.ceiling_height_m ?? DEFAULT_CEILING_HEIGHT_M;
  return typeof h === "number" && Number.isFinite(h) && h > 0
    ? h
    : DEFAULT_CEILING_HEIGHT_M;
}

/** Geometric run length of a wall centerline in meters. */
export function wallRunLengthM(wall: Wall): number {
  return Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
}

/**
 * Solid run intervals after subtracting openings, in meters from wall.a.
 * Each opening interval is clamped to [0, length]; out-of-range or
 * zero-width openings are ignored; overlapping openings merge.
 */
export function solidIntervalsM(
  wallLengthM: number,
  openings: readonly Opening[],
): Array<readonly [number, number]> {
  const blocked: Array<[number, number]> = [];
  for (const o of openings) {
    if (!Number.isFinite(o.offset_m) || !Number.isFinite(o.width_m)) continue;
    if (!(o.width_m > 0)) continue;
    const t0 = Math.max(0, o.offset_m);
    const t1 = Math.min(wallLengthM, o.offset_m + o.width_m);
    if (t1 - t0 > EPS_M) blocked.push([t0, t1]);
  }
  blocked.sort((p, q) => p[0] - q[0]);
  const merged: Array<[number, number]> = [];
  for (const [t0, t1] of blocked) {
    const last = merged[merged.length - 1];
    if (last !== undefined && t0 <= last[1] + EPS_M) {
      last[1] = Math.max(last[1], t1);
    } else {
      merged.push([t0, t1]);
    }
  }
  const solids: Array<[number, number]> = [];
  let cursor = 0;
  for (const [t0, t1] of merged) {
    if (t0 - cursor > EPS_M) solids.push([cursor, t0]);
    cursor = Math.max(cursor, t1);
  }
  if (wallLengthM - cursor > EPS_M) solids.push([cursor, wallLengthM]);
  return solids;
}

/**
 * Wall run split into solid box segments. Returns [] for degenerate walls
 * (zero length, non-positive thickness) — skipped, never crashed on.
 */
export function wallSegments(wall: Wall, scene: Scene): WallSegment[] {
  const length = wallRunLengthM(wall);
  if (!(length > EPS_M)) return [];
  if (!Number.isFinite(wall.thickness_m) || !(wall.thickness_m > 0)) return [];
  const height = wallHeightM(wall, scene);
  const openings = (scene.openings ?? []).filter((o) => o.wall_id === wall.id);
  const dx = (wall.b[0] - wall.a[0]) / length;
  const dy = (wall.b[1] - wall.a[1]) / length;
  const rotationZ = Math.atan2(dy, dx);
  return solidIntervalsM(length, openings).map(([t0, t1], i) => {
    const mid = (t0 + t1) / 2;
    const center: WorldPoint = [
      wall.a[0] + dx * mid,
      wall.a[1] + dy * mid,
      height / 2,
    ];
    const size: readonly [number, number, number] = [
      t1 - t0,
      wall.thickness_m,
      height,
    ];
    return {
      kind: "wall-segment",
      id: `${wall.id}:seg:${i}`,
      wallId: wall.id,
      center,
      size,
      rotationZ,
      wallKind: wall.kind,
    };
  });
}

/**
 * Room floor polygon. Returns null when the room has no usable polygon
 * (< 3 finite points) — and when rooms are missing entirely the Scene simply
 * gets no floor meshes (rooms are derived server-side after intake; the view
 * stays honest instead of inventing a floor).
 */
export function floorMesh(room: Room): FloorMesh | null {
  const raw = room.polygon ?? [];
  const points: PlanPoint[] = [];
  for (const p of raw) {
    if (
      Array.isArray(p) &&
      Number.isFinite(p[0]) &&
      Number.isFinite(p[1])
    ) {
      points.push([p[0], p[1]]);
    }
  }
  if (points.length < 3) return null;
  return {
    kind: "floor",
    id: `${room.id}:floor`,
    roomId: room.id,
    points,
    normal: [0, 0, 1],
  };
}

/** Whole-Scene mapping. Never throws on empty/partial scenes. */
export function sceneToMeshes(scene: Scene): SceneMeshes {
  const walls: WallSegment[] = [];
  for (const wall of scene.walls ?? []) {
    walls.push(...wallSegments(wall, scene));
  }
  const floors: FloorMesh[] = [];
  for (const room of scene.rooms ?? []) {
    const floor = floorMesh(room);
    if (floor !== null) floors.push(floor);
  }
  return { walls, floors };
}
