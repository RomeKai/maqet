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
