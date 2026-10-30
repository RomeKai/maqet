import type { Scene } from "../scene/types";

type Pt = readonly [number, number];

function shoelace(points: readonly Pt[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    sum += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(sum) / 2;
}

/** Follow walls end to start into one loop of vertices; null when the walls do not close. */
function wallLoop(scene: Scene): Pt[] | null {
  const walls = [...(scene.walls ?? [])];
  if (walls.length < 3) return null;
  const close = (a: Pt, b: Pt): boolean => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05;
  const first = walls.shift()!;
  const loop: Pt[] = [first.a, first.b];
  while (walls.length > 0) {
    const tail = loop[loop.length - 1]!;
    const i = walls.findIndex((w) => close(w.a, tail) || close(w.b, tail));
    if (i < 0) return null;
    const w = walls.splice(i, 1)[0]!;
    loop.push(close(w.a, tail) ? w.b : w.a);
  }
  if (!close(loop[0]!, loop[loop.length - 1]!)) return null;
  return loop.slice(0, -1);
}

/** Floor area in m²: the rooms when present, else the closed wall loop. */
export function floorAreaM2(scene: Scene): number | null {
  const rooms = (scene.rooms ?? []).filter((r) => (r.polygon ?? []).length >= 3);
  if (rooms.length > 0) return rooms.reduce((s, r) => s + shoelace(r.polygon as Pt[]), 0);
  const loop = wallLoop(scene);
  if (loop === null) return null;
  const area = shoelace(loop);
  return area > 0 ? area : null;
}
