import { describe, expect, it } from "vitest";
import {
  captureReducer,
  initialCaptureState,
  stepKey,
  toSceneOps,
  type CaptureEvent,
  type CaptureState,
} from "./captureSession";
import type { Vec3 } from "./cornerMath";

/**
 * Item 0 (phone test): the ceiling height is ONE value per room, captured once
 * on wall 1 and reused for walls 2..N. An invalid or missing height must never
 * block adding the next walls.
 */
const FLOOR_Y = 0.5;
const A: Vec3 = [0, FLOOR_Y, 0];
const B: Vec3 = [4, FLOOR_Y, 0];
const C: Vec3 = [4, FLOOR_Y, -3];
const D: Vec3 = [0, FLOOR_Y, -3];

function run(events: CaptureEvent[], from: CaptureState = initialCaptureState()) {
  let state = from;
  const errors: (string | null)[] = [];
  for (const e of events) {
    const r = captureReducer(state, e);
    state = r.state;
    errors.push(r.error);
  }
  return { state, errors };
}

const START: CaptureEvent[] = [
  { type: "floorHit", point: A, horizontal: true },
  { type: "baseTap", point: A },
  { type: "baseTap", point: B },
];

describe("single room height", () => {
  it("captures a 4-wall room with ONE height tap", () => {
    const { state, errors } = run([
      ...START,
      { type: "ceilingConfirm", heightM: 2.6 },
      { type: "baseTap", point: C },
      { type: "baseTap", point: D },
      { type: "baseTap", point: [0.1, FLOOR_Y, 0.05] },
    ]);
    expect(errors.every((e) => e === null)).toBe(true);
    expect(state.walls).toHaveLength(4);
    expect(state.closed).toBe(true);
    expect(state.walls.map((w) => w.heightM)).toEqual([2.6, 2.6, 2.6, 2.6]);
    const { ops } = toSceneOps(state);
    expect(ops).toHaveLength(4);
    for (const op of ops) {
      if (op.type !== "addWall") throw new Error("expected addWall");
      expect(op.wall.height_m).toBe(2.6);
    }
  });

  it("asks for the ceiling only once: after wall 1 the next step is a base tap", () => {
    const afterB = run(START).state;
    expect(stepKey(afterB)).toBe("ceiling");
    const afterH = run([{ type: "ceilingConfirm", heightM: 2.7 }], afterB).state;
    expect(stepKey(afterH)).toBe("base");
    const afterC = run([{ type: "baseTap", point: C }], afterH).state;
    expect(stepKey(afterC)).toBe("base");
    expect(afterC.walls).toHaveLength(2);
  });

  it("rejects an implausible height without blocking: retype works", () => {
    const afterB = run(START).state;
    for (const bad of [1.1, 0.4, 4.6, 9]) {
      const r = captureReducer(afterB, { type: "ceilingConfirm", heightM: bad });
      expect(r.error).toBe("bad-height");
      expect(r.state).toBe(afterB);
    }
    const retried = run([{ type: "ceilingConfirm", heightM: 2.6 }], afterB);
    expect(retried.errors).toEqual([null]);
    expect(retried.state.walls).toHaveLength(1);
  });

  it("a ceiling point tap also sets the single room height", () => {
    const { state } = run([
      ...START,
      { type: "ceilingTap", point: [4, FLOOR_Y + 2.8, 0] },
      { type: "baseTap", point: C },
    ]);
    expect(state.walls.map((w) => w.heightM)).toEqual([2.8, 2.8]);
  });

  it("an out-of-range ceiling point tap is rejected, not stored", () => {
    const afterB = run(START).state;
    const r = captureReducer(afterB, { type: "ceilingTap", point: [4, FLOOR_Y + 1.1, 0] });
    expect(r.error).toBe("bad-height");
    expect(r.state.walls).toHaveLength(0);
  });

  it("setRoomHeight retypes the height for every wall already captured", () => {
    const base = run([
      ...START,
      { type: "ceilingConfirm", heightM: 2.6 },
      { type: "baseTap", point: C },
    ]).state;
    const r = captureReducer(base, { type: "setRoomHeight", heightM: 3.0 });
    expect(r.error).toBeNull();
    expect(r.state.walls.map((w) => w.heightM)).toEqual([3, 3]);
    expect(captureReducer(base, { type: "setRoomHeight", heightM: 6 }).error).toBe("bad-height");
  });

  it("a preset room height lets wall 1 complete on its second base tap", () => {
    const { state } = run([
      { type: "floorHit", point: A, horizontal: true },
      { type: "setRoomHeight", heightM: 2.6 },
      { type: "baseTap", point: A },
      { type: "baseTap", point: B },
    ]);
    expect(state.walls).toHaveLength(1);
    expect(state.walls[0]?.heightM).toBe(2.6);
  });

  it("undo walks back through chained walls and keeps the height", () => {
    const withTwo = run([
      ...START,
      { type: "ceilingConfirm", heightM: 2.6 },
      { type: "baseTap", point: C },
    ]).state;
    const undone = captureReducer(withTwo, { type: "undo" }).state;
    expect(undone.walls).toHaveLength(1);
    expect(undone.roomHeightM).toBe(2.6);
  });
});

