import { describe, expect, it } from "vitest";
import {
  distanceM,
  pairCornersToWallUpdate,
  wallLengthFromCorners,
  type Vec3,
} from "./cornerMath";

describe("cornerMath", () => {
  it("computes a 3-4-5 triangle as 5m", () => {
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [3, 4, 0];
    expect(distanceM(a, b)).toBeCloseTo(5, 9);
    expect(wallLengthFromCorners(a, b)).toBeCloseTo(5, 9);
  });

  it("rejects zero-length pairs", () => {
    const a: Vec3 = [1, 2, 0];
    expect(wallLengthFromCorners(a, [1, 2, 0])).toBeNull();
    expect(distanceM(a, [1, 2, 0])).toBe(0);
  });

  it("rejects NaN and Infinity components", () => {
    const bad: Vec3[] = [
      [NaN, 0, 0],
      [0, Infinity, 0],
      [0, 0, -Infinity],
    ];
    for (const b of bad) {
      expect(wallLengthFromCorners([0, 0, 0], b)).toBeNull();
      expect(Number.isFinite(distanceM([0, 0, 0], b))).toBe(false);
    }
  });

  it("pairCornersToWallUpdate returns length + measured_ar provenance", () => {
    const update = pairCornersToWallUpdate(
      [
        [0, 0, 0],
        [3, 4, 0],
      ],
      "w7",
    );
    expect(update).not.toBeNull();
    expect(update?.wallId).toBe("w7");
    expect(update?.lengthM).toBeCloseTo(5, 9);
    expect(update?.provenance).toBe("measured_ar");
  });

  it("pairCornersToWallUpdate returns null for degenerate pairs", () => {
    expect(
      pairCornersToWallUpdate(
        [
          [0, 0, 0],
          [0, 0, 0],
        ],
        "w7",
      ),
    ).toBeNull();
  });
});
