import { describe, expect, it } from "vitest";
import { weldOp, snapToEndpoint, WELD_TOL_M } from "./weld";
import { applySceneOp, createEmptyScene, SceneHistory } from "../scene/store";
import type { Scene, Wall } from "../scene/types";

const wall = (id: string, a: [number, number], b: [number, number]): Wall => ({ id, a, b, thickness_m: 0.2, kind: "exterior" });

function openBox(): Scene {
  return {
    ...createEmptyScene(),
    walls: [
      wall("w1", [0, 0], [4, 0.05]),
      wall("w2", [4.08, 0], [4, 3]),
      wall("w3", [4.02, 3.1], [0, 3]),
      wall("w4", [0.1, 2.95], [0.03, 0.02]),
    ],
  };
}

describe("weldOp", () => {
  it("merges endpoints closer than 0.15 m into one shared vertex (average)", () => {
    expect(WELD_TOL_M).toBe(0.15);
    const op = weldOp(openBox());
    expect(op).not.toBeNull();
    const s = applySceneOp(openBox(), op!);
    const w = (id: string) => s.walls!.find((x) => x.id === id)!;
    expect(w("w1").b).toEqual(w("w2").a);
    expect(w("w1").b[0]).toBeCloseTo(4.04);
    expect(w("w1").b[1]).toBeCloseTo(0.025);
    expect(w("w2").b).toEqual(w("w3").a);
    expect(w("w3").b).toEqual(w("w4").a);
    expect(w("w4").b).toEqual(w("w1").a);
  });
  it("is one undo step", () => {
    const h = new SceneHistory(openBox());
    h.apply(weldOp(openBox())!);
    expect(h.undo().walls![0]!.b).toEqual([4, 0.05]);
  });
  it("leaves far endpoints and already-welded scenes alone", () => {
    const s: Scene = { ...createEmptyScene(), walls: [wall("a", [0, 0], [1, 0]), wall("b", [1, 0], [1, 1]), wall("c", [3, 3], [4, 4])] };
    expect(weldOp(s)).toBeNull();
  });
});

describe("snapToEndpoint", () => {
  const walls = [wall("w1", [0, 0], [4, 0]), wall("w2", [4, 0], [4, 3])];
  const toDisplay = (x: number, y: number) => ({ x: x * 100, y: y * 100 });
  it("snaps to an endpoint within the tolerance (display units)", () => {
    expect(snapToEndpoint([4.1, 0.1], walls, toDisplay, 24)).toEqual([4, 0]);
  });
  it("does not snap beyond the tolerance", () => {
    expect(snapToEndpoint([4.3, 0.3], walls, toDisplay, 24)).toBeNull();
  });
  it("ignores excluded endpoints (the ones being dragged)", () => {
    expect(snapToEndpoint([4.1, 0], walls, toDisplay, 24, [{ wallId: "w1", end: "b" }, { wallId: "w2", end: "a" }])).toBeNull();
  });
});

import { clusterHandles } from "./CornerEditor";
import { sceneToMeshes } from "../view3d/sceneToMeshes";

describe("after welding", () => {
  const welded = applySceneOp(openBox(), weldOp(openBox())!);
  it("shows ONE handle per shared vertex, carrying both walls", () => {
    const handles = clusterHandles(welded.walls!, (x, y) => ({ x, y }), null, 0.001);
    expect(handles).toHaveLength(4);
    for (const h of handles) expect(h.members).toHaveLength(2);
  });
  it("one shared-corner drag moves every attached endpoint in one undo", () => {
    const h = new SceneHistory(welded);
    const corner = clusterHandles(welded.walls!, (x, y) => ({ x, y }), null, 0.001)[0]!;
    h.apply({ type: "batch", ops: corner.members.map((m) => ({ type: "moveWallEndpoint" as const, wallId: m.wallId, end: m.end, point: [9, 9] as [number, number] })) });
    const moved = h.scene.walls!.flatMap((w) => [w.a, w.b]).filter((p) => p[0] === 9 && p[1] === 9);
    expect(moved).toHaveLength(2);
    h.undo();
    expect(h.scene).toBe(welded);
  });
  it("3D corner extension now reaches every corner (shared vertices)", () => {
    const { walls } = sceneToMeshes(welded);
    // every wall is extended at both ends by half the neighbour thickness (0.1)
    for (const w of welded.walls!) {
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const seg = walls.find((s) => s.wallId === w.id)!;
      expect(seg.size[0]).toBeCloseTo(len + 0.2);
    }
  });
});
