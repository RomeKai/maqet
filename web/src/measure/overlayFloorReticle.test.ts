import { describe, expect, it } from "vitest";
import { computeWallsOverlayLayout } from "./ArOverlay";
import { projectToScreen } from "./projectToScreen";
import type { OverlayFrame } from "./xrAdapter";
import type { CapturedOpening } from "./captureSession";

/** Camera at (0,1.4,0) pitched down 30 degrees; simple perspective projection. */
function frame(reticle: [number, number, number] | null): OverlayFrame {
  const th = Math.PI / 6;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const eyeY = 1.4;
  const view = [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, -eyeY * c, -eyeY * s, 1];
  const projection = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.02, -1, 0, 0, -0.2, 0];
  return { reticle, view: { projection, viewInverse: view }, viewportW: 400, viewportH: 800 };
}
const matrices = (f: OverlayFrame) => ({ projectionMatrix: f.view.projection, viewInverse: f.view.viewInverse });

describe("reticle returns to the floor after the height step", () => {
  const start = { x: 0, z: -1 };

  it("replaces a wall-height hit-test pose with the center ray on the floor plane", () => {
    const f = frame([0, 1.0, -3]); // pose on a wall, 1 m above the floor
    const layout = computeWallsOverlayLayout(f, [], start, null, 0, "en");
    const floorPoint = projectToScreen([0, 0, -2.4249], matrices(f), { width: 400, height: 800 });
    expect(layout.reticle?.visible).toBe(true);
    expect(layout.reticle?.x).toBeCloseTo(floorPoint.x, 0);
    expect(layout.reticle?.y).toBeCloseTo(floorPoint.y, 0);
    // The dashed band ends on that floor point, not at mid-height.
    expect(layout.band?.x2).toBeCloseTo(floorPoint.x, 0);
    expect(layout.band?.y2).toBeCloseTo(floorPoint.y, 0);
  });

  it("keeps a real floor hit as is", () => {
    const f = frame([0.2, 0.05, -2]);
    const layout = computeWallsOverlayLayout(f, [], start, null, 0, "en");
    const p = projectToScreen([0.2, 0, -2], matrices(f), { width: 400, height: 800 });
    expect(layout.reticle?.x).toBeCloseTo(p.x, 0);
    expect(layout.reticle?.y).toBeCloseTo(p.y, 0);
  });

  it("hides reticle and band during the height step and reports the live ray height", () => {
    const f = frame([0, 1.0, -3]);
    const layout = computeWallsOverlayLayout(f, [], start, { x: 3, z: -1 }, 0, "en");
    expect(layout.reticle).toBeNull();
    expect(layout.band).toBeNull();
    // Center ray crosses the plane z=-1 at y = 1.4 - tan(30deg) * 1 = 0.823
    expect(layout.ceilingPreviewM).toBeCloseTo(1.4 - Math.tan(Math.PI / 6), 3);
  });

  it("hides the floor aids while the Door / Window tool is active", () => {
    const layout = computeWallsOverlayLayout(frame([0, 0, -2]), [], start, null, 0, "en", { openingTool: true });
    expect(layout.reticle).toBeNull();
  });
});

describe("captured openings are drawn on their wall", () => {
  const wall = { id: "wall-1", start: { x: -1, z: -3 }, end: { x: 1, z: -3 }, heightM: 2.6, flaggedHeight: false };
  const door: CapturedOpening = { id: "opening-1", wall_id: "wall-1", kind: "door", offset_m: 0.5, width_m: 0.9, height_m: 2, sill_m: null, flagged: false };
  const win: CapturedOpening = { id: "opening-2", wall_id: "wall-1", kind: "window", offset_m: 1.2, width_m: 0.6, height_m: 1.2, sill_m: 0.9, flagged: false };

  it("projects a quad per opening with its kind", () => {
    const layout = computeWallsOverlayLayout(frame(null), [wall], null, null, 0, "en", { openings: [door, win] });
    expect(layout.openingQuads.map((q) => q.kind)).toEqual(["door", "window"]);
    expect(layout.openingQuads.every((q) => q.visible && q.points.split(" ").length === 4)).toBe(true);
  });
});
