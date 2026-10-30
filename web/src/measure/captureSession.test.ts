import { describe, expect, it } from "vitest";
import {
  captureReducer,
  initialCaptureState,
  stepKey,
  toSceneOps,
  type CaptureState,
} from "./captureSession";
import { CLOSE_ROOM_M, type Vec3 } from "./cornerMath";

/**
 * RED-first tests for the Mode A walls capture reducer (mission
 * ar-capture-walls, W1-W3 + F1/F2/F6). Every behavior the phone cannot verify
 * tonight lives here: the React component only wires XR hits and taps to it.
 */

const FLOOR_Y = 0.5;
/** Corner taps carry whatever y the hit-test touched — plan position is x/z. */
const A: Vec3 = [0, FLOOR_Y, 0];
const B: Vec3 = [4, 0.9, 0];
const C: Vec3 = [4, 0.2, -3];
const D: Vec3 = [0, 0.7, -3];

function withFloor(state: CaptureState = initialCaptureState()): CaptureState {
  return captureReducer(state, {
    type: "floorHit",
    point: A,
    horizontal: true,
  }).state;
}

/**
 * One base tap completes the pending wall once the room height is known.
 * On wall 1 the height is still pending after the second base tap, so one
 * ceiling tap supplies it (the single room height, reused by every wall).
 */
function tapWall(
  state: CaptureState,
  base: Vec3,
  heightM: number,
): CaptureState {
  const afterBase = captureReducer(state, { type: "baseTap", point: base });
  expect(afterBase.error).toBeNull();
  if (afterBase.state.pendingEnd === null) return afterBase.state;
  const afterCeiling = captureReducer(afterBase.state, {
    type: "ceilingTap",
    point: [base[0], FLOOR_Y + heightM, base[2]],
  });
  expect(afterCeiling.error).toBeNull();
  return afterCeiling.state;
}

describe("captureSession floor datum (F1)", () => {
  it("ignores a non-horizontal floorHit: floorY stays null", () => {
    const result = captureReducer(initialCaptureState(), {
      type: "floorHit",
      point: A,
      horizontal: false,
    });
    expect(result.state.floorY).toBeNull();
    expect(result.error).toBeNull();
  });

  it("sets floorY from a horizontal floorHit only", () => {
    const next = withFloor();
    expect(next.floorY).toBe(FLOOR_Y);
  });

  it("rejects baseTap and ceilingTap before the floor is known", () => {
    const fresh = initialCaptureState();
    const base = captureReducer(fresh, { type: "baseTap", point: A });
    expect(base.error).toBe("floor-first");
    expect(base.state.walls).toEqual([]);
    expect(base.state.pendingStart).toBeNull();
    const ceiling = captureReducer(fresh, {
      type: "ceilingTap",
      point: [0, 3, 0],
    });
    expect(ceiling.error).toBe("floor-first");
    expect(ceiling.state.walls).toEqual([]);
  });
});

