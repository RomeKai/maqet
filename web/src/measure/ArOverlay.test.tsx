import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ArOverlay, computeOverlayLayout } from "./ArOverlay";
import type { OverlayFrame } from "./xrAdapter";
import type { Vec3 } from "./cornerMath";

/**
 * Same 90-degree-fov perspective fixture as projectToScreen.test.ts
 * (fovY = 90, aspect = 1, near = 1, far = 10), column-major, identity view.
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

function frame(reticle: Vec3 | null): OverlayFrame {
  return {
    reticle,
    view: { projection: [...PERSP_90], viewInverse: [...IDENTITY] },
    viewportW: 1000,
    viewportH: 1000,
  };
}

describe("computeOverlayLayout", () => {
  it("centers the reticle with no corners and no band", () => {
    const layout = computeOverlayLayout(frame([0, 0, -2]), [], "en");
    expect(layout.reticle?.visible).toBe(true);
    expect(layout.reticle?.x).toBeCloseTo(500, 9);
    expect(layout.reticle?.y).toBeCloseTo(500, 9);
    expect(layout.corners).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.band).toBeNull();
    expect(layout.closeLoop).toBe(false);
  });

  it("a null frame hides everything (no view to project with)", () => {
    const layout = computeOverlayLayout(null, [[0, 0, -2]], "en");
    expect(layout.reticle).toBeNull();
    expect(layout.corners).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.band).toBeNull();
    expect(layout.closeLoop).toBe(false);
  });

  it("a null reticle hides the ring and the rubber band", () => {
    const layout = computeOverlayLayout(frame(null), [[0, 0, -2]], "en");
    expect(layout.reticle).toBeNull();
    expect(layout.band).toBeNull();
    expect(layout.corners).toHaveLength(1);
    expect(layout.corners[0]?.visible).toBe(true);
    expect(layout.closeLoop).toBe(false);
  });

  it("draws the rubber band with the live floor-plane length label", () => {
    // Last corner at [0,0,-2], reticle at [3,0,-6]: floor-plane 3-4-5.
    const layout = computeOverlayLayout(
      frame([3, 0, -6]),
      [[0, 0, -2]],
      "en",
    );
    expect(layout.band?.lengthM).toBeCloseTo(5, 9);
    expect(layout.band?.label).toBe("5.00 m");
    // Band runs from the planted corner dot to the projected reticle.
    expect(layout.band?.x1).toBeCloseTo(500, 9);
    expect(layout.band?.y1).toBeCloseTo(500, 9);
    expect(layout.band?.x2).toBeCloseTo(750, 9);
    expect(layout.band?.y2).toBeCloseTo(500, 9);
  });

  it("formats the band label in es-AR", () => {
    const layout = computeOverlayLayout(
      frame([3, 0, -6]),
      [[0, 0, -2]],
      "es-AR",
    );
    expect(layout.band?.label).toBe("5,00 m");
  });

  it("flags close-loop when the reticle nears the first corner", () => {
    // ~0.11 m away: inside CLOSE_ROOM_M. The flag is a world-space check,
    // independent of whether the reticle projects on screen.
    const near = computeOverlayLayout(frame([0.1, 0, 0.05]), [[0, 0, 0]], "en");
    expect(near.closeLoop).toBe(true);
    const far = computeOverlayLayout(frame([1, 0, -2]), [[0, 0, 0]], "en");
    expect(far.closeLoop).toBe(false);
  });

  it("labels every visible edge with its floor-plane length", () => {
    // 3-4-5 on the floor plane: label is plan geometry, never screen pixels.
    const layout = computeOverlayLayout(
      frame([3, 0, -6]),
      [
        [0, 0, -2],
        [3, 0, -6],
      ],
      "en",
    );
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]?.lengthM).toBeCloseTo(5, 9);
    expect(layout.edges[0]?.label).toBe("5.00 m");
  });

  it("formats edge labels in es-AR", () => {
    const layout = computeOverlayLayout(
      frame([3, 0, -6]),
      [
        [0, 0, -2],
        [3, 0, -6],
      ],
      "es-AR",
    );
    expect(layout.edges[0]?.label).toBe("5,00 m");
  });

  it("keeps edges positional: a hidden pair yields null, never a shift", () => {
    // Pair 2 hides behind the camera: the slot stays null so the rAF loop
    // hides that line instead of misassigning later edges positionally.
    const layout = computeOverlayLayout(
      frame([1, 0, -2]),
      [
        [0, 0, -2],
        [1, 0, -2],
        [0, 0, 2],
      ],
      "en",
    );
    expect(layout.corners.map((c) => c.visible)).toEqual([true, true, false]);
    expect(layout.edges).toHaveLength(2);
    expect(layout.edges[0]?.label).toBe("1.00 m");
    expect(layout.edges[1]).toBeNull();
  });

  it("renders one edge-label text per corner pair for the rAF loop", () => {
    const html = renderToString(
      <ArOverlay
        frameRef={{ current: null }}
        corners={[
          [0, 0, -2],
          [1, 0, -2],
          [0, 0, 2],
        ]}
        locale="en"
      />,
    );
    expect(html.match(/ar-overlay-edge-label/g)).toHaveLength(2);
  });
});
