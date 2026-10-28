import { describe, expect, it } from "vitest";
import {
  AR_DOOR_HEIGHT_M,
  AR_WINDOW_HEIGHT_M,
  AR_WINDOW_SILL_M,
  buildOpening,
  clampOpeningToWall,
  MIN_DOOR_WIDTH_M,
  nearestWallToTap,
  nextOpeningId,
  openingDefaults,
  openingHeightFromTopTap,
  openingSillFromEdgeTap,
  projectEdgesToOpening,
} from "./openingMath";
import type { Opening, Wall } from "../scene/types";
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

describe("nearestWallToTap", () => {
  const walls: Wall[] = [
    wall([0, 0], [4, 0]),
    wall([6, 0], [6, 3]),
  ];
  walls[0]!.id = "wall-1";
  walls[1]!.id = "wall-2";

  it("picks the closest wall by floor-plane point-to-segment distance", () => {
    expect(nearestWallToTap(walls, [1, 0, 0])?.id).toBe("wall-1");
    expect(nearestWallToTap(walls, [6, 0, -1])?.id).toBe("wall-2");
  });

  it("prefers distance to the segment, not just to an endpoint", () => {
    // Tap closest to the middle of wall-1, far from both endpoints.
    expect(nearestWallToTap(walls, [2, 0.4, 0])?.id).toBe("wall-1");
  });

  it("returns null when there are no walls or the tap is invalid", () => {
    expect(nearestWallToTap([], [1, 0, 0])).toBeNull();
    expect(nearestWallToTap(walls, [NaN, 0, 0])).toBeNull();
  });
});

describe("clampOpeningToWall", () => {
  it("keeps openings that already fit", () => {
    expect(clampOpeningToWall(4, 1, 2)).toEqual({ offset_m: 1, width_m: 2 });
  });

  it("clamps the far end so offset + width never overflows the wall", () => {
    expect(clampOpeningToWall(4, 3, 2)).toEqual({ offset_m: 3, width_m: 1 });
  });

  it("returns null when nothing fits (offset at or past the wall end)", () => {
    expect(clampOpeningToWall(4, 4, 1)).toBeNull();
    expect(clampOpeningToWall(4, 5, 1)).toBeNull();
  });

  it("returns null for degenerate or non-finite input", () => {
    expect(clampOpeningToWall(0, 0, 1)).toBeNull();
    expect(clampOpeningToWall(4, 1, 0)).toBeNull();
    expect(clampOpeningToWall(4, NaN, 1)).toBeNull();
  });
});

describe("nextOpeningId", () => {
  it("starts at opening-1 on an empty scene", () => {
    expect(nextOpeningId([])).toBe("opening-1");
  });

  it("uses max numeric suffix + 1, so delete/undo never collide", () => {
    const openings: Opening[] = [
      { id: "opening-1", wall_id: "w", kind: "door", offset_m: 0, width_m: 1, height_m: 2, sill_m: null },
      { id: "opening-3", wall_id: "w", kind: "window", offset_m: 0, width_m: 1, height_m: 1.2, sill_m: 0.9 },
    ];
    expect(nextOpeningId(openings)).toBe("opening-4");
  });

  it("ignores non-numeric suffixes", () => {
    const openings: Opening[] = [
      { id: "legacy", wall_id: "w", kind: "door", offset_m: 0, width_m: 1, height_m: 2, sill_m: null },
    ];
    expect(nextOpeningId(openings)).toBe("opening-1");
  });
});

describe("MIN_DOOR_WIDTH_M", () => {
  it("mirrors the server backstop (validation.py MIN_DOOR_WIDTH_M)", () => {
    expect(MIN_DOOR_WIDTH_M).toBe(0.8);
  });
});

