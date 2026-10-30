import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Scene } from "../scene/types";
import { OPENING_THEME } from "../view3d/openingTheme";
import { exportGlb } from "./exportMaquette";
import { sceneToMaquette } from "./sceneToMaquette";

const room: Scene = {
  id: "room",
  ceiling_height_m: 2.6,
  walls: [
    { id: "s", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" },
    { id: "e", a: [4, 0], b: [4, 3], thickness_m: 0.2, kind: "exterior" },
    { id: "n", a: [4, 3], b: [0, 3], thickness_m: 0.2, kind: "exterior" },
    { id: "w", a: [0, 3], b: [0, 0], thickness_m: 0.2, kind: "exterior" },
  ],
  openings: [
    { id: "d1", wall_id: "s", kind: "door", offset_m: 0.5, width_m: 0.9, height_m: 2.1 },
    { id: "w1", wall_id: "n", kind: "window", offset_m: 1, width_m: 1.2, height_m: 1.2, sill_m: 0.9 },
  ],
  rooms: [{ id: "r1", name: "Living", polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
};

function find(group: THREE.Group, prefix: string): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name.startsWith(prefix)) found = o;
  });
  if (found === null) throw new Error(`no mesh ${prefix}`);
  return found;
}

describe("maquette openings", () => {
  it("colours doors and windows with OPENING_THEME (window translucent)", () => {
    const g = sceneToMaquette(room, 1);
    const door = find(g, "opening:door").material as THREE.MeshStandardMaterial;
    const win = find(g, "opening:window").material as THREE.MeshStandardMaterial;
    expect(`#${door.color.getHexString()}`).toBe(OPENING_THEME.door.color);
    expect(`#${win.color.getHexString()}`).toBe(OPENING_THEME.window.color);
    expect(win.transparent).toBe(true);
    expect(win.opacity).toBeCloseTo(OPENING_THEME.window.opacity);
    expect(door.transparent).toBe(false);
  });

  it("honours the window sill: its bottom sits sill_m above the floor, the door starts at the floor", () => {
    const g = sceneToMaquette(room, 1);
    g.updateMatrixWorld(true);
    const plateTop = new THREE.Box3().setFromObject(find(g, "floor-plate")).max.y;
    const win = new THREE.Box3().setFromObject(find(g, "opening:window"));
    const door = new THREE.Box3().setFromObject(find(g, "opening:door"));
    expect(win.min.y - plateTop).toBeCloseTo(0.9, 6);
    expect(win.max.y - plateTop).toBeCloseTo(2.1, 6);
    expect(door.min.y - plateTop).toBeCloseTo(0, 6);
  });
});

class BlobFileReader {
  result: ArrayBuffer | null = null;
  onload: (() => void) | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((b) => {
      this.result = b;
      this.onload?.();
      this.onloadend?.();
    });
  }
}

describe("GLB keeps the opening colours", () => {
  beforeEach(() => vi.stubGlobal("FileReader", BlobFileReader));
  afterEach(() => vi.unstubAllGlobals());

  it("writes door and translucent window materials into the glTF JSON", async () => {
    const glb = await exportGlb(sceneToMaquette(room));
    const view = new DataView(glb);
    const jsonLen = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLen))) as {
      materials: { pbrMetallicRoughness?: { baseColorFactor?: number[] }; alphaMode?: string }[];
    };
    const blend = json.materials.filter((m) => m.alphaMode === "BLEND");
    expect(blend.length).toBeGreaterThan(0);
    const door = new THREE.Color(OPENING_THEME.door.color);
    const hasDoor = json.materials.some((m) => {
      const c = m.pbrMetallicRoughness?.baseColorFactor;
      return c !== undefined && Math.abs(c[0]! - door.r) < 0.02 && Math.abs(c[1]! - door.g) < 0.02 && Math.abs(c[2]! - door.b) < 0.02;
    });
    expect(hasDoor).toBe(true);
  });
});
