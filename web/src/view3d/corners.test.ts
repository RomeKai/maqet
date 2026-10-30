import { describe, expect, it } from "vitest";
import { sceneToMeshes, type WallSegment } from "./sceneToMeshes";
import type { Scene } from "../scene/types";

function scene(): Scene {
  return {
    id: "s",
    walls: [
      { id: "w1", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" },
      { id: "w2", a: [4, 0], b: [4, 3], thickness_m: 0.1, kind: "interior" },
    ],
  } as unknown as Scene;
}

/** Axis-aligned extents of a box (rotation is 0 or pi/2 in these fixtures). */
function extents(s: WallSegment): { x0: number; x1: number; y0: number; y1: number } {
  const quarter = Math.abs(Math.sin(s.rotationZ)) > 0.5;
  const hx = (quarter ? s.size[1] : s.size[0]) / 2;
  const hy = (quarter ? s.size[0] : s.size[1]) / 2;
  return { x0: s.center[0] - hx, x1: s.center[0] + hx, y0: s.center[1] - hy, y1: s.center[1] + hy };
}

describe("3D wall corners", () => {
  it("two perpendicular walls meet at the outer corner with no gap", () => {
    const { walls } = sceneToMeshes(scene());
    const e1 = extents(walls.find((w) => w.wallId === "w1")!);
    const e2 = extents(walls.find((w) => w.wallId === "w2")!);
    // Outer corner of the L: x = 4 + 0.05 (half of w2), y = 0 - 0.1 (half of w1).
    expect(e1.x1).toBeCloseTo(4.05);
    expect(e2.y0).toBeCloseTo(-0.1);
    expect(e1.y0).toBeCloseTo(-0.1);
    expect(e2.x1).toBeCloseTo(4.05);
    // Free ends are not extended.
    expect(e1.x0).toBeCloseTo(0);
    expect(e2.y1).toBeCloseTo(3);
  });
  it("does not extend collinear continuations or unshared ends", () => {
    const s = {
      id: "s",
      walls: [
        { id: "a", a: [0, 0], b: [2, 0], thickness_m: 0.2, kind: "interior" },
        { id: "b", a: [2, 0], b: [4, 0], thickness_m: 0.2, kind: "interior" },
      ],
    } as unknown as Scene;
    const { walls } = sceneToMeshes(s);
    expect(extents(walls[0]!).x1).toBeCloseTo(2);
  });
});
