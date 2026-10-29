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

/** One base tap + one ceiling tap completes the pending wall. */
function tapWall(
  state: CaptureState,
  base: Vec3,
  heightM: number,
): CaptureState {
  const afterBase = captureReducer(state, { type: "baseTap", point: base });
  expect(afterBase.error).toBeNull();
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

  it("chains: the next wall starts at the previous end (one base + one ceiling)", () => {
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
    expect(state.walls[1]?.heightM).toBeCloseTo(2.75, 9);
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
    // ~11 cm from A: snaps to A, still followed by that wall's ceiling tap.
    const closeTap: Vec3 = [0.1, 1.1, 0.05];
    state = captureReducer(state, { type: "baseTap", point: closeTap }).state;
    expect(state.pendingEnd).toEqual({ x: 0, z: 0 });
    state = captureReducer(state, {
      type: "ceilingTap",
      point: [0, FLOOR_Y + 2.9, 0],
    }).state;
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
    expect(state.pendingEnd).toEqual({ x: 0.26, z: 0 });
  });

  it("keeps implausible heights with a flag, never drops them", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    state = captureReducer(state, { type: "baseTap", point: B }).state;
    state = captureReducer(state, {
      type: "ceilingTap",
      point: [4, FLOOR_Y + 1.5, 0],
    }).state;
    expect(state.walls).toHaveLength(1);
    // Raw value kept, flagged for the "check this" pill.
    expect(state.walls[0]?.heightM).toBeCloseTo(1.5, 9);
    expect(state.walls[0]?.flaggedHeight).toBe(true);
    state = tapWall(state, C, 4.5);
    expect(state.walls[1]?.heightM).toBeCloseTo(4.5, 9);
    expect(state.walls[1]?.flaggedHeight).toBe(true);
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
    state = captureReducer(state, {
      type: "ceilingTap",
      point: [0, FLOOR_Y + 2.9, 0],
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
  it("keeps a flagged height raw in the op and lists the wall id alongside", () => {
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    state = captureReducer(state, { type: "baseTap", point: B }).state;
    state = captureReducer(state, {
      type: "ceilingTap",
      point: [4, FLOOR_Y + 1.5, 0],
    }).state;
    const { ops, flaggedWallIds } = toSceneOps(state);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.type).toBe("addWall");
    if (ops[0]?.type === "addWall") {
      expect(ops[0].wall.height_m).toBeCloseTo(1.5, 9);
      expect(ops[0].wall.provenance).toBe("measured_ar");
    }
    expect(flaggedWallIds).toEqual(["wall-1"]);
  });

  it("a scripted 4-wall session emits the exact Scene ops", () => {
    // 4x3 m room, one height per wall, closing tap on corner A.
    let state = withFloor();
    state = captureReducer(state, { type: "baseTap", point: A }).state;
    state = tapWall(state, B, 2.6);
    state = tapWall(state, C, 2.75);
    state = tapWall(state, D, 2.5);
    state = captureReducer(state, {
      type: "baseTap",
      point: [0.1, 1.1, 0.05],
    }).state;
    state = captureReducer(state, {
      type: "ceilingTap",
      point: [0, FLOOR_Y + 2.9, 0],
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
    expect(walls.map((w) => w.height_m)).toEqual([2.6, 2.75, 2.5, 2.9]);
    expect(walls.every((w) => w.provenance === "measured_ar")).toBe(true);
    expect(walls.every((w) => w.thickness_m === 0.1)).toBe(true);
  });
});

describe("captureSession close threshold (W2)", () => {
  it("pins CLOSE_ROOM_M at the 0.25 m mission value", () => {
    expect(CLOSE_ROOM_M).toBe(0.25);
  });
});