describe("captureSession walls flow (W1, W2)", () => {
  it("projects corners to floorY: tap y never leaks into plan geometry", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    state = captureReducer(state, { type: "baseTap", point: B }).state;
    state = captureReducer(state, {
      type: "ceilingTap",
      point: [9, FLOOR_Y + 2.6, 9],
    }).state;
    expect(state.walls).toHaveLength(1);
    // Tap y (0.5 / 0.9) dropped; plan corners are x/z.
    expect(state.walls[0]?.start).toEqual({ x: 0, z: 0 });
    expect(state.walls[0]?.end).toEqual({ x: 4, z: 0 });
    // Ceiling x/z ignored: height is tap y minus floorY.
    expect(state.walls[0]?.heightM).toBeCloseTo(2.6, 9);
    expect(state.walls[0]?.flaggedHeight).toBe(false);
  });

  it("wall 1 needs two bases + one ceiling: length + its own height", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    expect(state.pendingStart).toEqual({ x: 0, z: 0 });
    expect(state.walls).toHaveLength(0);
    state = captureReducer(state, { type: "baseTap", point: B }).state;
    expect(state.pendingEnd).toEqual({ x: 4, z: 0 });
    expect(state.walls).toHaveLength(0);
    state = captureReducer(state, {
      type: "ceilingTap",
      point: [4, FLOOR_Y + 2.6, 0],
    }).state;
    expect(state.walls).toHaveLength(1);
    expect(state.walls[0]?.id).toBe("wall-1");
  });

  it("chains: the next wall starts at the previous end (one base tap)", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    state = captureReducer(state, { type: "baseTap", point: B }).state;
    state = captureReducer(state, {
      type: "ceilingTap",
      point: [4, FLOOR_Y + 2.6, 0],
    }).state;
    // pendingStart already chained to B: one base tap opens wall 2.
    expect(state.pendingStart).toEqual({ x: 4, z: 0 });
    state = tapWall(state, C, 2.75);
    expect(state.walls).toHaveLength(2);
    expect(state.walls[1]?.id).toBe("wall-2");
    expect(state.walls[1]?.start).toEqual({ x: 4, z: 0 });
    expect(state.walls[1]?.end).toEqual({ x: 4, z: -3 });
    // Single room height from wall 1 is reused.
    expect(state.walls[1]?.heightM).toBeCloseTo(2.6, 9);
  });

  it("rejects a ceiling tap with no pending wall", () => {
    const state = withFloor();
    const next = captureReducer(state, {
      type: "ceilingTap",
      point: [0, FLOOR_Y + 2.6, 0],
    });
    expect(next.error).toBe("no-pending");
    expect(next.state.walls).toHaveLength(0);
  });

  it("closes on a base tap within 0.25 m of corner A (W2)", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    state = captureReducer(state, { type: "baseTap", point: B }).state;
    state = captureReducer(state, {
      type: "ceilingTap",
      point: [4, FLOOR_Y + 2.6, 0],
    }).state;
    state = tapWall(state, C, 2.75);
    state = tapWall(state, D, 2.5);
    expect(state.walls).toHaveLength(3);
    // ~11 cm from A: snaps to A and closes the room in the same tap.
    const closeTap: Vec3 = [0.1, 1.1, 0.05];
    state = captureReducer(state, { type: "baseTap", point: closeTap }).state;
    expect(state.closed).toBe(true);
    expect(state.walls).toHaveLength(4);
    expect(state.walls[3]?.end).toEqual(state.walls[0]?.start);
  });

  it("a base tap at 0.26 m from corner A does NOT close", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    state = captureReducer(state, { type: "baseTap", point: B }).state;
    state = captureReducer(state, {
      type: "ceilingTap",
      point: [4, FLOOR_Y + 2.6, 0],
    }).state;
    state = tapWall(state, C, 2.75);
    state = tapWall(state, D, 2.5);
    const farTap: Vec3 = [0.26, FLOOR_Y, 0];
    state = captureReducer(state, { type: "baseTap", point: farTap }).state;
    expect(state.closed).toBe(false);
    expect(state.walls).toHaveLength(4);
    expect(state.pendingStart).toEqual({ x: 0.26, z: 0 });
  });

  it("rejects an implausible height (retype), then walls 2..N still work", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    state = captureReducer(state, { type: "baseTap", point: B }).state;
    const bad = captureReducer(state, {
      type: "ceilingTap",
      point: [4, FLOOR_Y + 1.5, 0],
    });
    expect(bad.error).toBe("bad-height");
    expect(bad.state.walls).toHaveLength(0);
    state = captureReducer(bad.state, {
      type: "ceilingTap",
      point: [4, FLOOR_Y + 2.6, 0],
    }).state;
    state = tapWall(state, C, 4.5);
    expect(state.walls).toHaveLength(2);
    expect(state.walls[1]?.heightM).toBeCloseTo(2.6, 9);
  });
});

describe("captureSession undo + start over (F2)", () => {
  it("undo steps back across ceiling then base taps", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    state = captureReducer(state, { type: "baseTap", point: B }).state;
    state = captureReducer(state, {
      type: "ceilingTap",
      point: [4, FLOOR_Y + 2.6, 0],
    }).state;
    expect(state.walls).toHaveLength(1);
    // Undo the ceiling tap: completion -> pending (both bases kept).
    state = captureReducer(state, { type: "undo" }).state;
    expect(state.walls).toHaveLength(0);
    expect(state.pendingStart).toEqual({ x: 0, z: 0 });
    expect(state.pendingEnd).toEqual({ x: 4, z: 0 });
    // Undo the second base: pending -> one corner.
    state = captureReducer(state, { type: "undo" }).state;
    expect(state.pendingStart).toEqual({ x: 0, z: 0 });
    expect(state.pendingEnd).toBeNull();
    // Undo the first base: empty (floor datum survives — it is not a tap).
    state = captureReducer(state, { type: "undo" }).state;
    expect(state.pendingStart).toBeNull();
    expect(state.floorY).toBe(FLOOR_Y);
  });

  it("undo with an empty stack changes nothing", () => {
    const state = withFloor();
    const next = captureReducer(state, { type: "undo" });
    expect(next.error).toBeNull();
    expect(next.state.walls).toEqual([]);
  });

  it("startOver clears walls, pending, floorY and flags immediately", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    state = captureReducer(state, { type: "baseTap", point: B }).state;
    state = captureReducer(state, {
      type: "ceilingTap",
      point: [4, FLOOR_Y + 1.5, 0],
    }).state;
    state = captureReducer(state, { type: "finishWalls" }).state;
    state = captureReducer(state, { type: "startOver" }).state;
    expect(state).toEqual(initialCaptureState());
  });
});

