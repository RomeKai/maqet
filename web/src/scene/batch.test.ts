import { describe, expect, it } from "vitest";
import { SceneHistory, createEmptyScene, applySceneOp, type SceneOp } from "./store";
import type { Wall } from "./types";

const w1: Wall = { id: "w1", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" };
const w2: Wall = { id: "w2", a: [4, 0], b: [4, 3], thickness_m: 0.2, kind: "exterior" };

function seeded(): SceneHistory {
  const h = new SceneHistory(createEmptyScene());
  h.apply({ type: "addWall", wall: w1 });
  h.apply({ type: "addWall", wall: w2 });
  return h;
}

describe("batch op (one corner drag = one undo)", () => {
  const drag: SceneOp = {
    type: "batch",
    ops: [
      { type: "moveWallEndpoint", wallId: "w1", end: "b", point: [5, 0] },
      { type: "moveWallEndpoint", wallId: "w2", end: "a", point: [5, 0] },
    ],
  };
  it("moves both walls of a shared corner", () => {
    const next = applySceneOp(seeded().scene, drag);
    expect(next.walls?.find((w) => w.id === "w1")?.b).toEqual([5, 0]);
    expect(next.walls?.find((w) => w.id === "w2")?.a).toEqual([5, 0]);
  });
  it("undoes with a single Undo", () => {
    const h = seeded();
    h.apply(drag);
    const undone = h.undo();
    expect(undone.walls?.find((w) => w.id === "w1")?.b).toEqual([4, 0]);
    expect(undone.walls?.find((w) => w.id === "w2")?.a).toEqual([4, 0]);
  });
});

describe("SceneHistory.restore", () => {
  it("replaces the scene and can be undone", () => {
    const h = seeded();
    const reading = createEmptyScene("reading");
    h.restore(reading);
    expect(h.scene.id).toBe("reading");
    h.undo();
    expect(h.scene.walls?.length).toBe(2);
  });
});
