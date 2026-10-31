import type { CapturedCorner } from "./captureSession";
import type { Vec3 } from "./cornerMath";

/**
 * Camera ray (eye + forward dir) from a WebXR view matrix (column-major,
 * 16 numbers; `OverlayFrame.view.viewInverse`, i.e. view.transform.inverse).
 * Returns null for missing, short, non-finite, or degenerate matrices.
 *
 * The matrix is world -> view (rigid: rotation + translation), so the
 * camera pose is its inverse: eye = -R^T·t, forward = -(third row of R).
 */
export function centerRayFromViewInverse(
  viewInverse: readonly number[] | null,
): { eye: Vec3; dir: Vec3 } | null {
  if (viewInverse === null || viewInverse.length < 16) return null;
  if (!viewInverse.every(Number.isFinite)) return null;
  const m = viewInverse;
  const tx = m[12]!;
  const ty = m[13]!;
  const tz = m[14]!;
  const eye: Vec3 = [
    -(m[0]! * tx + m[1]! * ty + m[2]! * tz),
    -(m[4]! * tx + m[5]! * ty + m[6]! * tz),
    -(m[8]! * tx + m[9]! * ty + m[10]! * tz),
  ];
  if (!eye.every(Number.isFinite)) return null;
  // Camera forward in world = -(third row of R), normalized.
  const fx = -m[2]!;
  const fy = -m[6]!;
  const fz = -m[10]!;
  const len = Math.hypot(fx, fy, fz);
  if (!Number.isFinite(len) || !(len > 1e-9)) return null;
  const dir: Vec3 = [fx / len, fy / len, fz / len];
  return { eye, dir };
}

/**
 * Pure geometry: height above floorY at the intersection of the center-screen
 * camera ray (eye + t*dir) with the vertical plane through the pending wall
 * A->B. Returns null when there is no wall, no floor datum, no ray, the ray is
 * parallel to the plane, or the intersection is below the floor.
 *
 * The wall's vertical plane has normal n = (-dz, 0, dx) / |A-B| where the plane
 * passes through A (x,z) at every y. Intersection solves n·(eye + t*dir - A) = 0.
 */
export function ceilingHeightFromCenterRay(
  pendingStart: CapturedCorner | null,
  pendingEnd: CapturedCorner | null,
  floorY: number | null,
  ray: { eye: Vec3; dir: Vec3 } | null,
): number | null {
  if (pendingStart === null || pendingEnd === null) return null;
  if (floorY === null) return null;
  if (ray === null) return null;
  if (!Number.isFinite(floorY)) return null;

  const ax = pendingStart.x;
  const az = pendingStart.z;
  const bx = pendingEnd.x;
  const bz = pendingEnd.z;
  const dx = bx - ax;
  const dz = bz - az;
  const wallLen = Math.hypot(dx, dz);
  if (!(wallLen > 1e-9)) return null;

  // Vertical plane normal in the horizontal (x,z) plane: perpendicular to A->B.
  // n = (-dz, 0, dx) normalized (y component is 0 because the plane is vertical).
  const nx = -dz / wallLen;
  const nz = dx / wallLen;

  const eye = ray.eye;
  const dir = ray.dir;
  const denom = nx * dir[0] + nz * dir[2];
  if (Math.abs(denom) < 1e-9) return null; // parallel

  const toA_x = ax - eye[0];
  const toA_z = az - eye[2];
  const t = (nx * toA_x + nz * toA_z) / denom;
  // The ray is forward only: hitting behind the camera is not a height.
  if (!(t > 0)) return null;

  const hitY = eye[1] + t * dir[1];
  const heightM = hitY - floorY;
  if (!Number.isFinite(heightM) || heightM <= 0) return null;
  return heightM;
}

/**
 * Point where the center ray meets the floor plane y = floorY (null when the
 * ray is missing, level or points up). Used so the reticle and the next corner
 * always live on the floor, never on the wall or ceiling the camera sees.
 */
export function floorPointFromRay(
  ray: { eye: Vec3; dir: Vec3 } | null,
  floorY: number,
): Vec3 | null {
  if (ray === null || !Number.isFinite(floorY)) return null;
  if (!(ray.dir[1] < -1e-6)) return null;
  const t = (floorY - ray.eye[1]) / ray.dir[1];
  if (!(t > 0)) return null;
  const p: Vec3 = [ray.eye[0] + t * ray.dir[0], floorY, ray.eye[2] + t * ray.dir[2]];
  return p.every(Number.isFinite) ? p : null;
}

/**
 * The captured wall the center ray crosses, with the crossing point. No
 * hit-test needed (bare walls rarely give one). The crossing must lie on the
 * wall segment (small slack) and between the floor and the wall top.
 */
export function wallPointFromRay(
  walls: readonly { id: string; start: CapturedCorner; end: CapturedCorner; heightM: number | null }[],
  floorY: number,
  ray: { eye: Vec3; dir: Vec3 } | null,
): { wallId: string; point: Vec3 } | null {
  if (ray === null || !Number.isFinite(floorY)) return null;
  const SLACK_M = 0.15;
  let best: { wallId: string; point: Vec3; t: number } | null = null;
  for (const w of walls) {
    const dx = w.end.x - w.start.x;
    const dz = w.end.z - w.start.z;
    const len = Math.hypot(dx, dz);
    if (!(len > 1e-9)) continue;
    const nx = -dz / len;
    const nz = dx / len;
    const denom = nx * ray.dir[0] + nz * ray.dir[2];
    if (Math.abs(denom) < 1e-9) continue;
    const t = (nx * (w.start.x - ray.eye[0]) + nz * (w.start.z - ray.eye[2])) / denom;
    if (!(t > 0)) continue;
    const x = ray.eye[0] + t * ray.dir[0];
    const y = ray.eye[1] + t * ray.dir[1];
    const z = ray.eye[2] + t * ray.dir[2];
    const along = ((x - w.start.x) * dx + (z - w.start.z) * dz) / len;
    if (along < -SLACK_M || along > len + SLACK_M) continue;
    const height = w.heightM ?? 2.6;
    if (y < floorY - SLACK_M || y > floorY + height + SLACK_M) continue;
    if (best === null || t < best.t) best = { wallId: w.id, point: [x, y, z], t };
  }
  return best === null ? null : { wallId: best.wallId, point: best.point };
}

/** A hit-test pose further than this from the floor plane is a wall/ceiling hit. */
export const FLOOR_TAP_TOLERANCE_M = 0.15;

/**
 * The floor point for a base tap: the hit-test pose when it is on the floor
 * plane, otherwise the center ray's floor intersection. Never a point at wall
 * or ceiling height (the cause of corners and dashed bands floating mid-air).
 */
export function resolveFloorTap(
  hit: Vec3 | null,
  floorY: number,
  ray: { eye: Vec3; dir: Vec3 } | null,
): Vec3 | null {
  if (hit !== null && Math.abs(hit[1] - floorY) <= FLOOR_TAP_TOLERANCE_M) return hit;
  return floorPointFromRay(ray, floorY) ?? null;
}
