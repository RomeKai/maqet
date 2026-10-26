import { describe, expect, it } from "vitest";
import { computeDownscale, metersPerPixel, parseDimensionMeters, MAX_SIDE_PX } from "./image";

describe("computeDownscale", () => {
  it("leaves small images untouched", () => {
    expect(computeDownscale(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("caps the longest side at 2048 px", () => {
    const out = computeDownscale(4000, 3000);
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(MAX_SIDE_PX);
    // Aspect ratio preserved.
    expect(out.width / out.height).toBeCloseTo(4000 / 3000, 2);
    expect(out).toEqual({ width: 2048, height: 1536 });
  });

  it("caps portrait images on the height", () => {
    const out = computeDownscale(1500, 3000);
    expect(out).toEqual({ width: 1024, height: 2048 });
  });
});

describe("parseDimensionMeters", () => {
  it("parses comma decimals", () => {
    expect(parseDimensionMeters("3,50")).toBeCloseTo(3.5, 6);
  });

  it("parses point decimals with unit", () => {
    expect(parseDimensionMeters("2.80 m")).toBeCloseTo(2.8, 6);
  });

  it("parses totals", () => {
    expect(parseDimensionMeters("6,00 total")).toBeCloseTo(6, 6);
  });

  it("returns null when no number is present", () => {
    expect(parseDimensionMeters("sin medida")).toBeNull();
    expect(parseDimensionMeters("")).toBeNull();
  });
});

describe("metersPerPixel", () => {
  it("computes px->m = typed / pixel_len", () => {
    expect(metersPerPixel(3.5, 700)).toBeCloseTo(0.005, 9);
  });

  it("rejects zero or negative pixel lengths", () => {
    expect(metersPerPixel(3.5, 0)).toBeNull();
    expect(metersPerPixel(3.5, -10)).toBeNull();
  });
});
