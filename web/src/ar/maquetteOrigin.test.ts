import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { Scene } from "../scene/types";
import { sceneToMaquette } from "./sceneToMaquette";

// Deliberately off the origin so a centring bug cannot hide.
const scene = {
  id: "off",
  ceiling_height_m: 2.6,
  walls: [
    { id: "s", a: [10, 20], b: [14, 20], thickness_m: 0.2, kind: "exterior" },
    { id: "e", a: [14, 20], b: [14, 23], thickness_m: 0.2, kind: "exterior" },
    { id: "n", a: [14, 23], b: [10, 23], thickness_m: 0.2, kind: "exterior" },
    { id: "w", a: [10, 23], b: [10, 20], thickness_m: 0.2, kind: "exterior" },
  ],
} as unknown as Scene;

describe("maquette origin", () => {
  it.each([1 / 50, 1 / 100, 1 / 20])("sits on the floor and is centred in x and z at scale %f", (scale) => {
    const group = sceneToMaquette(scene, scale);
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(center.x).toBeCloseTo(0, 6);
    expect(center.z).toBeCloseTo(0, 6);
  });

  it("keeps the footprint size proportional to the scale", () => {
    const box = new THREE.Box3();
    const group = sceneToMaquette(scene, 1 / 50);
    group.updateMatrixWorld(true);
    for (const c of group.children) if (c.name !== "floor-plate") box.expandByObject(c);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo((4 + 0.2) / 50, 3);
  });

  it("has a light paper-coloured wall material", () => {
    const group = sceneToMaquette(scene);
    const wall = group.children.find((c) => c.name.startsWith("wall:")) as THREE.Mesh;
    const color = (wall.material as THREE.MeshStandardMaterial).color;
    expect(color.r).toBeGreaterThan(0.85);
    expect(color.g).toBeGreaterThan(0.8);
  });

  it("adds a floor plate slightly larger than the footprint, resting on y = 0", () => {
    const group = sceneToMaquette(scene, 1);
    const plate = group.children.find((c) => c.name === "floor-plate") as THREE.Mesh;
    expect(plate).toBeDefined();
    const plateBox = new THREE.Box3().setFromObject(plate);
    expect(plateBox.min.y).toBeCloseTo(0, 6);
    expect(plateBox.max.y).toBeCloseTo(0.1, 3);
    const walls = new THREE.Box3();
    for (const c of group.children) if (c.name.startsWith("wall:")) walls.expandByObject(c);
    expect(plateBox.max.x).toBeGreaterThan(walls.max.x);
    expect(plateBox.min.z).toBeLessThan(walls.min.z);
  });
});
