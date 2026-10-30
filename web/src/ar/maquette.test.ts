import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { Scene } from "../scene/types";
import { sceneToMeshes } from "../view3d/sceneToMeshes";
import { DEFAULT_MAQUETTE_SCALE, sceneToMaquette } from "./sceneToMaquette";
import { exportGlb, exportUsdz } from "./exportMaquette";

/** 4 x 3 m room, walls 0.2 m thick, ceiling 2.6 m, a door in the south wall, one concept and one catalog piece. */
const room: Scene = {
  id: "room",
  ceiling_height_m: 2.6,
  walls: [
    { id: "s", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" },
    { id: "e", a: [4, 0], b: [4, 3], thickness_m: 0.2, kind: "exterior" },
    { id: "n", a: [4, 3], b: [0, 3], thickness_m: 0.2, kind: "exterior" },
    { id: "w", a: [0, 3], b: [0, 0], thickness_m: 0.2, kind: "exterior" },
  ],
  openings: [{ id: "d1", wall_id: "s", kind: "door", offset_m: 1, width_m: 0.9, height_m: 2.1 }],
  rooms: [{ id: "r1", name: "Living", polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
  furniture: [
    { id: "bed", catalog_id: "bed-single-90x190", room_id: "r1", position: [1, 1], size_m: [0.9, 1.9, 0.5] },
    { id: "sofa", concept_id: "sofa-x", room_id: "r1", position: [3, 2], size_m: [1.8, 0.9, 0.8], concept: true },
  ],
};

/** Size of the modelled house, without the base plate (the plate is a presentation aid, not Scene geometry). */
function bounds(object: THREE.Object3D): THREE.Vector3 {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const child of object.children) if (child.name !== "floor-plate") box.expandByObject(child);
  return box.getSize(new THREE.Vector3());
}

function meshNames(object: THREE.Object3D): string[] {
  const names: string[] = [];
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) names.push(o.name);
  });
  return names;
}

describe("sceneToMaquette", () => {
  it("defaults to a 1:50 table-top scale", () => {
    expect(DEFAULT_MAQUETTE_SCALE).toBeCloseTo(1 / 50, 10);
  });

  it("scales the Scene extents (walls incl. thickness, wall height) by the maquette scale", () => {
    const size = bounds(sceneToMaquette(room));
    // Extents in metres: x 4.2, height 2.6, depth 3.2 (three.js is Y-up).
    expect(size.x).toBeCloseTo(4.2 * DEFAULT_MAQUETTE_SCALE, 6);
    expect(size.y).toBeCloseTo(2.6 * DEFAULT_MAQUETTE_SCALE, 6);
    expect(size.z).toBeCloseTo(3.2 * DEFAULT_MAQUETTE_SCALE, 6);
  });

  it("is 1 unit = 1 m at scale 1 and honours other ratios", () => {
    const real = bounds(sceneToMaquette(room, 1));
    expect([real.x, real.y, real.z].map((v) => Number(v.toFixed(6)))).toEqual([4.2, 2.6, 3.2]);
    expect(bounds(sceneToMaquette(room, 1 / 100)).x).toBeCloseTo(0.042, 6);
  });

  it("rejects a scale that is not a positive finite number", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => sceneToMaquette(room, bad)).toThrow(RangeError);
    }
  });

  it("reuses the 3D view geometry: one box per solid wall segment (the door splits its wall, plus its lintel) and one floor per room", () => {
    const names = meshNames(sceneToMaquette(room));
    const expected = sceneToMeshes(room);
    expect(expected.walls.length).toBe(6);
    expect(names.filter((n) => n.startsWith("wall:"))).toHaveLength(expected.walls.length);
    expect(names.filter((n) => n.startsWith("floor:"))).toHaveLength(expected.floors.length);
  });

  it("leaves the door gap open", () => {
    const maquette = sceneToMaquette(room, 1);
    maquette.updateMatrixWorld(true);
    const southWalls = maquette.children.filter((o) => o.name.startsWith("wall:s:"));
    const [left, right] = southWalls.map((o) => new THREE.Box3().setFromObject(o));
    expect(right.min.x - left.max.x).toBeCloseTo(0.9, 6);
  });

  it("labels concept furniture and only that", () => {
    const maquette = sceneToMaquette(room);
    const byName = new Map<string, THREE.Object3D>();
    maquette.traverse((o) => byName.set(o.name, o));
    expect(byName.get("furniture:sofa (concept)")?.userData.concept).toBe(true);
    expect(byName.get("furniture:bed")?.userData.concept).toBeUndefined();
    expect([...byName.keys()].some((n) => n.startsWith("furniture:bed") && n.includes("concept"))).toBe(false);
  });

  it("marks the maquette as preliminary for the exported file", () => {
    const maquette = sceneToMaquette(room);
    expect(maquette.userData.preliminary).toBe(true);
    expect(maquette.name).toContain("preliminary");
  });

  it("does not throw on an empty Scene and produces an empty maquette", () => {
    const maquette = sceneToMaquette({ id: "empty" });
    expect(meshNames(maquette)).toEqual([]);
  });
});

/**
 * GLTFExporter reads its binary blob with the browser's FileReader, which the Node test environment
 * does not have (no jsdom). Minimal stand-in covering readAsArrayBuffer only; test-only.
 */
class BlobFileReader {
  result: ArrayBuffer | null = null;
  onload: (() => void) | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    blob.arrayBuffer().then(
      (buffer) => {
        this.result = buffer;
        this.onload?.();
        this.onloadend?.();
      },
      (error: unknown) => this.onerror?.(error),
    );
  }
}

describe("exportGlb", () => {
  beforeEach(() => {
    vi.stubGlobal("FileReader", BlobFileReader);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a non-empty binary glTF (magic 'glTF') under the phone budget", async () => {
    const glb = await exportGlb(sceneToMaquette(room));
    expect(glb).toBeInstanceOf(ArrayBuffer);
    expect(glb.byteLength).toBeGreaterThan(0);
    expect(new DataView(glb).getUint32(0, true)).toBe(0x46546c67);
    expect(glb.byteLength).toBeLessThan(15 * 1024 * 1024);
  });
});

describe("exportUsdz", () => {
  it("returns a non-empty USDZ archive (zip magic)", async () => {
    const usdz = await exportUsdz(sceneToMaquette(room));
    expect(usdz).toBeInstanceOf(Uint8Array);
    expect(usdz.byteLength).toBeGreaterThan(0);
    expect([usdz[0], usdz[1]]).toEqual([0x50, 0x4b]);
  });
});
