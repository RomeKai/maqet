import { describe, expect, it } from "vitest";
import type { Scene } from "../scene/types";
import { sceneToMaquette } from "./sceneToMaquette";

const scene = {
  id: "s",
  walls: [{ id: "w1", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" }],
  openings: [],
  rooms: [{ id: "r1", name: "R", polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
  surfaces: [{ id: "b", target: { type: "wall", wall_id: "w1", side: "left" }, material_id: "wall-paint-sage" }],
  furniture: [{ id: "f1", catalog_id: "sofa-3seat-200x90", room_id: "r1", position: [2, 1], rotation_deg: 0, size_m: [2, 0.9, 0.85] }],
} as unknown as Scene;

describe("maquette design pieces", () => {
  it("names furniture by type and adds a finish slab", () => {
    const names: string[] = [];
    sceneToMaquette(scene).traverse((o) => names.push(o.name));
    expect(names).toContain("furniture:f1 (sofa)");
    expect(names).toContain("finish:b");
  });
});

describe("maquette furniture shapes", () => {
  it("builds the sofa from several primitives with a closed footprint", () => {
    let group: { children: unknown[] } | undefined;
    sceneToMaquette(scene).traverse((o) => {
      if (o.name === "furniture:f1 (sofa)") group = o;
    });
    expect(group?.children.length).toBe(4);
  });
});
