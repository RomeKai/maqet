import { describe, expect, it } from "vitest";
import { applySceneOp, createEmptyScene, SceneHistory } from "../scene/store";
import type { Opening, Wall } from "../scene/types";

function wall(over: Partial<Wall> = {}): Wall {
  return {
    id: "w1",
    a: [0, 0],
    b: [3, 0],
    thickness_m: 0.1,
    kind: "interior",
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
    height_m: 2.05,
    ...over,
  };
}

describe("Scene ops", () => {
  it("adds and removes a wall (removing its openings)", () => {
    let scene = createEmptyScene();
    scene = applySceneOp(scene, { type: "addWall", wall: wall() });
    scene = applySceneOp(scene, { type: "markOpening", opening: opening() });
    expect(scene.walls).toHaveLength(1);
    expect(scene.openings).toHaveLength(1);

    scene = applySceneOp(scene, { type: "removeWall", wallId: "w1" });
    expect(scene.walls).toHaveLength(0);
    expect(scene.openings).toHaveLength(0);
  });

  it("moves a wall endpoint", () => {
    let scene = applySceneOp(createEmptyScene(), { type: "addWall", wall: wall() });
    scene = applySceneOp(scene, {
      type: "moveWallEndpoint",
      wallId: "w1",
      end: "b",
      point: [4, 0],
    });
    expect(scene.walls?.[0]?.b).toEqual([4, 0]);
    expect(scene.walls?.[0]?.a).toEqual([0, 0]);
  });

  it("marks a door and a window, then removes the opening", () => {
    let scene = applySceneOp(createEmptyScene(), { type: "addWall", wall: wall() });
    scene = applySceneOp(scene, { type: "markOpening", opening: opening({ id: "o1", kind: "door" }) });
    scene = applySceneOp(scene, {
      type: "markOpening",
      opening: opening({ id: "o2", kind: "window", offset_m: 0.2, width_m: 1.4 }),
    });
    expect(scene.openings).toHaveLength(2);

    scene = applySceneOp(scene, { type: "removeOpening", openingId: "o1" });
    expect(scene.openings?.map((o) => o.id)).toEqual(["o2"]);
  });

  it("bumps the version on every op", () => {
    const scene = applySceneOp(createEmptyScene(), { type: "addWall", wall: wall() });
    expect(scene.version).toBe(1);
  });
});

describe("SceneHistory undo", () => {
  it("undo restores the previous scene", () => {
    const history = new SceneHistory(createEmptyScene());
    history.apply({ type: "addWall", wall: wall() });
    history.apply({ type: "markOpening", opening: opening() });
    expect(history.scene.openings).toHaveLength(1);

    expect(history.canUndo).toBe(true);
    history.undo();
    expect(history.scene.openings).toHaveLength(0);
    expect(history.scene.walls).toHaveLength(1);

    history.undo();
    expect(history.scene.walls).toHaveLength(0);
    expect(history.canUndo).toBe(false);
  });
});
