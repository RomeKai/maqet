import { describe, expect, it } from "vitest";
import { FURNITURE } from "./catalog";
import { accentColor, furnitureParts } from "./furnitureShapes";

const DIMS: Record<string, [number, number, number]> = {
  "bed-single-90x190": [0.9, 1.9, 0.55],
  "table-120x75": [1.2, 0.75, 0.75],
  "chair-45x45": [0.45, 0.45, 0.9],
  "stove-60x60": [0.6, 0.6, 0.9],
  "wardrobe-120x60": [1.2, 0.6, 2.0],
  "sofa-3seat-200x90": [2.0, 0.9, 0.85],
  "desk-120x60": [1.2, 0.6, 0.75],
  "bed-double-140x190": [1.4, 1.9, 0.55],
  "bed-queen-160x200": [1.6, 2.0, 0.55],
  "nightstand-45x40": [0.45, 0.4, 0.55],
  "table-90x90": [0.9, 0.9, 0.75],
  "table-160x90": [1.6, 0.9, 0.75],
  "chair-dining-45x50": [0.45, 0.5, 0.9],
  "armchair-80x80": [0.8, 0.8, 0.85],
  "tvunit-140x40": [1.4, 0.4, 0.5],
  "bookshelf-80x30": [0.8, 0.3, 1.8],
  "coffeetable-90x50": [0.9, 0.5, 0.4],
  "crib-65x125": [0.65, 1.25, 0.9],
};

describe("furniture shapes", () => {
  for (const f of FURNITURE) {
    it(`${f.type} keeps the catalog footprint and height with few parts`, () => {
      const [w, d, h] = DIMS[f.id];
      const parts = furnitureParts(f.type, [w, d, h]);
      expect(parts.length).toBeGreaterThan(1);
      expect(parts.length).toBeLessThanOrEqual(10);
      let top = 0;
      for (const p of parts) {
        const [u, v, z] = p.center;
        const [sw, sd, sh] = p.size;
        expect(u - sw / 2).toBeGreaterThanOrEqual(-w / 2 - 1e-9);
        expect(u + sw / 2).toBeLessThanOrEqual(w / 2 + 1e-9);
        expect(v - sd / 2).toBeGreaterThanOrEqual(-d / 2 - 1e-9);
        expect(v + sd / 2).toBeLessThanOrEqual(d / 2 + 1e-9);
        expect(z - sh / 2).toBeGreaterThanOrEqual(-1e-9);
        top = Math.max(top, z + sh / 2);
      }
      expect(top).toBeCloseTo(h, 2);
    });
  }
  it("has the recognizable parts", () => {
    expect(furnitureParts("table", [1.2, 0.75, 0.75])).toHaveLength(5); // top + 4 legs
    expect(furnitureParts("chair", [0.45, 0.45, 0.9])).toHaveLength(6); // seat, back, 4 legs
    expect(furnitureParts("stove", [0.6, 0.6, 0.9]).filter((p) => p.shape === "cylinder")).toHaveLength(4);
    expect(furnitureParts("wardrobe", [1.2, 0.6, 2]).filter((p) => p.tone === 1)).toHaveLength(2);
    expect(furnitureParts("bed", [0.9, 1.9, 0.55]).filter((p) => p.tone === 1)).toHaveLength(1); // pillow
    expect(furnitureParts("unknown", [1, 1, 1])).toHaveLength(1);
  });
  it("derives a darker accent", () => {
    expect(accentColor("#ffffff")).toBe("#b3b3b3");
  });
});
