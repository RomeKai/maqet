import { describe, expect, it } from "vitest";
import { sceneBoundingBox } from "./sceneToMeshes";
import { upperLevelMeshes } from "./upperLevel";
import type { Scene } from "../scene/types";

function scene(over: Partial<Scene> = {}): Scene {
  return {
    id: "s",
    ceiling_height_m: 2.6,
    walls: [{ id: "w1", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" }],
    rooms: [
      { id: "r1", name: "Ground", polygon: [[0, 0], [4, 0], [4, 4], [0, 4]], level: 1 },
      { id: "r2", name: "Upstairs", polygon: [[0, 0], [3, 0], [3, 3], [0, 3]], level: 2 },
    ],
    ...over,
  } as Scene;
}

describe("upperLevelMeshes (view-only second floor)", () => {
  it("lifts a level-2 floor onto the ground-floor wall height", () => {
    const { floors } = upperLevelMeshes(scene());
    expect(floors).toHaveLength(1);
    expect(floors[0].roomId).toBe("r2");
    expect(floors[0].elevationM).toBeCloseTo(2.6);
  });

  it("derives one wall box per polygon edge, standing on that floor", () => {
    const { walls } = upperLevelMeshes(scene());
    expect(walls).toHaveLength(4);
    for (const w of walls) {
      expect(w.size[2]).toBeCloseTo(2.6);
      expect(w.center[2]).toBeCloseTo(2.6 + 1.3);
    }
  });

  it("puts level 3 one more storey up and ignores ground-level rooms", () => {
    const sc = scene({ rooms: [{ id: "r3", name: "Top", polygon: [[0, 0], [2, 0], [2, 2]], level: 3 }] });
    expect(upperLevelMeshes(sc).floors[0].elevationM).toBeCloseTo(5.2);
    expect(upperLevelMeshes(scene({ rooms: [{ id: "g", name: "G", polygon: [[0, 0], [1, 0], [1, 1]] }] })).walls).toEqual([]);
  });

  it("uses the tallest ground wall as the storey height", () => {
    const sc = scene({ walls: [{ id: "w1", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior", height_m: 3 }] });
    expect(upperLevelMeshes(sc).floors[0].elevationM).toBeCloseTo(3);
  });

  it("does not touch the Scene and the camera box includes the upper storey", () => {
    const sc = scene();
    const before = JSON.stringify(sc);
    upperLevelMeshes(sc);
    expect(JSON.stringify(sc)).toBe(before);
    expect(sceneBoundingBox(sc)?.max[2]).toBeCloseTo(5.2);
  });
});
