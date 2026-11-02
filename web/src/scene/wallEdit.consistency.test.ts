import { describe, expect, it } from "vitest";
import { applySceneOp, wallDisplayLengthM, wallGeometryLengthM } from "./store";
import type { Scene } from "./types";

// A closed 3 x 8 m outline whose room polygon was derived from the walls.
const SCENE: Scene = {
  id: "s",
  walls: [
    { id: "w0", a: [0, 0], b: [3, 0], thickness_m: 0.2, kind: "exterior", provenance: "written_on_sketch", measured_length_m: 3 },
    { id: "w1", a: [3, 0], b: [3, 8], thickness_m: 0.2, kind: "exterior", provenance: "written_on_sketch", measured_length_m: 8 },
    { id: "w2", a: [3, 8], b: [0, 8], thickness_m: 0.2, kind: "exterior", provenance: "written_on_sketch", measured_length_m: 3 },
    { id: "w3", a: [0, 8], b: [0, 0], thickness_m: 0.2, kind: "exterior", provenance: "written_on_sketch", measured_length_m: 8 },
  ],
  rooms: [{ id: "room-1", name: "Room 1", polygon: [[0, 0], [3, 0], [3, 8], [0, 8]] }],
};

function area(poly: [number, number][]): number {
  return Math.abs(poly.reduce((s, p, i) => s + p[0] * poly[(i + 1) % poly.length]![1] - poly[(i + 1) % poly.length]![0] * p[1], 0)) / 2;
}

describe("review and Scene agree after a corner moves", () => {
  // Corner (0,8) shared by w2.b and w3.a moves to (0, 10.27).
  const moved = applySceneOp(
    applySceneOp(SCENE, { type: "moveWallEndpoint", wallId: "w2", end: "b", point: [0, 10.27] }),
    { type: "moveWallEndpoint", wallId: "w3", end: "a", point: [0, 10.27] },
  );

  it("the room polygon follows the walls (not the stale 24 m2)", () => {
    const poly = moved.rooms![0]!.polygon;
    const endpoints = moved.walls!.flatMap((w) => [w.a, w.b]);
    for (const v of poly) expect(endpoints.some((p) => Math.hypot(p[0] - v[0], p[1] - v[1]) < 1e-9)).toBe(true);
    expect(area(poly)).toBeCloseTo((3 * (8 + 10.27)) / 2, 2);
    expect(area(poly)).not.toBeCloseTo(24, 0);
  });

  it("a moved wall no longer claims its old written length", () => {
    const w3 = moved.walls!.find((w) => w.id === "w3")!;
    expect(wallGeometryLengthM(w3)).toBeCloseTo(10.27, 2);
    expect(wallDisplayLengthM(w3)).toBeCloseTo(10.27, 2);
    expect(w3.provenance).toBe("estimated");
    expect(w3.measured_length_m ?? null).toBeNull();
  });

  it("an untouched wall keeps its measure", () => {
    const w1 = moved.walls!.find((w) => w.id === "w1")!;
    expect(w1.provenance).toBe("written_on_sketch");
    expect(wallDisplayLengthM(w1)).toBe(8);
  });

  it("the displayed length never contradicts the geometry", () => {
    const stale = { ...SCENE.walls![3]!, b: [0, -2.27] as [number, number] }; // measured 8, geometry 10.27
    expect(wallDisplayLengthM(stale)).toBeCloseTo(10.27, 2);
  });
});
