import { describe, expect, it } from "vitest";
import {
  centerRayFromViewInverse,
  ceilingHeightFromCenterRay,
} from "./ceilingRay";
import type { CapturedCorner } from "./captureSession";
import type { Vec3 } from "./cornerMath";

const A: CapturedCorner = { x: 0, z: 0 };
const B: CapturedCorner = { x: 4, z: 0 };

describe("centerRayFromViewInverse (fix 2 RED: camera ray from XR matrices)", () => {
  it("extracts eye + forward dir from a column-major view matrix", () => {
    // Identity: camera at origin looking -Z.
    const identity = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const ray = centerRayFromViewInverse(identity);
    expect(ray).not.toBeNull();
    expect(ray?.eye[0]).toBeCloseTo(0, 9);
    expect(ray?.eye[1]).toBeCloseTo(0, 9);
    expect(ray?.eye[2]).toBeCloseTo(0, 9);
    expect(ray?.dir[0]).toBeCloseTo(0, 9);
    expect(ray?.dir[1]).toBeCloseTo(0, 9);
    expect(ray?.dir[2]).toBeCloseTo(-1, 9);
  });

  it("recovers the eye above the floor from a translated view matrix", () => {
    // Camera at (0, 1.6, 2) looking -Z: the view matrix carries -eye.
    const m = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, -1.6, -2, 1,
    ];
    const ray = centerRayFromViewInverse(m);
    expect(ray?.eye[0]).toBeCloseTo(0, 9);
    expect(ray?.eye[1]).toBeCloseTo(1.6, 9);
    expect(ray?.eye[2]).toBeCloseTo(2, 9);
    expect(ray?.dir[0]).toBeCloseTo(0, 9);
    expect(ray?.dir[1]).toBeCloseTo(0, 9);
    expect(ray?.dir[2]).toBeCloseTo(-1, 9);
  });

  it("returns null for missing, short or non-finite matrices", () => {
    expect(centerRayFromViewInverse(null)).toBeNull();
    expect(centerRayFromViewInverse([1, 2, 3])).toBeNull();
    const bad = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, NaN, -2, 1,
    ];
    expect(centerRayFromViewInverse(bad)).toBeNull();
  });

  it("end to end: ray from matrices hits the wall plane at aiming height", () => {
    // Same rig as above: eye (0,1.6,2) looking -Z at wall z=-2, floor 0.
    const m = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, -1.6, -2, 1,
    ];
    const ray = centerRayFromViewInverse(m);
    const h = ceilingHeightFromCenterRay(
      { x: -2, z: -2 },
      { x: 2, z: -2 },
      0,
      ray,
    );
    expect(h).toBeCloseTo(1.6, 6);
  });
});
describe("ceilingHeightFromCenterRay (fix 2 RED: ray-plane ceiling)", () => {
  it("returns null without a wall or floor datum", () => {
    expect(ceilingHeightFromCenterRay(null, null, null, null)).toBeNull();
    expect(ceilingHeightFromCenterRay(A, B, null, null)).toBeNull();
    expect(ceilingHeightFromCenterRay(A, B, 0.5, null)).toBeNull();
  });

  it("height is intersection of center-screen ray with vertical plane through A->B, above floorY", () => {
    // Camera at origin looking -Z, center ray = (0,0,-1). Wall at z=-2 along X.
    const eye: Vec3 = [0, 1.2, 0];
    const dir: Vec3 = [0, 0, -1];
    const wallA: CapturedCorner = { x: -2, z: -2 };
    const wallB: CapturedCorner = { x: 2, z: -2 };
    const floorY = 0;
    const h = ceilingHeightFromCenterRay(wallA, wallB, floorY, { eye, dir });
    // Ray hits plane at z=-2 => t=2, point (0,1.2,-2), height = 1.2 - 0 = 1.2
    expect(h).not.toBeNull();
    expect(h).toBeCloseTo(1.2, 6);
  });

  it("returns null when camera ray is parallel to the wall plane (no intersection)", () => {
    const eye: Vec3 = [0, 1.2, 0];
    const dir: Vec3 = [1, 0, 0]; // along the wall, never hits vertical plane through A->B
    const floorY = 0;
    const h = ceilingHeightFromCenterRay(A, B, floorY, { eye, dir });
    expect(h).toBeNull();
  });

  it("returns null when intersection is below the floor (camera below floor)", () => {
    const eye: Vec3 = [0, -0.5, 0];
    const dir: Vec3 = [0, 0, -1];
    const wallA: CapturedCorner = { x: -2, z: -2 };
    const wallB: CapturedCorner = { x: 2, z: -2 };
    const floorY = 0;
    const h = ceilingHeightFromCenterRay(wallA, wallB, floorY, { eye, dir });
    expect(h).toBeNull();
  });
});

