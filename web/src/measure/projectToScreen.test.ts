import { describe, expect, it } from "vitest";
import { projectToScreen } from "./projectToScreen";

/**
 * Column-major 16-array for a 90-degree-fov perspective projection
 * (fovY = 90, aspect = 1, near = 1, far = 10), identity view:
 *
 *   row-major: [1 0 0 0; 0 1 0 0; 0 0 -11/9 -20/9; 0 0 -1 0]
 *
 * Stored column-major, as WebXR provides view.projectionMatrix.
 */
const PERSP_90: readonly number[] = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, -11 / 9, -1,
  0, 0, -20 / 9, 0,
];

const IDENTITY: readonly number[] = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const VIEWPORT = { width: 1000, height: 1000 };

describe("projectToScreen", () => {
  it("projects a point straight ahead to the screen center", () => {
    const got = projectToScreen(
      [0, 0, -2],
      { projectionMatrix: PERSP_90, viewInverse: IDENTITY },
      VIEWPORT,
    );
    expect(got.visible).toBe(true);
    expect(got.x).toBeCloseTo(500, 9);
    expect(got.y).toBeCloseTo(500, 9);
  });

  it("marks a point behind the camera as not visible", () => {
    const got = projectToScreen(
      [0, 0, 2],
      { projectionMatrix: PERSP_90, viewInverse: IDENTITY },
      VIEWPORT,
    );
    expect(got).toEqual({ x: 0, y: 0, visible: false });
  });

  it("projects an off-center point by hand-computed NDC math", () => {
    // clip = P * [1,0,-2,1]: x = 1, w = -z = 2 -> NDC x = 0.5.
    // x_px = (0.5 * 0.5 + 0.5) * 1000 = 750; y stays centered at 500.
    const got = projectToScreen(
      [1, 0, -2],
      { projectionMatrix: PERSP_90, viewInverse: IDENTITY },
      VIEWPORT,
    );
    expect(got.visible).toBe(true);
    expect(got.x).toBeCloseTo(750, 9);
    expect(got.y).toBeCloseTo(500, 9);
  });

  it("treats a degenerate w == 0 clip as not visible", () => {
    const zero: readonly number[] = new Array<number>(16).fill(0);
    const got = projectToScreen(
      [0, 0, -2],
      { projectionMatrix: zero, viewInverse: IDENTITY },
      VIEWPORT,
    );
    expect(got).toEqual({ x: 0, y: 0, visible: false });
  });
});
