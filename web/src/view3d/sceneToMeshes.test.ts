import { describe, expect, it } from "vitest";
import {
  cameraForBoundingBox,
  floorMesh,
  planToThree,
  sceneBoundingBox,
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

  it("door in the middle splits the run into 2 segments plus lintel", () => {
    const sc = scene({ walls: [wall()], openings: [opening()] });
    const { walls } = sceneToMeshes(sc);
    // 2 side segments + lintel above door
    expect(walls).toHaveLength(3);
    const sides = walls.filter((w) => !w.id.includes("lintel") && !w.id.includes("sill"));
    expect(sides).toHaveLength(2);
    const total = sides[0].size[0] + sides[1].size[0];
    expect(total).toBeCloseTo(4 - 0.9, 9);
    expect(sides[0].center[0]).toBeCloseTo(0.5, 9);
    expect(sides[1].center[0]).toBeCloseTo(2.95, 9);
    const lintel = walls.find((w) => w.id.includes("lintel"));
    expect(lintel).toBeDefined();
  });

  it("opening at the edge leaves a single segment plus lintel", () => {
    const sc = scene({ walls: [wall()], openings: [opening({ offset_m: 0 })] });
    const { walls } = sceneToMeshes(sc);
    const sides = walls.filter((w) => !w.id.includes("lintel") && !w.id.includes("sill"));
    expect(sides).toHaveLength(1);
    expect(sides[0].size[0]).toBeCloseTo(4 - 0.9, 9);
    expect(walls.find((w) => w.id.includes("lintel"))).toBeDefined();
  });

  it("window in the middle splits into 2 sides plus lintel and sill", () => {
    const sc = scene({
      walls: [wall()],
      openings: [opening({ kind: "window", offset_m: 1, width_m: 1.2, height_m: 1.2, sill_m: 0.9 })],
    });
    const { walls } = sceneToMeshes(sc);
    // 2 sides + lintel + sill = 4
    expect(walls).toHaveLength(4);
    const lintel = walls.find((w) => w.id.includes("lintel"));
    const sill = walls.find((w) => w.id.includes("sill"));
    expect(lintel).toBeDefined();
    expect(sill).toBeDefined();
    // Sill sits at 0.45m center (0.9/2), lintel at 2.35m (2.1 + 0.5/2)
    expect(sill!.center[2]).toBeCloseTo(0.45, 9);
    expect(lintel!.center[2]).toBeCloseTo(2.35, 9);
    expect(sill!.size[2]).toBeCloseTo(0.9, 9);
    expect(lintel!.size[2]).toBeCloseTo(0.5, 9);
  });

  it("door has lintel but no sill; window has both", () => {
    const doorScene = scene({ walls: [wall()], openings: [opening({ kind: "door", height_m: 2.0, sill_m: null })] });
    const winScene = scene({ walls: [wall()], openings: [opening({ kind: "window", height_m: 1.2, sill_m: 0.9 })] });
    const doorWalls = sceneToMeshes(doorScene).walls;
    const winWalls = sceneToMeshes(winScene).walls;
    expect(doorWalls.some((w) => w.id.includes("lintel"))).toBe(true);
    expect(doorWalls.some((w) => w.id.includes("sill"))).toBe(false);
    expect(winWalls.some((w) => w.id.includes("lintel"))).toBe(true);
    expect(winWalls.some((w) => w.id.includes("sill"))).toBe(true);
  });

  it("heights: wall override, scene ceiling, global default", () => {
    expect(wallHeightM(wall({ height_m: 3 }), scene())).toBe(3);
    expect(wallHeightM(wall(), scene({ ceiling_height_m: 2.4 }))).toBe(2.4);
    expect(wallHeightM(wall(), scene({ ceiling_height_m: undefined }))).toBe(2.6);
  });

  it("empty scene maps to empty meshes", () => {
    expect(sceneToMeshes(scene())).toEqual({ walls: [], floors: [], openings: [] });
    expect(sceneToMeshes({ id: "bare" })).toEqual({ walls: [], floors: [], openings: [] });
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
    // w1: 1 solid, w2: 2 sides + lintel = 3, total 4
    expect(walls).toHaveLength(4);
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

describe("sceneBoundingBox", () => {
  it("empty scene yields a null bbox", () => {
    expect(sceneBoundingBox(scene())).toBeNull();
    expect(sceneBoundingBox({ id: "bare" })).toBeNull();
  });

  it("4x3 room: bbox spans walls plan + thickness and ceiling height", () => {
    const sc = scene({
      ceiling_height_m: 2.6,
      walls: [
        wall({ id: "south", a: [0, 0], b: [4, 0] }),
        wall({ id: "north", a: [0, 3], b: [4, 3] }),
        wall({ id: "west", a: [0, 0], b: [0, 3], kind: "interior" }),
        wall({ id: "east", a: [4, 0], b: [4, 3], kind: "interior" }),
      ],
    });
    const bbox = sceneBoundingBox(sc);
    expect(bbox).not.toBeNull();
    // Wall centerlines run 0..4 x 0..3, expanded by half thickness (0.1);
    // z runs 0..2.6 (scene ceiling).
    expect(bbox!.min).toEqual([-0.1, -0.1, 0]);
    expect(bbox!.max).toEqual([4.1, 3.1, 2.6]);
  });
});

describe("cameraForBoundingBox", () => {
  it("empty scene falls back to the default iso view", () => {
    const cam = cameraForBoundingBox(null);
    expect(cam.target).toEqual([0, 0, 0]);
    expect(cam.position).toEqual([6, 6, 6]);
  });

  it("4x3 room: target is the bbox center, camera is iso and elevated", () => {
    const bbox = {
      min: [-0.1, -0.1, 0] as [number, number, number],
      max: [4.1, 3.1, 2.6] as [number, number, number],
    };
    const cam = cameraForBoundingBox(bbox);
    // Target = bbox center.
    expect(cam.target[0]).toBeCloseTo(2, 9);
    expect(cam.target[1]).toBeCloseTo(1.5, 9);
    expect(cam.target[2]).toBeCloseTo(1.3, 9);
    // Iso direction: equal x/y offsets, camera above the target.
    expect(cam.position[0] - cam.target[0]).toBeCloseTo(
      cam.position[1] - cam.target[1],
      9,
    );
    expect(cam.position[2]).toBeGreaterThan(cam.target[2]);
    // Fits the bbox sphere at fov 50 with headroom: distance from target is
    // at least radius / sin(25°), so every corner is inside the frustum.
    const dx = bbox.max[0] - bbox.min[0];
    const dy = bbox.max[1] - bbox.min[1];
    const dz = bbox.max[2] - bbox.min[2];
    const radius = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2;
    const dist = Math.hypot(
      cam.position[0] - cam.target[0],
      cam.position[1] - cam.target[1],
      cam.position[2] - cam.target[2],
    );
    expect(dist).toBeGreaterThan(radius / Math.sin((25 * Math.PI) / 180));
  });

  it("narrow phone viewport pushes the camera further out", () => {
    const bbox = {
      min: [-0.1, -0.1, 0] as [number, number, number],
      max: [4.1, 3.1, 2.6] as [number, number, number],
    };
    const square = cameraForBoundingBox(bbox);
    const portrait = cameraForBoundingBox(bbox, { width: 390, height: 844 });
    const distOf = (cam: {
      position: readonly [number, number, number];
      target: readonly [number, number, number];
    }): number =>
      Math.hypot(
        cam.position[0] - cam.target[0],
        cam.position[1] - cam.target[1],
        cam.position[2] - cam.target[2],
      );
    // Portrait horizontal fov is tighter, so the fit distance must grow.
    expect(distOf(portrait)).toBeGreaterThan(distOf(square));
    // Target is unchanged — only the distance adapts.
    expect(portrait.target).toEqual(square.target);
  });
});

describe("wall renderer mapping (plan -> three.js Y-up)", () => {
  /**
   * World-space center of a wall-segment end, the way the renderer places
   * it: segment center via planToThree, length axis rotated about +Y by
   * rotationZ (the same angle as the plan rotation about Z), end at
   * +/- length/2 along that axis. Mirrors SceneView's mesh transform so a
   * mapping regression shows here, without WebGL.
   */
  function endWorld(
    seg: { center: readonly [number, number, number]; size: readonly [number, number, number]; rotationZ: number },
    sign: 1 | -1,
  ): readonly [number, number, number] {
    const [cx, cy, cz] = planToThree([seg.center[0], seg.center[1]], seg.center[2]);
    const half = (seg.size[0] / 2) * sign;
    // three.js rotation about +Y by rotationZ applied to (half, 0, 0).
    const cos = Math.cos(seg.rotationZ);
    const sin = Math.sin(seg.rotationZ);
    return [cx + half * cos, cy, cz - half * sin];
  }

  it("an L of two walls sharing a corner meets in world space", () => {
    const s = scene({
      walls: [
        wall({ id: "w1", a: [0, 0], b: [4, 0] }),
        wall({ id: "w2", a: [4, 0], b: [4, 3] }),
      ],
    });
    const segs = s.walls!.flatMap((w) => wallSegments(w, s));
    expect(segs).toHaveLength(2);
    // w1's b-end and w2's a-end share plan corner [4, 0]: their world
    // end-centers must coincide (within wall thickness, i.e. exactly here).
    const end1 = endWorld(segs[0]!, 1);
    const end2 = endWorld(segs[1]!, -1);
    const gap = Math.hypot(end1[0] - end2[0], end1[1] - end2[1], end1[2] - end2[2]);
    expect(gap).toBeLessThan(0.2);
  });

  it("a diagonal wall keeps its plan length in world space", () => {
    const s = scene({ walls: [wall({ id: "w1", a: [0, 0], b: [3, 4] })] });
    const segs = s.walls!.flatMap((w) => wallSegments(w, s));
    expect(segs).toHaveLength(1);
    const a = endWorld(segs[0]!, -1);
    const b = endWorld(segs[0]!, 1);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])).toBeCloseTo(5, 9);
  });
});
