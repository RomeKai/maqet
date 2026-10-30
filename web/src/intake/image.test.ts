import { describe, expect, it } from "vitest";
import { computeDownscale, parseDimensionMeters, MAX_SIDE_PX } from "./image";

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

  it("caps landscape-wider images on the width", () => {
    // Simulates a landscape photo whose EXIF-rotated size is 3000x1500
    const out = computeDownscale(3000, 1500);
    expect(out).toEqual({ width: 2048, height: 1024 });
  });

  it("treats landscape and portrait symmetrically via longest side", () => {
    const landscape = computeDownscale(4000, 2000);
    const portrait = computeDownscale(2000, 4000);
    expect(landscape).toEqual({ width: 2048, height: 1024 });
    expect(portrait).toEqual({ width: 1024, height: 2048 });
  });

  it("caps landscape image where height dominates before downscale", () => {
    const out = computeDownscale(5000, 1200);
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(MAX_SIDE_PX);
    expect(out).toEqual({ width: 2048, height: 492 });
  });

  it("degenerate inputs yield 0x0", () => {
    expect(computeDownscale(0, 0)).toEqual({ width: 0, height: 0 });
    expect(computeDownscale(NaN, 100)).toEqual({ width: 0, height: 0 });
  });

  it("client downscale contract is orientation-agnostic: swapped inputs swap outputs", () => {
    // If the EXIF orientation swaps canvas dimensions (portrait->landscape), the
    // downscale math must still cap the longest side. This would fail if the
    // caller ever fed raw (pre-orientation) dimensions into computeDownscale.
    const a = computeDownscale(4032, 3024);
    const b = computeDownscale(3024, 4032);
    expect(a).toEqual({ width: 2048, height: 1536 });
    expect(b).toEqual({ width: 1536, height: 2048 });
    // They must not be equal — proves orientation actually matters to the result.
    expect(a).not.toEqual(b);
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

// RED coverage for bug 1: downscale pipeline must report its oriented canvas
// dimensions even when createImageBitmap is absent or throws (fallback path).
// Before the fix, a landscape image could report portrait dimensions because
// the helper ignored EXIF-induced swapping. The helper below is pure and
// testable without a DOM.
import { orientedDownscale } from "./image";

describe("orientedDownscale (EXIF orientation contract)", () => {
  it("RED: landscape EXIF orientation 6 swaps width/height before capping", () => {
    // Native sensor 3000x4000 stored portrait with EXIF 6 (rotate 90 CW) ->
    // oriented canvas is 4000x3000. Longest side 4000 caps to 2048.
    expect(orientedDownscale(3000, 4000, 6)).toEqual({ width: 2048, height: 1536 });
  });

  it("RED: orientation 1 (normal) does not swap", () => {
    expect(orientedDownscale(3000, 4000, 1)).toEqual({ width: 1536, height: 2048 });
  });

  it("RED: orientation 3 (180 deg) does not swap dimensions", () => {
    // 180 deg keeps width/height, only pixels rotate in place.
    expect(orientedDownscale(4000, 3000, 3)).toEqual({ width: 2048, height: 1536 });
  });

  it("RED: unknown orientation defaults to no-swap", () => {
    expect(orientedDownscale(4000, 3000, 99)).toEqual({ width: 2048, height: 1536 });
    expect(orientedDownscale(4000, 3000, undefined)).toEqual({ width: 2048, height: 1536 });
  });
});
