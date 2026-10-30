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
    const size = new THREE.Box3().setFromObject(sceneToMaquette(scene, 1 / 50)).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo((4 + 0.2) / 50, 3);
  });
});
