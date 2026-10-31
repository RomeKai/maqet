import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FINISHES, FURNITURE, finishColor, furnitureColor, furnitureLabel } from "./catalog";

const catalog = JSON.parse(readFileSync(new URL("../../../assets/catalog.json", import.meta.url), "utf8")) as {
  furniture: { id: string; type?: string; clearance_only: boolean }[];
  materials: { id: string; kind: string; surface?: string; color?: string }[];
};

describe("design catalog parity with assets/catalog.json", () => {
  it("lists every placeable furniture item with its type", () => {
    const real = catalog.furniture.filter((f) => !f.clearance_only);
    expect(FURNITURE.map((f) => f.id).sort()).toEqual(real.map((f) => f.id).sort());
    for (const f of FURNITURE) expect(real.find((r) => r.id === f.id)?.type).toBe(f.type);
  });
  it("lists every finish with the same surface and color", () => {
    const finishes = catalog.materials.filter((m) => m.kind === "finish");
    expect(FINISHES.map((f) => f.id).sort()).toEqual(finishes.map((f) => f.id).sort());
    for (const f of FINISHES) {
      const m = finishes.find((x) => x.id === f.id);
      expect(m?.surface).toBe(f.surface);
      expect(m?.color).toBe(f.color);
    }
  });
  it("labels by type in both locales and colors by id", () => {
    expect(furnitureLabel("bed-single-90x190", "en")).toBe("Single bed");
    expect(furnitureLabel("bed-single-90x190", "es-AR")).toBe("Cama de una plaza");
    expect(furnitureColor("nope")).toMatch(/^#/);
    expect(finishColor("wall-paint-white")).toBe("#f6f3ec");
    expect(finishColor("brick-hollow-12-10")).toBeNull();
  });
});