describe("buildOpening", () => {
  const target: Wall = { ...wall([0, 0], [4, 0]), id: "wall-1" };

  it("builds a door opening clamped to the wall", () => {
    const result = buildOpening([target], "opening-9", "door", "wall-1", [1, 0, 0], [3, 0, 0]);
    expect(result).toEqual({
      opening: {
        id: "opening-9",
        wall_id: "wall-1",
        kind: "door",
        offset_m: 1,
        width_m: 2,
        height_m: AR_DOOR_HEIGHT_M,
        sill_m: null,
      },
    });
  });

  it("clamps taps that run past the wall end", () => {
    const result = buildOpening([target], "opening-1", "window", "wall-1", [3, 0, 0], [9, 0, 0]);
    expect(result).toMatchObject({ opening: { offset_m: 3 } });
    if ("opening" in result) {
      expect(result.opening.width_m).toBeCloseTo(1, 9);
    } else {
      throw new Error("expected an opening");
    }
  });

  it("reports unknown-wall for a missing target", () => {
    expect(buildOpening([target], "opening-1", "door", "missing", [1, 0, 0], [2, 0, 0])).toEqual({
      failure: "unknown-wall",
    });
  });

  it("reports degenerate for coincident taps", () => {
    const tap: Vec3 = [1, 0, 0];
    expect(buildOpening([target], "opening-1", "door", "wall-1", tap, tap)).toEqual({
      failure: "degenerate",
    });
  });

  it("rejects doors narrower than the server minimum", () => {
    expect(buildOpening([target], "opening-1", "door", "wall-1", [1, 0, 0], [1.5, 0, 0])).toEqual({
      failure: "door-narrow",
    });
  });

  it("accepts narrow windows (no minimum width rule)", () => {
    const result = buildOpening([target], "opening-1", "window", "wall-1", [1, 0, 0], [1.5, 0, 0]);
    if ("opening" in result) {
      expect(result.opening.width_m).toBeCloseTo(0.5, 9);
    } else {
      throw new Error("expected an opening");
    }
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

describe("openingHeightFromTopTap", () => {
  it("height is the top tap minus the floor reference", () => {
    expect(openingHeightFromTopTap(0.05, 2.15)).toBeCloseTo(2.1, 9);
  });

  it("returns null when the top tap never clears the floor plane", () => {
    expect(openingHeightFromTopTap(0, 0)).toBeNull();
    expect(openingHeightFromTopTap(0.1, -0.2)).toBeNull();
  });

  it("returns null for non-finite input", () => {
    expect(openingHeightFromTopTap(NaN, 2)).toBeNull();
    expect(openingHeightFromTopTap(0, Infinity)).toBeNull();
  });
});

describe("openingSillFromEdgeTap", () => {
  it("windows: sill is the first edge tap minus the floor reference", () => {
    expect(openingSillFromEdgeTap(0.05, 0.95, "window")).toBeCloseTo(0.9, 9);
  });

  it("doors always run to the floor: sill is null", () => {
    expect(openingSillFromEdgeTap(0, 0.9, "door")).toBeNull();
    expect(openingSillFromEdgeTap(0, -0.5, "door")).toBeNull();
  });

  it("clamps taps at/below the floor plane to a zero sill, never negative", () => {
    // Hit-test y noise can dip below the floor plane: a 0 sill (full-height
    // base) keeps a valid opening instead of vetoing it.
    expect(openingSillFromEdgeTap(0.1, 0.1, "window")).toBe(0);
    expect(openingSillFromEdgeTap(0.1, -0.4, "window")).toBe(0);
  });

  it("treats a non-finite edge height as a zero sill", () => {
    expect(openingSillFromEdgeTap(0, NaN, "window")).toBe(0);
    expect(openingSillFromEdgeTap(NaN, 0.9, "window")).toBe(0);
  });
});

describe("buildOpening with explicit dims", () => {
  const target: Wall = { ...wall([0, 0], [4, 0]), id: "wall-1" };

  it("uses the explicit height/sill instead of the defaults", () => {
    const result = buildOpening(
      [target],
      "opening-1",
      "window",
      "wall-1",
      [1, 0.9, 0],
      [3, 0.9, 0],
      { height_m: 2.1, sill_m: 0.9 },
    );
    expect(result).toEqual({
      opening: {
        id: "opening-1",
        wall_id: "wall-1",
        kind: "window",
        offset_m: 1,
        width_m: 2,
        height_m: 2.1,
        sill_m: 0.9,
      },
    });
  });

  it("still falls back to defaults when no dims are given", () => {
    const result = buildOpening([target], "opening-1", "door", "wall-1", [1, 0, 0], [3, 0, 0]);
    if ("opening" in result) {
      expect(result.opening.height_m).toBe(AR_DOOR_HEIGHT_M);
      expect(result.opening.sill_m).toBeNull();
    } else {
      throw new Error("expected an opening");
    }
  });

  it("reports degenerate for a non-positive explicit height", () => {
    for (const height_m of [0, -1.5, NaN, Infinity]) {
      expect(
        buildOpening([target], "opening-1", "window", "wall-1", [1, 0, 0], [3, 0, 0], {
          height_m,
          sill_m: 0.9,
        }),
      ).toEqual({ failure: "degenerate" });
    }
  });

  it("reports degenerate for a negative or non-finite explicit sill", () => {
    for (const sill_m of [-0.1, NaN, Infinity]) {
      expect(
        buildOpening([target], "opening-1", "window", "wall-1", [1, 0, 0], [3, 0, 0], {
          height_m: 1.2,
          sill_m,
        }),
      ).toEqual({ failure: "degenerate" });
    }
  });
});
