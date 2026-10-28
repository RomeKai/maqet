import type { Wall } from "../scene/types";

/** A corner tapped in AR space: [x, y, z] in meters. */
export type Vec3 = [number, number, number];

/** Result of pairing two AR corners into a wall measurement update. */
export interface CornerWallUpdate {
  lengthM: number;
  provenance: NonNullable<Wall["provenance"]>;
}

function isValidCoord(v: number): boolean {
  return Number.isFinite(v);
}

/** True when every component is a finite number. */
export function isValidCorner(c: Vec3): boolean {
  return (
    Array.isArray(c) &&
    c.length === 3 &&
    c.every((v) => typeof v === "number" && isValidCoord(v))
  );
}

/** Euclidean distance in meters between two AR corners. NaN when invalid. */
export function distanceM(a: Vec3, b: Vec3): number {
  if (!isValidCorner(a) || !isValidCorner(b)) return NaN;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Floor-plane (x/z) distance in meters between two AR corners. NaN when
 * invalid. This is the ONLY distance wall geometry may use: the Scene stores
 * plan walls ([x east, y north], scene-model skill), so a tap's height (phone
 * held at chest height, reticle at varying heights) must never leak into
 * wall lengths. `distanceM` stays true-3D for the close-room tap proximity
 * check, which is a spatial gesture, not plan geometry.
 */
export function floorPlaneDistanceM(a: Vec3, b: Vec3): number {
  if (!isValidCorner(a) || !isValidCorner(b)) return NaN;
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Length in meters of the wall segment between two tapped corners, measured
 * on the floor plane (x/z only). Returns null for degenerate pairs
 * (zero-length, non-finite) — the caller keeps the wall estimated and asks
 * the user to tap again. Wall height never comes from here: it is resolved
 * by wallHeightM's fallback chain (wall.height_m ?? scene.ceiling_height_m
 * ?? 2.6, mirroring server/scene/rules.py DEFAULT_CEILING_HEIGHT_M).
 */
export function wallLengthFromCorners(a: Vec3, b: Vec3): number | null {
  const d = floorPlaneDistanceM(a, b);
  if (!Number.isFinite(d) || d <= 0) return null;
  return d;
}

/**
 * Build the measurement payload for a `setWallLength` Scene op.
 * Returns null when the corner pair is degenerate (no op is emitted).
 */
export function pairCornersToWallUpdate(
  corners: [Vec3, Vec3],
  wallId: string,
): (CornerWallUpdate & { wallId: string }) | null {
  const lengthM = wallLengthFromCorners(corners[0], corners[1]);
  if (lengthM === null) return null;
  return { wallId, lengthM, provenance: "measured_ar" };
}

/** A wall measured from two AR corners (Mode A, no photo needed). */
export interface NewWallFromCorners {
  wall: Wall;
  lengthM: number;
}

/**
 * Project two AR-tapped floor corners onto plan [x east, y north].
 * AR device space is [x right, y up, z toward viewer]; with the floor as the
 * measure plane, plan = [x, -z] (inverse of the SceneView renderer mapping).
 * Interior 0.10 m by default: the technician corrects the kind while drawing.
 * Returns null for degenerate pairs (no wall is emitted).
 */
export function pairCornersToNewWall(
  corners: [Vec3, Vec3],
  wallId: string,
): NewWallFromCorners | null {
  const lengthM = wallLengthFromCorners(corners[0], corners[1]);
  if (lengthM === null) return null;
  const wall: Wall = {
    id: wallId,
    a: [corners[0][0], -corners[0][2]],
    b: [corners[1][0], -corners[1][2]],
    thickness_m: 0.1,
    kind: "interior",
    provenance: "measured_ar",
    measured_length_m: lengthM,
  };
  return { wall, lengthM };
}

/**
 * Snap radius in meters: a tap within this distance of the first corner
 * closes the room (shared endpoint, not a new wall stub).
 */
export const CLOSE_ROOM_M = 0.15;

/** True when a tap lands close enough to the first corner to close the room. */
export function shouldCloseRoom(first: Vec3, tap: Vec3): boolean {
  const d = distanceM(first, tap);
  return Number.isFinite(d) && d <= CLOSE_ROOM_M;
}

