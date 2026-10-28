import { describe, expect, it } from "vitest";
import {
  AR_DOOR_HEIGHT_M,
  AR_WINDOW_HEIGHT_M,
  AR_WINDOW_SILL_M,
  openingDefaults,
  projectEdgesToOpening,
} from "./openingMath";
import type { Wall } from "../scene/types";
import type { Vec3 } from "./cornerMath";

function wall(a: [number, number], b: [number, number]): Wall {
  return {
    id: "w0",
    a,
    b,
    thickness_m: 0.1,
    kind: "interior",
    provenance: "measured_ar",
  };
}

describe("projectEdgesToOpening", () => {
  it("projects edge taps onto an axis-aligned wall", () => {
    const projection = projectEdgesToOpening(
      wall([0, 0], [4, 0]),
      [1, 0, 0],
      [3, 0, 0],
    );
    expect(projection?.offset_m).toBeCloseTo(1, 9);
    expect(projection?.width_m).toBeCloseTo(2, 9);
  });

  it("ignores tap height (y never leaks into plan geometry)", () => {
    const projection = projectEdgesToOpening(
      wall([0, 0], [4, 0]),
      [1, 1.5, 0],
      [3, 0.8, 0],
    );
    expect(projection?.offset_m).toBeCloseTo(1, 9);
    expect(projection?.width_m).toBeCloseTo(2, 9);
  });

  it("projects onto a diagonal wall by dot product", () => {
    // Wall (0,0)->(3,4), length 5. Taps at t=1 (plan 0.6,0.8) and t=2
    // (plan 1.2,1.6); plan [x,y] comes from tap [x, *, -y].
    const projection = projectEdgesToOpening(
      wall([0, 0], [3, 4]),
      [0.6, 0, -0.8],
      [1.2, 0, -1.6],
    );
    expect(projection?.offset_m).toBeCloseTo(1, 9);
    expect(projection?.width_m).toBeCloseTo(1, 9);
  });

  it("clamps taps before the wall start to offset 0", () => {
    // Wall (1,0)->(5,0): tap at plan x=0 projects to t=-1, clamped to 0.
    const projection = projectEdgesToOpening(
      wall([1, 0], [5, 0]),
      [0, 0, 0],
      [3, 0, 0],
    );
    expect(projection?.offset_m).toBe(0);
    expect(projection?.width_m).toBeCloseTo(3, 9);
  });

  it("returns the same width regardless of tap order", () => {
    const w = wall([0, 0], [4, 0]);
    const forward = projectEdgesToOpening(w, [1, 0, 0], [3, 0, 0]);
    const reversed = projectEdgesToOpening(w, [3, 0, 0], [1, 0, 0]);
    expect(forward).not.toBeNull();
    expect(reversed).not.toBeNull();
    expect(reversed?.offset_m).toBeCloseTo(forward?.offset_m ?? NaN, 9);
    expect(reversed?.width_m).toBeCloseTo(forward?.width_m ?? NaN, 9);
  });

  it("returns null for coincident taps", () => {
    const tap: Vec3 = [1, 0, 0];
    expect(projectEdgesToOpening(wall([0, 0], [4, 0]), tap, tap)).toBeNull();
  });

  it("returns null for non-finite taps", () => {
    const w = wall([0, 0], [4, 0]);
    const bad: Vec3[] = [
      [NaN, 0, 0],
      [0, Infinity, 0],
      [0, 0, -Infinity],
    ];
    for (const tap of bad) {
      expect(projectEdgesToOpening(w, [1, 0, 0], tap)).toBeNull();
      expect(projectEdgesToOpening(w, tap, [1, 0, 0])).toBeNull();
    }
  });

  it("returns null for a zero-length wall", () => {
    expect(
      projectEdgesToOpening(wall([2, 2], [2, 2]), [1, 0, 0], [3, 0, 0]),
    ).toBeNull();
  });
});

describe("openingDefaults", () => {
  it("doors are full-height with no sill", () => {
    expect(openingDefaults("door")).toEqual({
      height_m: AR_DOOR_HEIGHT_M,
      sill_m: null,
    });
    expect(AR_DOOR_HEIGHT_M).toBe(2.0);
  });

  it("windows use the Maqet AR-tracing sill/height defaults", () => {
    expect(openingDefaults("window")).toEqual({
      height_m: AR_WINDOW_HEIGHT_M,
      sill_m: AR_WINDOW_SILL_M,
    });
    expect(AR_WINDOW_SILL_M).toBe(0.9);
    expect(AR_WINDOW_HEIGHT_M).toBe(1.2);
    // Head at 2.10 stays under the 2.60 ceiling default.
    expect(AR_WINDOW_SILL_M + AR_WINDOW_HEIGHT_M).toBeLessThan(2.6);
  });
});
