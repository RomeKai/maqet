import { describe, expect, it } from "vitest";
import {
  floorMesh,
  sceneToMeshes,
  solidIntervalsM,
  wallHeightM,
  wallRunLengthM,
  wallSegments,
} from "./sceneToMeshes";
import type { Opening, Scene, Wall } from "../scene/types";

const EPS = 1e-9;

function closeTo(a: number, b: number): boolean {
  return Math.abs(a - b) < EPS;
}

function wall(over: Partial<Wall> = {}): Wall {
  return {
    id: "w1",
    a: [0, 0],
    b: [4, 0],
    thickness_m: 0.2,
    kind: "exterior",
    ...over,
  };
}

function scene(over: Partial<Scene> = {}): Scene {
  return {
    id: "s",
    version: 0,
    units: "m",
    scale_confirmed: true,
    ceiling_height_m: 2.6,
    walls: [],
    openings: [],
    rooms: [],
    ...over,
  };
}

function opening(over: Partial<Opening> = {}): Opening {
  return {
    id: "o1",
    wall_id: "w1",
    kind: "door",
    offset_m: 1,
    width_m: 0.9,
    height_m: 2.1,
    sill_m: null,
    ...over,
  };
}

describe("sceneToMeshes", () => {
  it("axis-aligned wall: position, size, rotation", () => {
    const segs = wallSegments(wall(), scene());
    expect(segs).toHaveLength(1);
    const [s] = segs;
    expect(s.center).toEqual([2, 0, 1.3]);
    expect(s.size).toEqual([4, 0.2, 2.6]);
    expect(closeTo(s.rotationZ, 0)).toBe(true);
    expect(s.kind).toBe("wall-segment");
    expect(s.wallId).toBe("w1");
    expect(s.wallKind).toBe("exterior");
  });

  it("diagonal wall: angle is atan2(dy, dx)", () => {
    const segs = wallSegments(wall({ a: [1, 1], b: [4, 5] }), scene());
    expect(segs).toHaveLength(1);
    const len = 5;
    expect(closeTo(wallRunLengthM(wall({ a: [1, 1], b: [4, 5] })), len)).toBe(true);
    const [s] = segs;
    expect(s.size[0]).toBeCloseTo(len, 9);
    expect(closeTo(s.rotationZ, Math.atan2(4, 3))).toBe(true);
    expect(s.center[0]).toBeCloseTo(2.5, 9);
    expect(s.center[1]).toBeCloseTo(3, 9);
    expect(s.center[2]).toBeCloseTo(1.3, 9);
  });

  it("door in the middle splits the run into 2 segments", () => {
    const sc = scene({ walls: [wall()], openings: [opening()] });
    const { walls } = sceneToMeshes(sc);
    expect(walls).toHaveLength(2);
    const total = walls[0].size[0] + walls[1].size[0];
    expect(total).toBeCloseTo(4 - 0.9, 9);
    // First segment runs 0..1, second 1.9..4.
    expect(walls[0].center[0]).toBeCloseTo(0.5, 9);
    expect(walls[1].center[0]).toBeCloseTo(2.95, 9);
  });

  it("opening at the edge leaves a single segment", () => {
    const sc = scene({ walls: [wall()], openings: [opening({ offset_m: 0 })] });
    const { walls } = sceneToMeshes(sc);
    expect(walls).toHaveLength(1);
    expect(walls[0].size[0]).toBeCloseTo(4 - 0.9, 9);
    expect(walls[0].center[0]).toBeCloseTo(0.9 + (4 - 0.9) / 2, 9);
  });

  it("heights: wall override, scene ceiling, global default", () => {
    expect(wallHeightM(wall({ height_m: 3 }), scene())).toBe(3);
    expect(wallHeightM(wall(), scene({ ceiling_height_m: 2.4 }))).toBe(2.4);
    expect(wallHeightM(wall(), scene({ ceiling_height_m: undefined }))).toBe(2.6);
  });

  it("empty scene maps to empty meshes", () => {
    expect(sceneToMeshes(scene())).toEqual({ walls: [], floors: [] });
    expect(sceneToMeshes({ id: "bare" })).toEqual({ walls: [], floors: [] });
  });

  it("invalid opening (offset beyond wall) is ignored", () => {
    const sc = scene({
      walls: [wall()],
      openings: [opening({ offset_m: 99, width_m: 1 })],
    });
    const { walls } = sceneToMeshes(sc);
    expect(walls).toHaveLength(1);
    expect(walls[0].size[0]).toBe(4);
  });

  it("negative-width and zero-width openings are ignored", () => {
    const sc = scene({
      walls: [wall()],
      openings: [opening({ width_m: 0 }), opening({ id: "o2", width_m: -1 })],
    });
    expect(sceneToMeshes(sc).walls).toHaveLength(1);
  });

  it("overlapping openings merge into one hole", () => {
    const got = solidIntervalsM(4, [
      opening({ offset_m: 1, width_m: 1 }),
      opening({ id: "o2", offset_m: 1.5, width_m: 1 }),
    ]);
    expect(got).toHaveLength(2);
    expect(got[0][0]).toBe(0);
    expect(got[0][1]).toBe(1);
    expect(got[1][0]).toBe(2.5);
    expect(got[1][1]).toBe(4);
  });

  it("openings on other walls do not affect this wall", () => {
    const sc = scene({
      walls: [wall(), wall({ id: "w2" })],
      openings: [opening({ wall_id: "w2" })],
    });
    const { walls } = sceneToMeshes(sc);
    expect(walls).toHaveLength(3);
    const w1 = walls.filter((w) => w.wallId === "w1");
    expect(w1).toHaveLength(1);
    expect(w1[0].size[0]).toBe(4);
  });

  it("degenerate walls are skipped, never crash", () => {
    const sc = scene({
      walls: [
        wall({ id: "zero", a: [1, 1], b: [1, 1] }),
        wall({ id: "thin", thickness_m: 0 }),
      ],
    });
    expect(sceneToMeshes(sc).walls).toHaveLength(0);
  });

  it("rooms missing means no floor meshes", () => {
    const sc = scene({ walls: [wall()] });
    const { floors } = sceneToMeshes(sc);
    expect(floors).toHaveLength(0);
  });

  it("room polygon becomes an up-facing floor mesh", () => {
    const room = {
      id: "r1",
      name: "Living",
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ] as [number, number][],
    };
    const floor = floorMesh(room);
    expect(floor).not.toBeNull();
    expect(floor?.id).toBe("r1:floor");
    expect(floor?.roomId).toBe("r1");
    expect(floor?.normal).toEqual([0, 0, 1]);
    expect(floor?.points).toHaveLength(4);
  });

  it("degenerate room (< 3 finite points) yields no floor", () => {
    expect(
      floorMesh({ id: "r", name: "x", polygon: [[0, 0], [1, 1]] }),
    ).toBeNull();
    expect(
      floorMesh({
        id: "r",
        name: "x",
        polygon: [
          [0, 0],
          [NaN, 0],
          [1, 1],
        ] as [number, number][],
      }),
    ).toBeNull();
  });
});