describe("captureSession unlock (W3)", () => {
  it("rejects door/window mode before closing or finishing", () => {
    const state = withFloor();
    const door = captureReducer(state, {
      type: "modeChange",
      mode: "door",
    });
    expect(door.error).toBe("mode-locked");
    expect(door.state.mode).toBe("walls");
    const window = captureReducer(state, {
      type: "modeChange",
      mode: "window",
    });
    expect(window.error).toBe("mode-locked");
  });

  it("finishWalls unlocks door and window modes", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "finishWalls" }).state;
    expect(state.finished).toBe(true);
    state = captureReducer(state, { type: "modeChange", mode: "door" }).state;
    expect(state.mode).toBe("door");
  });

  it("closing the room unlocks without finishWalls", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    state = captureReducer(state, { type: "baseTap", point: B }).state;
    state = captureReducer(state, {
      type: "ceilingTap",
      point: [4, FLOOR_Y + 2.6, 0],
    }).state;
    state = tapWall(state, C, 2.75);
    state = tapWall(state, D, 2.5);
    state = captureReducer(state, {
      type: "baseTap",
      point: [0.1, 1.1, 0.05],
    }).state;
    expect(state.closed).toBe(true);
    state = captureReducer(state, {
      type: "modeChange",
      mode: "window",
    }).state;
    expect(state.mode).toBe("window");
  });
});

describe("captureSession stepKey (F6)", () => {
  it("walks floor -> base -> end -> ceiling -> finished", () => {
    let state = initialCaptureState();
    expect(stepKey(state)).toBe("floor");
    state = withFloor(state);
    expect(stepKey(state)).toBe("base");
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    expect(stepKey(state)).toBe("end");
    state = captureReducer(state, { type: "baseTap", point: B }).state;
    expect(stepKey(state)).toBe("ceiling");
    state = captureReducer(state, {
      type: "ceilingTap",
      point: [4, FLOOR_Y + 2.6, 0],
    }).state;
    // Wall 1 mapped, wall 2 chained: next tap is a base again.
    expect(stepKey(state)).toBe("base");
    state = captureReducer(state, { type: "finishWalls" }).state;
    expect(stepKey(state)).toBe("finished");
  });
});

describe("captureSession toSceneOps", () => {
  it("emits the single room height on every wall op, nothing flagged", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    state = tapWall(state, B, 2.8);
    state = tapWall(state, C, 2.8);
    const { ops, flaggedWallIds } = toSceneOps(state);
    expect(ops).toHaveLength(2);
    for (const op of ops) {
      if (op.type !== "addWall") throw new Error("expected addWall");
      expect(op.wall.height_m).toBeCloseTo(2.8, 9);
      expect(op.wall.provenance).toBe("measured_ar");
    }
    expect(flaggedWallIds).toEqual([]);
  });

  it("a scripted 4-wall session emits the exact Scene ops", () => {
    // 4x3 m room, one room height, closing tap on corner A.
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    state = tapWall(state, B, 2.6);
    state = tapWall(state, C, 2.75);
    state = tapWall(state, D, 2.5);
    state = captureReducer(state, {
      type: "baseTap",
      point: [0.1, 1.1, 0.05],
    }).state;
    expect(state.closed).toBe(true);
    const { ops, flaggedWallIds } = toSceneOps(state);
    expect(flaggedWallIds).toEqual([]);
    expect(ops).toHaveLength(4);
    const walls = ops.map((op) => {
      if (op.type !== "addWall") throw new Error("expected addWall");
      return op.wall;
    });
    expect(walls.map((w) => w.id)).toEqual([
      "wall-1",
      "wall-2",
      "wall-3",
      "wall-4",
    ]);
    // Plan mapping [x, -z]: the room closes into a loop. -z of 0 is -0,
    // matching the pairCornersToNewWall convention asserted in
    // cornerMath.test.ts ([0, -0]).
    expect(walls.map((w) => [w.a, w.b])).toEqual([
      [
        [0, -0],
        [4, -0],
      ],
      [
        [4, -0],
        [4, 3],
      ],
      [
        [4, 3],
        [0, 3],
      ],
      [
        [0, 3],
        [0, -0],
      ],
    ]);
    expect(walls.map((w) => w.measured_length_m)).toEqual([4, 3, 4, 3]);
    expect(walls.map((w) => w.height_m)).toEqual([2.6, 2.6, 2.6, 2.6]);
    expect(walls.every((w) => w.provenance === "measured_ar")).toBe(true);
    expect(walls.every((w) => w.thickness_m === 0.1)).toBe(true);
  });
});

