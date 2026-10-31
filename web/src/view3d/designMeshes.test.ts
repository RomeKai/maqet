import { describe, expect, it } from "vitest";
import type { Scene } from "../scene/types";
import { furnitureMeshes, sceneToMeshes, surfaceOverlays } from "./sceneToMeshes";

const scene = {
  id: "s",
  walls: [
    { id: "w1", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" },
    { id: "w2", a: [4, 0], b: [4, 3], thickness_m: 0.2, kind: "exterior" },
  ],
  openings: [],
  rooms: [{ id: "r1", name: "R", polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
  surfaces: [
    { id: "a", target: { type: "room", room_id: "r1", part: "floor" }, material_id: "floor-wood-laminate" },
    { id: "b", target: { type: "wall", wall_id: "w1", side: "left" }, material_id: "wall-paint-sage" },
  ],
  furniture: [{ id: "f1", catalog_id: "bed-single-90x190", room_id: "r1", position: [1, 1], rotation_deg: 90, size_m: [0.9, 1.9, 0.55] }],
} as unknown as Scene;

describe("design meshes", () => {
  it("builds a labelled, colored box per furniture item", () => {
    const [m] = furnitureMeshes(scene);
    expect(m.id).toBe("f1");
    expect(m.type).toBe("bed");
    expect(m.size).toEqual([0.9, 1.9, 0.55]);
    expect(m.center).toEqual([1, 1, 0.275]);
    expect(m.rotationZ).toBeCloseTo(Math.PI / 2);
    expect(m.color).toBe("#8fa8c8");
  });
  it("colors a floor by its finish and offsets wall overlays to the chosen side", () => {
    expect(sceneToMeshes(scene).floors[0].color).toBe("#b58a5a");
    const [o] = surfaceOverlays(scene);
    expect(o.color).toBe("#a9b8a0");
    expect(o.wallId).toBe("w1");
    // left of +x is +y: overlay sits on the north face of the south wall
    expect(o.center[1]).toBeGreaterThan(0.1);
    expect(o.size[0]).toBeCloseTo(4);
  });
  it("returns nothing for a scene without design data", () => {
    const bare = { ...scene, furniture: undefined, surfaces: undefined } as unknown as Scene;
    expect(furnitureMeshes(bare)).toEqual([]);
    expect(surfaceOverlays(bare)).toEqual([]);
    expect(sceneToMeshes(bare).floors[0].color).toBeUndefined();
  });
});
