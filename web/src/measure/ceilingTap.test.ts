import { describe, expect, it } from "vitest";
import {
  captureReducer,
  initialCaptureState,
  type CaptureState,
} from "./captureSession";
import type { Vec3 } from "./cornerMath";

const FLOOR_Y = 0.5;
const A: Vec3 = [0, FLOOR_Y, 0];
const B: Vec3 = [4, FLOOR_Y, 0];

function withFloor(s: CaptureState = initialCaptureState()): CaptureState {
  return captureReducer(s, { type: "floorHit", point: A, horizontal: true }).state;
}

describe("fix 2: ceiling step no longer needs a hit-test (ceilingConfirm with typed height)", () => {
  it("ceilings via explicit height: ceilingConfirm finalizes the pending wall", () => {
    let s = withFloor();
    s = captureReducer(s, { type: "baseTap", point: A }).state;
    s = captureReducer(s, { type: "baseTap", point: B }).state;
    const r = captureReducer(s, { type: "ceilingConfirm", heightM: 2.6 });
    expect(r.error).toBeNull();
    expect(r.state.walls).toHaveLength(1);
    expect(r.state.walls[0]?.heightM).toBeCloseTo(2.6, 9);
    expect(r.state.walls[0]?.flaggedHeight).toBe(false);
    expect(r.state.pendingStart).toEqual({ x: 4, z: 0 });
    expect(r.state.pendingEnd).toBeNull();
  });

  it("typed outside 2-4 m is still kept, flagged per existing rules", () => {
    let s = withFloor();
    s = captureReducer(s, { type: "baseTap", point: A }).state;
    s = captureReducer(s, { type: "baseTap", point: B }).state;
    const r = captureReducer(s, { type: "ceilingConfirm", heightM: 1.2 });
    expect(r.state.walls[0]?.heightM).toBeCloseTo(1.2, 9);
    expect(r.state.walls[0]?.flaggedHeight).toBe(true);
  });

  it("rejects non-finite or non-positive typed height", () => {
    let s = withFloor();
    s = captureReducer(s, { type: "baseTap", point: A }).state;
    s = captureReducer(s, { type: "baseTap", point: B }).state;
    expect(captureReducer(s, { type: "ceilingConfirm", heightM: NaN }).error).toBe("bad-tap");
    expect(captureReducer(s, { type: "ceilingConfirm", heightM: 0 }).error).toBe("bad-tap");
    expect(captureReducer(s, { type: "ceilingConfirm", heightM: -1 }).error).toBe("bad-tap");
  });

  it("still rejects when there is no pending wall", () => {
    const s = withFloor();
    expect(captureReducer(s, { type: "ceilingConfirm", heightM: 2.6 }).error).toBe("no-pending");
  });

  it("legacy ceilingTap continues to work (tap y minus floorY)", () => {
    let s = withFloor();
    s = captureReducer(s, { type: "baseTap", point: A }).state;
    s = captureReducer(s, { type: "baseTap", point: B }).state;
    const r = captureReducer(s, { type: "ceilingTap", point: [4, FLOOR_Y + 2.6, 0] });
    expect(r.error).toBeNull();
    expect(r.state.walls[0]?.heightM).toBeCloseTo(2.6, 9);
  });
});
