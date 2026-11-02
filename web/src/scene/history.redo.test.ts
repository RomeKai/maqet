import { describe, expect, it } from "vitest";
import { SceneHistory, createEmptyScene } from "./store";
import type { Wall } from "./types";

const w1: Wall = { id: "w1", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" };
const w2: Wall = { id: "w2", a: [4, 0], b: [4, 3], thickness_m: 0.2, kind: "exterior" };

describe("SceneHistory redo (E2E-006)", () => {
  it("starts with nothing to redo", () => {
    const h = new SceneHistory(createEmptyScene());
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBe(h.scene);
  });

  it("redoes what undo took back, one step at a time", () => {
    const h = new SceneHistory(createEmptyScene());
    h.apply({ type: "addWall", wall: w1 });
    h.apply({ type: "addWall", wall: w2 });
    h.undo();
    h.undo();
    expect(h.scene.walls ?? []).toHaveLength(0);
    expect(h.canRedo).toBe(true);
    expect(h.redo().walls).toHaveLength(1);
    expect(h.redo().walls).toHaveLength(2);
    expect(h.canRedo).toBe(false);
    expect(h.canUndo).toBe(true);
  });

  it("a new edit after an undo drops the redo branch", () => {
    const h = new SceneHistory(createEmptyScene());
    h.apply({ type: "addWall", wall: w1 });
    h.undo();
    h.apply({ type: "addWall", wall: w2 });
    expect(h.canRedo).toBe(false);
    expect(h.scene.walls?.map((w) => w.id)).toEqual(["w2"]);
  });

  it("restore() (reset to sketch reading) drops the redo branch, and undo still reverts it", () => {
    const h = new SceneHistory(createEmptyScene());
    h.apply({ type: "addWall", wall: w1 });
    h.undo();
    const sketch = { ...createEmptyScene(), walls: [w2] };
    h.restore(sketch);
    expect(h.canRedo).toBe(false);
    h.undo();
    expect(h.canRedo).toBe(true);
    expect(h.redo().walls?.map((w) => w.id)).toEqual(["w2"]);
  });

  it("reset() clears both stacks", () => {
    const h = new SceneHistory(createEmptyScene());
    h.apply({ type: "addWall", wall: w1 });
    h.undo();
    h.reset(createEmptyScene());
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});
