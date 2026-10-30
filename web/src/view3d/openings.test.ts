import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { sceneToMaquette } from "../ar/sceneToMaquette";
import type { Scene } from "../scene/types";
import { OPENING_THEME } from "./openingTheme";
import { sceneToMeshes, wallBadges } from "./sceneToMeshes";

const scene = {
  id: "s",
  ceiling_height_m: 2.6,
  walls: [
    { id: "w1", a: [0, 0], b: [8, 0], thickness_m: 0.2, kind: "exterior" },
    { id: "w2", a: [8, 0], b: [8, 3], thickness_m: 0.2, kind: "exterior" },
    { id: "w3", a: [8, 3], b: [0, 3], thickness_m: 0.2, kind: "exterior" },
  ],
  openings: [
    { id: "d1", wall_id: "w1", kind: "door", offset_m: 1, width_m: 0.9, height_m: 2.1 },
    { id: "v1", wall_id: "w3", kind: "window", offset_m: 2, width_m: 1.2, height_m: 1.2, sill_m: 0.9 },
  ],
  rooms: [],
} as unknown as Scene;

describe("opening descriptors (bug H)", () => {
  it("emits one leaf per door and one glass pane per window, set in the wall", () => {
    const { openings } = sceneToMeshes(scene);
    const door = openings.find((o) => o.openingId === "d1");
    const win = openings.find((o) => o.openingId === "v1");
    expect(door?.openingKind).toBe("door");
    expect(win?.openingKind).toBe("window");
    expect(door?.size[2]).toBeCloseTo(2.1);
    expect(door?.center[2]).toBeCloseTo(1.05); // sill 0
    expect(win?.center[2]).toBeCloseTo(0.9 + 0.6); // sill 0.9, height 1.2
    expect(win?.size[1]).toBeLessThan(0.2); // thinner than the wall
  });
});

describe("maquette materials per opening kind (bug H)", () => {
  const group = sceneToMaquette(scene);
  const find = (name: string): THREE.Mesh => group.getObjectByName(name) as THREE.Mesh;

  it("paints doors with the terracotta accent", () => {
    const m = find("opening:door:d1").material as THREE.MeshStandardMaterial;
    expect(`#${m.color.getHexString()}`).toBe(OPENING_THEME.door.color);
    expect(m.transparent).toBe(false);
  });

  it("makes windows light-blue translucent glass", () => {
    const m = find("opening:window:v1").material as THREE.MeshStandardMaterial;
    expect(`#${m.color.getHexString()}`).toBe(OPENING_THEME.window.color);
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBeCloseTo(OPENING_THEME.window.opacity);
  });

  it("keeps walls neutral", () => {
    const wall = group.children.find((c) => c.name.startsWith("wall:")) as THREE.Mesh;
    const m = wall.material as THREE.MeshStandardMaterial;
    expect([OPENING_THEME.door.color, OPENING_THEME.window.color]).not.toContain(`#${m.color.getHexString()}`);
  });
});

describe("wall number badges (bug F)", () => {
  it("numbers walls by scene index, the label the agent uses", () => {
    const badges = wallBadges(scene);
    expect(badges.map((b) => [b.wallId, b.number])).toEqual([
      ["w1", 1],
      ["w2", 2],
      ["w3", 3],
    ]);
    const first = badges[0];
    expect(first.position[0]).toBeCloseTo(4); // midpoint x of w1
    expect(first.position[2]).toBeGreaterThan(2.6); // above the wall top
  });
});