import { floorPointFromRay, wallPointFromRay } from "./ceilingRay";

describe("floorPointFromRay", () => {
  it("intersects the center ray with the floor plane y = floorY", () => {
    // Eye 1.4 m above the floor, looking forward and down at 45 degrees.
    const p = floorPointFromRay({ eye: [0, 1.4, 0], dir: [0, -Math.SQRT1_2, -Math.SQRT1_2] }, 0);
    expect(p?.[0]).toBeCloseTo(0, 9);
    expect(p?.[1]).toBe(0);
    expect(p?.[2]).toBeCloseTo(-1.4, 9);
  });
  it("is null when the ray points up, is level, or is missing", () => {
    expect(floorPointFromRay({ eye: [0, 1, 0], dir: [0, 0.5, -1] }, 0)).toBeNull();
    expect(floorPointFromRay({ eye: [0, 1, 0], dir: [0, 0, -1] }, 0)).toBeNull();
    expect(floorPointFromRay(null, 0)).toBeNull();
  });
});

describe("wallPointFromRay", () => {
  const walls = [
    { id: "wall-1", start: { x: 0, z: -2 }, end: { x: 4, z: -2 }, heightM: 2.6, flaggedHeight: false },
    { id: "wall-2", start: { x: 4, z: -2 }, end: { x: 4, z: -5 }, heightM: 2.6, flaggedHeight: false },
  ];
  it("returns the wall and the point where the ray crosses its vertical plane", () => {
    const hit = wallPointFromRay(walls, 0, { eye: [1, 1.4, 0], dir: [0, 0, -1] });
    expect(hit?.wallId).toBe("wall-1");
    expect(hit?.point[0]).toBeCloseTo(1, 9);
    expect(hit?.point[2]).toBeCloseTo(-2, 9);
  });
  it("ignores a plane crossing outside the wall segment", () => {
    expect(wallPointFromRay(walls, 0, { eye: [9, 1.4, 0], dir: [0, 0, -1] })).toBeNull();
  });
  it("ignores a crossing above the wall top or below the floor", () => {
    expect(wallPointFromRay(walls, 0, { eye: [1, 5, 0], dir: [0, 0, -1] })).toBeNull();
    expect(wallPointFromRay(walls, 0, { eye: [1, -1, 0], dir: [0, 0, -1] })).toBeNull();
  });
});

import { resolveFloorTap } from "./ceilingRay";

describe("resolveFloorTap (next corner after the height step stays on the floor)", () => {
  const down30 = { eye: [0, 1.4, 0] as Vec3, dir: [0, -0.5, -Math.sqrt(0.75)] as Vec3 };
  it("keeps a hit that is on the floor plane", () => {
    expect(resolveFloorTap([1, 0.04, -2], 0, down30)).toEqual([1, 0.04, -2]);
  });
  it("replaces a wall / ceiling hit with the ray's floor point", () => {
    const p = resolveFloorTap([0, 1.6, -3], 0, down30);
    expect(p?.[1]).toBe(0);
    expect(p?.[2]).toBeCloseTo(-2.4249, 3);
  });
  it("uses the ray when there is no hit at all", () => {
    expect(resolveFloorTap(null, 0, down30)?.[1]).toBe(0);
  });
  it("is null when there is neither a floor hit nor a downward ray", () => {
    expect(resolveFloorTap(null, 0, null)).toBeNull();
  });
});
