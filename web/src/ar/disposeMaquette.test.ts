import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Scene } from "../scene/types";
import { disposeMaquette } from "./disposeMaquette";
import { sceneToMaquette } from "./sceneToMaquette";

const scene: Scene = {
  id: "p1",
  walls: [{ id: "w1", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" }],
  rooms: [{ id: "r1", name: "Kitchen", polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
  furniture: [{ id: "f1", room_id: "r1", position: [1, 1], size_m: [1, 1, 1] }],
};

function meshes(group: THREE.Group): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) found.push(node);
  });
  return found;
}

describe("disposeMaquette", () => {
  it("disposes every geometry of a built maquette", () => {
    const group = sceneToMaquette(scene);
    const spies = meshes(group).map((mesh) => vi.spyOn(mesh.geometry, "dispose"));
    expect(spies.length).toBeGreaterThan(0);

    disposeMaquette(group);

    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("disposes every material, once even when meshes share it", () => {
    const group = sceneToMaquette(scene);
    const unique = new Set(meshes(group).map((mesh) => mesh.material as THREE.Material));
    const spies = [...unique].map((material) => vi.spyOn(material, "dispose"));

    disposeMaquette(group);

    expect(spies.length).toBeGreaterThan(0);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("handles material arrays and disposes textures held by a material", () => {
    const texture = new THREE.Texture();
    const first = new THREE.MeshStandardMaterial({ map: texture });
    const second = new THREE.MeshBasicMaterial();
    const textureSpy = vi.spyOn(texture, "dispose");
    const firstSpy = vi.spyOn(first, "dispose");
    const secondSpy = vi.spyOn(second, "dispose");
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [first, second]));

    disposeMaquette(group);

    expect(textureSpy).toHaveBeenCalledTimes(1);
    expect(firstSpy).toHaveBeenCalledTimes(1);
    expect(secondSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores non-mesh nodes and an empty maquette", () => {
    const group = new THREE.Group();
    group.add(new THREE.Object3D());
    expect(() => disposeMaquette(group)).not.toThrow();
    expect(() => disposeMaquette(sceneToMaquette({ id: "empty" }))).not.toThrow();
  });
});