describe("per-wall height override", () => {
  const room4: CaptureEvent[] = [
    ...START,
    { type: "ceilingConfirm", heightM: 2.6 },
    { type: "baseTap", point: C },
    { type: "baseTap", point: D },
    { type: "baseTap", point: [0.1, FLOOR_Y, 0.05] },
  ];

  it("overrides one wall to 2.40 m; the others keep the room height", () => {
    const { state } = run([...room4, { type: "setWallHeight", wallId: "wall-3", heightM: 2.4 }]);
    expect(state.walls.map((w) => w.heightM)).toEqual([2.6, 2.6, 2.4, 2.6]);
    const { ops } = toSceneOps(state);
    const heights = ops.map((op) => (op.type === "addWall" ? op.wall.height_m : null));
    expect(heights).toEqual([2.6, 2.6, 2.4, 2.6]);
  });

  it("a later room-height change leaves the overridden wall alone", () => {
    const { state } = run([
      ...room4,
      { type: "setWallHeight", wallId: "wall-3", heightM: 2.4 },
      { type: "setRoomHeight", heightM: 2.9 },
    ]);
    expect(state.walls.map((w) => w.heightM)).toEqual([2.9, 2.9, 2.4, 2.9]);
  });

  it("an overridden wall does not change what the next wall inherits", () => {
    const { state } = run([
      ...START,
      { type: "ceilingConfirm", heightM: 2.6 },
      { type: "baseTap", point: C },
      { type: "setWallHeight", wallId: "wall-2", heightM: 2.4 },
      { type: "baseTap", point: D },
    ]);
    expect(state.walls.map((w) => w.heightM)).toEqual([2.6, 2.4, 2.6]);
  });

  it("rejects an out-of-range or unknown-wall override and changes nothing", () => {
    const base = run(room4).state;
    const low = captureReducer(base, { type: "setWallHeight", wallId: "wall-2", heightM: 1.5 });
    expect(low.error).toBe("bad-height");
    expect(low.state).toBe(base);
    const unknown = captureReducer(base, { type: "setWallHeight", wallId: "nope", heightM: 2.4 });
    expect(unknown.error).toBe("no-pending");
    expect(unknown.state).toBe(base);
  });

  it("undo reverts the override", () => {
    const withOverride = run([...room4, { type: "setWallHeight", wallId: "wall-3", heightM: 2.4 }]).state;
    const undone = captureReducer(withOverride, { type: "undo" }).state;
    expect(undone.walls.map((w) => w.heightM)).toEqual([2.6, 2.6, 2.6, 2.6]);
  });
});
