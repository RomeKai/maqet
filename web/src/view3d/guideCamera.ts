import type { Scene } from "../scene/types";
import type { WorldPoint } from "./sceneToMeshes";

/** Fixed eye-level guide view for "In real life": standing in the door, looking into the room. */
export const GUIDE_EYE_HEIGHT_M = 1.6;
export const GUIDE_FOV_DEG = 85;
export const GUIDE_SIZE_PX = { width: 1024, height: 768 } as const;
const INSET_M = 0.2;
const LOOK_HEIGHT_M = 1.0;

export interface GuideCamera {
  /** Plan meters, z up (same frame as sceneToMeshes descriptors). */
  position: WorldPoint;
  target: WorldPoint;
  fovDeg: number;
}

type P2 = readonly [number, number];

function centroid(poly: readonly P2[]): [number, number] {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
}

function distToSegment(p: P2, a: P2, b: P2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function inward(from: P2, c: P2): [number, number] {
  const dx = c[0] - from[0];
  const dy = c[1] - from[1];
  const d = Math.hypot(dx, dy) || 1;
  return [from[0] + (dx / d) * INSET_M, from[1] + (dy / d) * INSET_M];
}

function doorStandPoint(scene: Scene, polygon: readonly P2[], c: P2): [number, number] | null {
  for (const o of scene.openings ?? []) {
    if (o.kind !== "door") continue;
    const w = (scene.walls ?? []).find((x) => x.id === o.wall_id);
    if (w === undefined) continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (len === 0) continue;
    const mid = o.offset_m + o.width_m / 2;
    const door: P2 = [w.a[0] + ((w.b[0] - w.a[0]) / len) * mid, w.a[1] + ((w.b[1] - w.a[1]) / len) * mid];
    const bounds = polygon.some((p, i) => distToSegment(door, p, polygon[(i + 1) % polygon.length]) < 0.3);
    if (bounds) return inward(door, c);
  }
  return null;
}

function longestWallStandPoint(polygon: readonly P2[], c: P2): [number, number] {
  let best = -1;
  let stand: [number, number] = [c[0], c[1]];
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len <= best) return;
    best = len;
    stand = inward([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], c);
  });
  return stand;
}

/** Corner far from the views already taken: the one whose nearest taken view is farthest away. */
function farthestCorner(polygon: readonly P2[], c: P2, taken: readonly P2[]): [number, number] {
  let best = -1;
  let spot: [number, number] = [c[0], c[1]];
  for (const p of polygon) {
    const corner = inward(p, c);
    const nearest = Math.min(...taken.map((t) => Math.hypot(t[0] - corner[0], t[1] - corner[1])));
    if (nearest > best) {
      best = nearest;
      spot = corner;
    }
  }
  return spot;
}

/** Camera for one room, or null when the room is unknown. Door first; otherwise the midpoint of the longest wall. */
export function guideCamera(scene: Scene, roomId: string): GuideCamera | null {
  const room = (scene.rooms ?? []).find((r) => r.id === roomId);
  if (room === undefined || room.polygon.length < 3) return null;
  const polygon = room.polygon as readonly P2[];
  const c = centroid(polygon);
  const eye = doorStandPoint(scene, polygon, c) ?? longestWallStandPoint(polygon, c);
  return { position: [eye[0], eye[1], GUIDE_EYE_HEIGHT_M], target: [c[0], c[1], LOOK_HEIGHT_M], fovDeg: GUIDE_FOV_DEG };
}

/** The door view plus two views from the corners farthest from it, all aimed at the room center. Empty for an unknown room. */
export function guideCameras(scene: Scene, roomId: string): GuideCamera[] {
  const first = guideCamera(scene, roomId);
  if (first === null) return [];
  const polygon = (scene.rooms ?? []).find((r) => r.id === roomId)!.polygon as readonly P2[];
  const c = centroid(polygon);
  const spots: P2[] = [[first.position[0], first.position[1]]];
  spots.push(farthestCorner(polygon, c, spots));
  spots.push(farthestCorner(polygon, c, spots));
  return spots.map((s) => ({ ...first, position: [s[0], s[1], GUIDE_EYE_HEIGHT_M] }));
}
