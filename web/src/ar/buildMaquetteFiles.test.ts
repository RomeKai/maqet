import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "../scene/types";
import { buildMaquetteFiles } from "./buildMaquetteFiles";

const scene = {
  id: "s",
  ceiling_height_m: 2.6,
  walls: [
    { id: "s", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" },
    { id: "e", a: [4, 0], b: [4, 3], thickness_m: 0.2, kind: "exterior" },
  ],
} as unknown as Scene;

// Node has no FileReader; GLTFExporter needs readAsArrayBuffer only (same stand-in as maquette.test.ts).
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

describe("buildMaquetteFiles", () => {
  beforeEach(() => {
    vi.stubGlobal("FileReader", BlobFileReader);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the GLB and the USDZ from one Scene", async () => {
    const { glb, usdz } = await buildMaquetteFiles(scene);
    expect(glb.byteLength).toBeGreaterThan(0);
    expect(new TextDecoder().decode(glb.slice(0, 4))).toBe("glTF");
    expect(usdz.byteLength).toBeGreaterThan(0);
    // USDZ is a zip archive.
    expect(usdz[0]).toBe(0x50);
    expect(usdz[1]).toBe(0x4b);
  });
});

describe("buildMaquetteFiles for a reformed scene (bug D)", () => {
  beforeEach(() => {
    vi.stubGlobal("FileReader", BlobFileReader);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exports GLB and USDZ after add_room plus an extra door", async () => {
    // Fixture produced by the server executor: 3x8 house + bedroom (auto walls and door) + a second door.
    const reformed = (await import("./reformedScene.fixture.json")).default as unknown as Scene;
    expect(reformed.walls?.length).toBe(7);
    expect(reformed.openings?.length).toBe(2);
    const { glb, usdz } = await buildMaquetteFiles(reformed);
    expect(new TextDecoder().decode(glb.slice(0, 4))).toBe("glTF");
    expect(usdz[0]).toBe(0x50);
  });
});
