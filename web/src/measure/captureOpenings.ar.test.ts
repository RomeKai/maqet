import { describe, expect, it } from "vitest";
import {
  AR_DOOR_HEIGHT_M,
  AR_WINDOW_HEIGHT_M,
  AR_WINDOW_SILL_M,
  captureReducer,
  initialCaptureState,
  openingStepKey,
  toHandoffOps,
  type CaptureEvent,
} from "./captureSession";
import { applySceneOp, createEmptyScene } from "../scene/store";

const Y = 0.5;
function run(events: CaptureEvent[]) {
  let state = initialCaptureState();
  const errors: (string | null)[] = [];
  for (const e of events) {
    const r = captureReducer(state, e);
    state = r.state;
    errors.push(r.error);
  }
  return { state, errors };
}
const oneWall: CaptureEvent[] = [
  { type: "floorHit", point: [0, Y, 0], horizontal: true },
  { type: "baseTap", point: [0, Y, 0] },
  { type: "baseTap", point: [4, Y, 0] },
  { type: "ceilingConfirm", heightM: 2.6 },
];

describe("openings in AR (door / window on a captured wall)", () => {
  it("unlocks Door and Window as soon as one wall exists (no need to close the room)", () => {
    const { state, errors } = run([...oneWall, { type: "modeChange", mode: "door" }]);
    expect(errors[errors.length - 1]).toBeNull();
    expect(state.mode).toBe("door");
  });

  it("keeps them locked with no wall", () => {
    const { errors } = run([{ type: "floorHit", point: [0, Y, 0], horizontal: true }, { type: "modeChange", mode: "window" }]);
    expect(errors[1]).toBe("mode-locked");
  });

  it("window: two taps along the wall give the width; sill 0.90 and height 1.20 come from the defaults", () => {
    const { state } = run([
      ...oneWall,
      { type: "modeChange", mode: "window" },
      { type: "openingTap", point: [1, 2.9, 0.02], defaults: true },
      { type: "openingTap", point: [2.2, 0.1, -0.03], defaults: true },
    ]);
    expect(state.openings).toHaveLength(1);
    const o = state.openings[0]!;
    expect(o.kind).toBe("window");
    expect(o.wall_id).toBe("wall-1");
    expect(o.offset_m).toBeCloseTo(1, 6);
    expect(o.width_m).toBeCloseTo(1.2, 6);
    expect(o.sill_m).toBe(AR_WINDOW_SILL_M);
    expect(o.height_m).toBe(AR_WINDOW_HEIGHT_M);
    expect([AR_WINDOW_SILL_M, AR_WINDOW_HEIGHT_M]).toEqual([0.9, 1.2]);
  });

  it("door: sill none, height 2.0, flagged when narrower than 0.80 m", () => {
    const wide = run([
      ...oneWall,
      { type: "modeChange", mode: "door" },
      { type: "openingTap", point: [0.5, 1, 0], defaults: true },
      { type: "openingTap", point: [1.4, 1, 0], defaults: true },
    ]).state.openings[0]!;
    expect(wide.sill_m).toBeNull();
    expect(wide.height_m).toBe(AR_DOOR_HEIGHT_M);
    expect(wide.flagged).toBe(false);
    const narrow = run([
      ...oneWall,
      { type: "modeChange", mode: "door" },
      { type: "openingTap", point: [0.5, 1, 0], defaults: true },
      { type: "openingTap", point: [1.2, 1, 0], defaults: true },
    ]).state.openings[0]!;
    expect(narrow.flagged).toBe(true);
  });

  it("guides the two taps", () => {
    const door = run([...oneWall, { type: "modeChange", mode: "door" }]).state;
    expect(openingStepKey(door)).toBe("opening.first");
    const half = captureReducer(door, { type: "openingTap", point: [1, 1, 0], defaults: true }).state;
    expect(openingStepKey(half)).toBe("opening.second");
  });

  it("walls can still be added after switching back (room not closed)", () => {
    const { state } = run([
      ...oneWall,
      { type: "modeChange", mode: "door" },
      { type: "modeChange", mode: "walls" },
      { type: "baseTap", point: [4, Y, -3] },
    ]);
    expect(state.walls).toHaveLength(2);
  });

  it("hands the opening to the Scene on Done with the window sill", () => {
    const { state } = run([
      ...oneWall,
      { type: "modeChange", mode: "window" },
      { type: "openingTap", point: [1, 1, 0], defaults: true },
      { type: "openingTap", point: [2, 1, 0], defaults: true },
    ]);
    let scene = createEmptyScene("a");
    for (const op of toHandoffOps(state)) scene = applySceneOp(scene, op);
    expect(scene.openings?.[0]?.sill_m).toBe(0.9);
    expect(scene.walls?.[0]?.provenance).toBe("measured_ar");
  });
});
