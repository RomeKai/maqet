import { describe, expect, it } from "vitest";
import {
  chainCornersToWalls,
  distanceM,
  emptyCornerTrace,
  pairCornersToNewWall,
  pairCornersToWallUpdate,
  shouldCloseRoom,
  traceCornerTap,
  wallLengthFromCorners,
  type CornerTrace,
  type Vec3,
} from "./cornerMath";
import type { Scene, Wall } from "../scene/types";
import { applySceneOp } from "../scene/store";
import { wallHeightM } from "../view3d/sceneToMeshes";

describe("cornerMath", () => {
  it("computes a 3-4-5 triangle as 5m", () => {
    // Floor-plane 3-4-5: the 4 m run is on z (device: toward viewer), not y
    // (up) — tap height never counts toward wall length.
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [3, 0, 4];
    expect(distanceM(a, b)).toBeCloseTo(5, 9);
    expect(wallLengthFromCorners(a, b)).toBeCloseTo(5, 9);
  });

  it("rejects zero-length pairs", () => {
    const a: Vec3 = [1, 2, 0];
    expect(wallLengthFromCorners(a, [1, 2, 0])).toBeNull();
    expect(distanceM(a, [1, 2, 0])).toBe(0);
  });

  it("rejects NaN and Infinity components", () => {
    const bad: Vec3[] = [
      [NaN, 0, 0],
      [0, Infinity, 0],
      [0, 0, -Infinity],
    ];
    for (const b of bad) {
      expect(wallLengthFromCorners([0, 0, 0], b)).toBeNull();
      expect(Number.isFinite(distanceM([0, 0, 0], b))).toBe(false);
    }
  });

  it("pairCornersToWallUpdate returns length + measured_ar provenance", () => {
    const update = pairCornersToWallUpdate(
      [
        [0, 0, 0],
        [3, 0, 4],
      ],
      "w7",
    );
    expect(update).not.toBeNull();
    expect(update?.wallId).toBe("w7");
    expect(update?.lengthM).toBeCloseTo(5, 9);
    expect(update?.provenance).toBe("measured_ar");
  });

  it("pairCornersToNewWall returns null for degenerate pairs", () => {
    expect(
      pairCornersToWallUpdate(
        [
          [0, 0, 0],
          [0, 0, 0],
        ],
        "w7",
      ),
    ).toBeNull();
  });

  it("tap height never leaks into wall geometry (y=0 vs y=1.2)", () => {
    // Acceptance criterion: corners tapped at different heights produce the
    // SAME wall — same plan endpoints, same length, same height. Fails while
    // length math uses 3D Euclidean (sqrt(9 + 1.44 + 16) ~= 5.14, not 5).
    const low = pairCornersToNewWall(
      [
        [0, 0, 0],
        [3, 0, 4],
      ],
      "wY",
    );
    const high = pairCornersToNewWall(
      [
        [0, 1.2, 0],
        [3, 0.9, 4],
      ],
      "wY",
    );
    expect(low).not.toBeNull();
    expect(high).not.toBeNull();
    expect(high?.wall.a).toEqual(low?.wall.a);
    expect(high?.wall.b).toEqual(low?.wall.b);
    expect(high?.lengthM).toBeCloseTo(5, 9);
    expect(high?.lengthM).toBeCloseTo(low?.lengthM ?? NaN, 9);
    expect(high?.wall.measured_length_m).toBeCloseTo(5, 9);
    // Height never comes from taps: no override is stored, so the ceiling
    // default wins (server/scene/rules.py: DEFAULT_CEILING_HEIGHT_M = 2.6).
    expect(low?.wall.height_m).toBeUndefined();
    expect(high?.wall.height_m).toBeUndefined();
    expect(
      wallHeightM(high!.wall, { id: "s", ceiling_height_m: 2.6 } as Scene),
    ).toBe(2.6);
  });

  it("wallLengthFromCorners ignores tap height", () => {
    expect(wallLengthFromCorners([0, 0, 0], [3, 1.2, 4])).toBeCloseTo(5, 9);
  });

  it("pairCornersToNewWall projects floor taps to a measured_ar wall", () => {
    // Floor taps in device space [x right, y up, z toward viewer]; plan is
    // [x east, y north] = [x, -z] (inverse of the SceneView mapping).
    const created = pairCornersToNewWall(
      [
        [0, 0, 0],
        [3, 0, 4],
      ],
      "w9",
    );
    expect(created).not.toBeNull();
    expect(created?.lengthM).toBeCloseTo(5, 9);
    expect(created?.wall.id).toBe("w9");
    expect(created?.wall.a).toEqual([0, -0]);
    expect(created?.wall.b).toEqual([3, -4]);
    expect(created?.wall.provenance).toBe("measured_ar");
    expect(created?.wall.measured_length_m).toBeCloseTo(5, 9);
  });

  it("pairCornersToNewWall returns null for degenerate pairs", () => {
    expect(
      pairCornersToNewWall(
        [
          [1, 1, 1],
          [1, 1, 1],
        ],
        "w9",
      ),
    ).toBeNull();
  });

  it("chained taps share endpoints: 4 taps = 4 connected walls", () => {
    // A 4x3 m room traced corner to corner: every wall starts where the
    // previous one ended (stable ids wall-1, wall-2, ...).
    const taps: Vec3[] = [
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, -3],
      [0, 0, -3],
    ];
    const chain = chainCornersToWalls(taps);
    expect(chain.closed).toBe(false);
    expect(chain.walls).toHaveLength(3);
    expect(chain.walls.map((w) => w.id)).toEqual(["wall-1", "wall-2", "wall-3"]);
    for (let i = 1; i < chain.walls.length; i++) {
      expect(chain.walls[i]!.a).toEqual(chain.walls[i - 1]!.b);
    }
    expect(chain.walls.map((w) => w.measured_length_m)).toEqual([4, 3, 4]);
    expect(chain.walls.every((w) => w.provenance === "measured_ar")).toBe(true);
  });

  it("a tap within CLOSE_M of the first corner closes the room", () => {
    const first: Vec3 = [0, 0, 0];
    const near: Vec3 = [0.1, 0, 0.05]; // ~11 cm away
    expect(shouldCloseRoom(first, near)).toBe(true);
    const far: Vec3 = [0.2, 0, 0]; // 20 cm away
    expect(shouldCloseRoom(first, far)).toBe(false);
  });

  it("chainCornersToWalls closes the loop and needs at least 3 walls", () => {
    const taps: Vec3[] = [
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, -3],
      [0, 0, -3],
    ];
    const closing: Vec3 = [0.08, 0, 0.06]; // ~10 cm from the first corner
    const chain = chainCornersToWalls([...taps, closing]);
    expect(chain.closed).toBe(true);
    expect(chain.walls).toHaveLength(4);
    expect(chain.walls[3]!.b).toEqual(chain.walls[0]!.a);
    expect(chain.walls.map((w) => w.measured_length_m)).toEqual([
      4, 3, 4, 3,
    ]);

    // Two walls cannot close a room: the closing tap is kept as a new corner.
    const short = chainCornersToWalls([
      [0, 0, 0],
      [4, 0, 0],
      [0.05, 0, 0.02],
    ]);
    expect(short.closed).toBe(false);
    expect(short.walls).toHaveLength(1);
  });

  it("traceCornerTap emits one wall per tap with stable ids", () => {
    // 4 taps trace 3 connected walls sharing endpoints (ADR-025 Mode A
    // empty-start: each new tap completes the segment ending at it).
    const taps: Vec3[] = [
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, -3],
      [0, 0, -3],
    ];
    let trace: CornerTrace = emptyCornerTrace();
    const emitted: Wall[] = [];
    for (const tap of taps) {
      trace = traceCornerTap(trace, tap, 0);
      if (trace.lastWall !== null) emitted.push(trace.lastWall);
      expect(trace.closed).toBe(false);
    }
    expect(emitted.map((w) => w.id)).toEqual(["wall-1", "wall-2", "wall-3"]);
    expect(emitted.map((w) => w.measured_length_m)).toEqual([4, 3, 4]);
    for (let i = 1; i < emitted.length; i++) {
      expect(emitted[i]!.a).toEqual(emitted[i - 1]!.b);
    }
    expect(emitted.every((w) => w.provenance === "measured_ar")).toBe(true);
  });

  it("traceCornerTap closes the loop on a near-first tap, no stub wall", () => {
    let trace: CornerTrace = emptyCornerTrace();
    const taps: Vec3[] = [
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, -3],
      [0, 0, -3],
    ];
    for (const tap of taps) trace = traceCornerTap(trace, tap, 0);
    // 4 walls traced needs length math: replay to count emitted walls.
    trace = emptyCornerTrace();
    const walls: Wall[] = [];
    for (const tap of taps) {
      trace = traceCornerTap(trace, tap, 0);
      if (trace.lastWall !== null) walls.push(trace.lastWall);
    }
    expect(walls).toHaveLength(3);
    // Closing tap within CLOSE_ROOM_M of the first corner: loop, no stub.
    trace = traceCornerTap(trace, [0.08, 0, 0.06], 0);
    expect(trace.closed).toBe(true);
    expect(trace.lastWall).not.toBeNull();
    expect(trace.lastWall!.id).toBe("wall-4");
    expect(trace.lastWall!.b).toEqual(walls[0]!.a);
    expect(trace.lastWall!.measured_length_m).toBeCloseTo(3, 9);
  });

  it("traceCornerTap drops an early close-tap (<3 walls), no wall emitted", () => {
    let trace: CornerTrace = emptyCornerTrace();
    trace = traceCornerTap(trace, [0, 0, 0], 0);
    trace = traceCornerTap(trace, [4, 0, 0], 0);
    expect(trace.lastWall?.id).toBe("wall-1");
    // Tap lands ~5 cm from the first corner but only 1 wall traced: dropped.
    trace = traceCornerTap(trace, [0.05, 0, 0.02], 0);
    expect(trace.closed).toBe(false);
    expect(trace.lastWall).toBeNull();
    expect(trace.corners).toHaveLength(2);
  });

  it("traceCornerTap offsets stable ids by the existing scene wall count", () => {
    let trace: CornerTrace = emptyCornerTrace();
    trace = traceCornerTap(trace, [0, 0, 0], 2);
    trace = traceCornerTap(trace, [4, 0, 0], 2);
    expect(trace.lastWall?.id).toBe("wall-3");
  });

  it("tracing one closed room yields N walls with shared endpoints, no duplicates", () => {
    // The full production path: traceCornerTap (one emission per tap, like
    // ArMeasure's appendCorner) + applySceneOp(addWall) onto the running
    // scene. The 3D view showed duplicated overlapping walls — this test
    // pins the contract: wall[i].b equals wall[i+1].a, the loop closes, and
    // no two walls share the same (a,b) pair.
    let trace: CornerTrace = emptyCornerTrace();
    let scene: Scene = { id: "s", walls: [] };
    const taps: Vec3[] = [
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, -3],
      [0, 0, -3],
    ];
    for (const tap of taps) {
      trace = traceCornerTap(trace, tap, scene.walls?.length ?? 0);
      if (trace.lastWall !== null) {
        scene = applySceneOp(scene, { type: "addWall", wall: trace.lastWall });
      }
    }
    trace = traceCornerTap(trace, [0.08, 0, 0.06], scene.walls?.length ?? 0);
    expect(trace.closed).toBe(true);
    if (trace.lastWall !== null) {
      scene = applySceneOp(scene, { type: "addWall", wall: trace.lastWall });
    }
    const walls = scene.walls ?? [];
    expect(walls).toHaveLength(4);
    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i]!;
      const next = walls[(i + 1) % walls.length]!;
      expect(wall.b).toEqual(next.a);
    }
    const keys = walls.map((w) => `${w.a.join(",")}>${w.b.join(",")}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
