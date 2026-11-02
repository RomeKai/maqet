import { describe, expect, it } from "vitest";
import { applySceneOp } from "../scene/store";
import type { Scene, Wall } from "../scene/types";
import { mergeCaptureBeside } from "./addToProject";

const wall = (id: string, a: [number, number], b: [number, number]): Wall => ({ id, a, b, thickness_m: 0.2, kind: "exterior" });
const rect = (id: string, w: number, h: number, ox = 0, oy = 0): Scene => ({
  id,
  walls: [
    wall("w1", [ox, oy], [ox + w, oy]),
    wall("w2", [ox + w, oy], [ox + w, oy + h]),
    wall("w3", [ox + w, oy + h], [ox, oy + h]),
    wall("w4", [ox, oy + h], [ox, oy]),
  ],
  openings: [{ id: "o1", wall_id: "w1", kind: "door", offset_m: 0.5, width_m: 0.9, height_m: 2.05 }],
  rooms: [{ id: "room-1", name: "Room 1", polygon: [[ox, oy], [ox + w, oy], [ox + w, oy + h], [ox, oy + h]] }],
});

function bbox(scene: Scene, ids: (id: string) => boolean): { minX: number; maxX: number; minY: number; maxY: number } {
  const pts = (scene.walls ?? []).filter((w) => ids(w.id)).flatMap((w) => [w.a, w.b]);
  return {
    minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])),
    minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])),
  };
}

describe("add an AR capture beside the existing project", () => {
  // The AR frame has its own origin: the new room sits on top of the old one when taken as is.
  const existing = rect("home", 3, 8);
  const captured = rect("ar", 4, 4, 0.5, 1);
  const merged = applySceneOp(existing, mergeCaptureBeside(existing, captured));
  const oldIds = new Set((existing.walls ?? []).map((w) => w.id));

  it("keeps every existing wall untouched and adds the new ones with fresh ids", () => {
    expect(merged.walls).toHaveLength(8);
    expect(new Set((merged.walls ?? []).map((w) => w.id)).size).toBe(8);
    for (const w of existing.walls ?? []) expect(merged.walls).toContainEqual(w);
  });

  it("never overlaps the existing footprint, clear of the wall thickness", () => {
    const old = bbox(merged, (id) => oldIds.has(id));
    const added = bbox(merged, (id) => !oldIds.has(id));
    expect(added.minX).toBeGreaterThanOrEqual(old.maxX + 0.4);
    // Same size and shape, only translated.
    expect(added.maxX - added.minX).toBeCloseTo(4);
    expect(added.maxY - added.minY).toBeCloseTo(4);
  });

  it("moves openings and the room with their walls and re-points the references", () => {
    expect(merged.openings).toHaveLength(2);
    const added = (merged.openings ?? []).find((o) => o.id !== "o1");
    const owner = (merged.walls ?? []).find((w) => w.id === added?.wall_id);
    expect(owner && !oldIds.has(owner.id)).toBe(true);
    expect(added?.width_m).toBe(0.9);
    expect(merged.rooms).toHaveLength(2);
    const room = (merged.rooms ?? []).find((r) => r.id !== "room-1");
    const roomMinX = Math.min(...(room?.polygon ?? []).map((p) => p[0]));
    expect(roomMinX).toBeGreaterThanOrEqual(3 + 0.4);
  });

  it("is one batch op (a single undo)", () => {
    expect(mergeCaptureBeside(existing, captured).type).toBe("batch");
  });
});