/** Corner chain folded into connected walls (Mode A empty-start tracing). */
export interface CornerChain {
  walls: Wall[];
  /** True when the last tap closed the room (4+ taps, final wall looped). */
  closed: boolean;
}

/**
 * Fold a tap sequence into chained walls: every wall starts where the
 * previous one ended, with stable incremental ids (wall-1, wall-2, ...).
 * A final tap within CLOSE_ROOM_M of the first corner closes the loop —
 * but only with 3+ walls already traced (two walls cannot close a room).
 * Degenerate segments are skipped without breaking the chain.
 */
export function chainCornersToWalls(taps: Vec3[]): CornerChain {  if (taps.length < 2) return { walls: [], closed: false };
  const first = taps[0] as Vec3;
  const lastTap = taps[taps.length - 1] as Vec3;
  const nearFirst = shouldCloseRoom(first, lastTap);
  // A room needs 3+ walls: the final tap closes the loop only then. A
  // close-gesture tap that arrives too early is dropped (accidental tap),
  // never a wall stub back toward the start.
  const closed = taps.length - 1 >= 3 && nearFirst;
  const corners: Vec3[] = closed
    ? [...(taps.slice(0, -1) as Vec3[]), first]
    : nearFirst
      ? (taps.slice(0, -1) as Vec3[])
      : taps;
  const walls: Wall[] = [];
  for (let i = 0; i + 1 < corners.length; i++) {
    const created = pairCornersToNewWall(
      [corners[i] as Vec3, corners[i + 1] as Vec3],
      `wall-${walls.length + 1}`,
    );
    if (created !== null) walls.push(created.wall);
  }
  return { walls, closed };
}

/**
 * Live corner trace for Mode A empty-start: each new tap completes the wall
 * ending at it from the previous corner (emitted immediately via onChange +
 * applySceneOp addWall). Ids stay stable across taps by offsetting on the
 * scene wall count at trace start (wallCount = walls already in the scene).
 * A tap within CLOSE_ROOM_M of the first corner closes the loop (snapped,
 * no stub wall) — only with 3+ walls traced; an earlier near-first tap is
 * dropped as accidental. Once closed the trace ignores further taps.
 */
export interface CornerTrace {
  corners: Vec3[];
  /** Wall the last tap completed (null for first tap, drops, after close). */
  lastWall: Wall | null;
  /** True once a tap closed the room loop. */
  closed: boolean;
  /** Walls already in the scene when tracing started (id offset). */
  wallCount: number;
}

/** Fresh empty trace: corners and the id offset come from the first taps. */
export function emptyCornerTrace(): CornerTrace {
  return { corners: [], lastWall: null, closed: false, wallCount: 0 };
}

export function traceCornerTap(
  trace: CornerTrace,
  tap: Vec3,
  sceneWallCount: number,
): CornerTrace {
  if (trace.closed) return { ...trace, lastWall: null };
  const corners = trace.corners;
  const wallCount =
    corners.length === 0 ? sceneWallCount : trace.wallCount;
  if (corners.length === 0) {
    return { corners: [tap], lastWall: null, closed: false, wallCount };
  }
  const first = corners[0] as Vec3;
  if (shouldCloseRoom(first, tap)) {
    // 3+ walls needed to close: walls traced = corners - 1 (4+ corners).
    if (corners.length >= 4) {
      const created = pairCornersToNewWall(
        [corners[corners.length - 1] as Vec3, first],
        `wall-${wallCount + corners.length}`,
      );
      if (created === null) {
        return { corners, lastWall: null, closed: false, wallCount };
      }
      return {
        corners: [...corners, first],
        lastWall: created.wall,
        closed: true,
        wallCount,
      };
    }
    // Early close-gesture tap: dropped (accidental), never a stub wall.
    return { corners, lastWall: null, closed: false, wallCount };
  }
  const created = pairCornersToNewWall(
    [corners[corners.length - 1] as Vec3, tap],
    `wall-${wallCount + corners.length}`,
  );
  if (created === null) {
    return { corners, lastWall: null, closed: false, wallCount };
  }
  return {
    corners: [...corners, tap],
    lastWall: created.wall,
    closed: false,
    wallCount,
  };
}
