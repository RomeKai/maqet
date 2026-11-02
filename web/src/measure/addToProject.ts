import type { SceneOp } from "../scene/store";
import type { Scene } from "../scene/types";

/** Clear space kept between the existing footprint and the added room (more than any wall thickness). */
export const ADD_GAP_M = 1;

function freeIds(taken: Set<string>, prefix: string, count: number): string[] {
  const out: string[] = [];
  for (let n = 1; out.length < count; n++) {
    const id = `${prefix}${n}`;
    if (!taken.has(id)) out.push(id);
  }
  return out;
}

/**
 * An AR capture lives in its own frame (arbitrary origin and heading), so its position relative to the project is
 * unknown. Rather than guess, the captured room is translated (never rotated or resized) to sit beside the existing
 * footprint with a clear gap: disjoint bounding boxes, so overlap is impossible. One batch = one undo.
 */
export function mergeCaptureBeside(existing: Scene, captured: Scene): SceneOp {
  const oldWalls = existing.walls ?? [];
  const newWalls = captured.walls ?? [];
  const xs = (ws: typeof oldWalls) => ws.flatMap((w) => [w.a[0], w.b[0]]);
  const ys = (ws: typeof oldWalls) => ws.flatMap((w) => [w.a[1], w.b[1]]);
  const dx = oldWalls.length === 0 || newWalls.length === 0 ? 0 : Math.max(...xs(oldWalls)) + ADD_GAP_M - Math.min(...xs(newWalls));
  const dy = oldWalls.length === 0 || newWalls.length === 0 ? 0 : Math.min(...ys(oldWalls)) - Math.min(...ys(newWalls));

  const wallIds = freeIds(new Set(oldWalls.map((w) => w.id)), "w", newWalls.length);
  const wallMap = new Map(newWalls.map((w, i) => [w.id, wallIds[i]!]));
  const openings = captured.openings ?? [];
  const openingIds = freeIds(new Set((existing.openings ?? []).map((o) => o.id)), "o", openings.length);
  const rooms = captured.rooms ?? [];
  const roomIds = freeIds(new Set((existing.rooms ?? []).map((r) => r.id)), "room-", rooms.length);
  const roomNumber = (existing.rooms ?? []).length;

  const ops: SceneOp[] = [];
  newWalls.forEach((w) => {
    ops.push({ type: "addWall", wall: { ...w, id: wallMap.get(w.id)!, a: [w.a[0] + dx, w.a[1] + dy], b: [w.b[0] + dx, w.b[1] + dy] } });
  });
  openings.forEach((o, i) => {
    const wallId = wallMap.get(o.wall_id);
    if (wallId !== undefined) ops.push({ type: "markOpening", opening: { ...o, id: openingIds[i]!, wall_id: wallId } });
  });
  rooms.forEach((r, i) => {
    ops.push({
      type: "addRoom",
      room: { ...r, id: roomIds[i]!, name: `Room ${roomNumber + i + 1}`, polygon: r.polygon.map(([x, y]) => [x + dx, y + dy] as [number, number]) },
    });
  });
  return { type: "batch", ops };
}