describe("captureSession close threshold (W2)", () => {
  it("pins CLOSE_ROOM_M at the 0.25 m mission value", () => {
    expect(CLOSE_ROOM_M).toBe(0.25);
  });
});

describe("captureSession hardening (stage 3/4)", () => {
  it("ignores a base tap identical to the pending start: no zero-length wall", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    // Exact double-tap (finger bounce): same plan position as pendingStart.
    const dup = captureReducer(state, { type: "baseTap", point: A });
    expect(dup.error).toBeNull();
    expect(dup.state.pendingEnd).toBeNull();
    expect(dup.state.walls).toHaveLength(0);
    state = dup.state;
    // Session continues normally: wall 1 is A -> B, id wall-1.
    state = captureReducer(state, { type: "baseTap", point: B }).state;
    state = captureReducer(state, {
      type: "ceilingTap",
      point: [4, FLOOR_Y + 2.6, 0],
    }).state;
    expect(state.walls).toHaveLength(1);
    expect(state.walls[0]?.id).toBe("wall-1");
    expect(state.walls[0]?.start).toEqual({ x: 0, z: 0 });
    expect(state.walls[0]?.end).toEqual({ x: 4, z: 0 });
    // Chained duplicate: tapping the chained start again opens nothing.
    const chained = captureReducer(state, { type: "baseTap", point: B });
    expect(chained.error).toBeNull();
    expect(chained.state.pendingEnd).toBeNull();
    expect(chained.state.walls).toHaveLength(1);
  });

  it("a close tap completes the room at once and undo re-opens it", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    state = tapWall(state, B, 2.6);
    state = tapWall(state, C, 2.75);
    state = tapWall(state, D, 2.5);
    expect(state.walls).toHaveLength(3);
    state = captureReducer(state, {
      type: "baseTap",
      point: [0.1, 1.1, 0.05],
    }).state;
    expect(state.closed).toBe(true);
    expect(state.walls).toHaveLength(4);
    state = captureReducer(state, { type: "undo" }).state;
    expect(state.closed).toBe(false);
    expect(state.walls).toHaveLength(3);
    const E: Vec3 = [1, FLOOR_Y, -1];
    state = captureReducer(state, { type: "baseTap", point: E }).state;
    expect(state.closed).toBe(false);
    expect(state.walls).toHaveLength(4);
    expect(state.walls[3]?.end).toEqual({ x: 1, z: -1 });
  });

  it("ignores base and ceiling taps after done: Done means done", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    state = tapWall(state, B, 2.6);
    state = captureReducer(state, { type: "done" }).state;
    expect(state.done).toBe(true);
    const afterBase = captureReducer(state, { type: "baseTap", point: C });
    expect(afterBase.error).toBeNull();
    expect(afterBase.state.walls).toHaveLength(1);
    expect(afterBase.state.pendingEnd).toBeNull();
    const afterCeiling = captureReducer(afterBase.state, {
      type: "ceilingTap",
      point: [4, FLOOR_Y + 2.6, -3],
    });
    expect(afterCeiling.error).toBeNull();
    expect(afterCeiling.state.walls).toHaveLength(1);
  });

  it("stepKey reports finished once the session is done", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    expect(stepKey(state)).toBe("end");
    state = captureReducer(state, { type: "done" }).state;
    expect(stepKey(state)).toBe("finished");
  });

  it("mode selection is not undoable: undo reverts content, not the tool", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    state = tapWall(state, B, 2.6);
    state = captureReducer(state, { type: "finishWalls" }).state;
    state = captureReducer(state, { type: "modeChange", mode: "door" }).state;
    state = captureReducer(state, { type: "modeChange", mode: "walls" }).state;
    // One undo reverts the finish itself — the two mode flips cost no depth.
    state = captureReducer(state, { type: "undo" }).state;
    expect(state.finished).toBe(false);
    expect(state.mode).toBe("walls");
    expect(state.walls).toHaveLength(1);
  });
});
