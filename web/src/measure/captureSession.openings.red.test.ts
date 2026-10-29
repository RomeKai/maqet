import { describe, expect, it } from "vitest";
import { captureReducer, initialCaptureState, toSceneOps, type CaptureState } from "./captureSession";
import type { Vec3 } from "./cornerMath";

/**
 * RED-first tests for ar-capture-openings (F4, F5, F7).
 * These assert the contract the reducer + sceneToMeshes + review ops must satisfy.
 * They are expected to FAIL until the openings slice is implemented.
 */

const FLOOR_Y = 0.5;
const A: Vec3 = [0, FLOOR_Y, 0];
const B: Vec3 = [4, 0.9, 0];
const C: Vec3 = [4, 0.2, -3];
const D: Vec3 = [0, 0.7, -3];

function withFloor(s: CaptureState = initialCaptureState()): CaptureState {
  return captureReducer(s, { type: "floorHit", point: A, horizontal: true }).state;
}
function tapWall(state: CaptureState, base: Vec3, h: number): CaptureState {
  const afterBase = captureReducer(state, { type: "baseTap", point: base });
  const afterCeil = captureReducer(afterBase.state, { type: "ceilingTap", point: [base[0], FLOOR_Y + h, base[2]] });
  return afterCeil.state;
}
function closeRoomWith4Walls(): CaptureState {
  let s = withFloor();
  s = captureReducer(s, { type: "baseTap", point: A }).state;
  s = tapWall(s, B, 2.6);
  s = tapWall(s, C, 2.75);
  s = tapWall(s, D, 2.5);
  s = captureReducer(s, { type: "baseTap", point: [0.1, 1.1, 0.05] }).state;
  s = captureReducer(s, { type: "ceilingTap", point: [0, FLOOR_Y + 2.9, 0] }).state;
  return s;
}

describe("F4 openings: diagonal corners either order", () => {
  it("two diagonal taps in either order yield the same opening", () => {
    let s = closeRoomWith4Walls();
    s = captureReducer(s, { type: "modeChange", mode: "door" }).state;
    // Wall-1 is along x 0..4: taps at x=1 and x=3
    const first: Vec3 = [1, FLOOR_Y + 0.05, 0.05];
    const second: Vec3 = [3, FLOOR_Y + 2.0, -0.05];
    let sA = captureReducer(s, { type: "openingTap", point: first }).state;
    sA = captureReducer(sA, { type: "openingTap", point: second }).state;
    let sB = closeRoomWith4Walls();
    sB = captureReducer(sB, { type: "modeChange", mode: "door" }).state;
    sB = captureReducer(sB, { type: "openingTap", point: second }).state;
    sB = captureReducer(sB, { type: "openingTap", point: first }).state;
    expect(sA.openings).toHaveLength(1);
    expect(sB.openings).toHaveLength(1);
    expect(sA.openings[0]?.offset_m).toBeCloseTo(sB.openings[0]?.offset_m ?? NaN, 6);
    expect(sA.openings[0]?.width_m).toBeCloseTo(sB.openings[0]?.width_m ?? NaN, 6);
    expect(sA.openings[0]?.height_m).toBeCloseTo(sB.openings[0]?.height_m ?? NaN, 6);
  });
});

describe("F4 door snaps to floor", () => {
  it("door sill is null and height is top - floorY", () => {
    let s = closeRoomWith4Walls();
    s = captureReducer(s, { type: "modeChange", mode: "door" }).state;
    s = captureReducer(s, { type: "openingTap", point: [1, FLOOR_Y + 0.3, 0] }).state;
    s = captureReducer(s, { type: "openingTap", point: [2, FLOOR_Y + 2.0, 0] }).state;
    expect(s.openings).toHaveLength(1);
    expect(s.openings[0]?.sill_m).toBeNull();
    expect(s.openings[0]?.height_m).toBeCloseTo(2.0, 6);
  });
});

describe("F4 outside-the-wall rejected keeping first corner", () => {
  it("second tap outside wall keeps pending first, shows error", () => {
    let s = closeRoomWith4Walls();
    s = captureReducer(s, { type: "modeChange", mode: "door" }).state;
    s = captureReducer(s, { type: "openingTap", point: [1, FLOOR_Y + 0.1, 0] }).state;
    // second tap far beyond wall-1 end (x=99)
    const r = captureReducer(s, { type: "openingTap", point: [99, FLOOR_Y + 1, 0] });
    expect(r.error).not.toBeNull();
    // opening not created, pending first corner retained
    expect(r.state.openings).toHaveLength(0);
    expect(r.state.pendingOpening).not.toBeNull();
    expect(r.state.pendingOpening?.first).toEqual([1, FLOOR_Y + 0.1, 0]);
  });
});

describe("F4 door <0.80 kept and flagged", () => {
  it("narrow door is kept with flagged=true and survives to toSceneOps", () => {
    let s = closeRoomWith4Walls();
    s = captureReducer(s, { type: "modeChange", mode: "door" }).state;
    s = captureReducer(s, { type: "openingTap", point: [1, FLOOR_Y + 0.1, 0] }).state;
    s = captureReducer(s, { type: "openingTap", point: [1.5, FLOOR_Y + 2.0, 0] }).state;
    expect(s.openings).toHaveLength(1);
    expect(s.openings[0]?.width_m).toBeCloseTo(0.5, 6);
    expect(s.openings[0]?.flagged).toBe(true);
    const { ops, flaggedOpeningIds } = toSceneOps(s);
    const openings = ops.filter((o) => o.type === "markOpening");
    expect(openings).toHaveLength(1);
    expect(flaggedOpeningIds).toContain(s.openings[0]?.id);
  });
});

describe("F4 window sill kept", () => {
  it("window keeps sill = lower tap y - floorY and height = vertical span", () => {
    let s = closeRoomWith4Walls();
    s = captureReducer(s, { type: "modeChange", mode: "window" }).state;
    s = captureReducer(s, { type: "openingTap", point: [1, FLOOR_Y + 0.9, 0] }).state;
    s = captureReducer(s, { type: "openingTap", point: [2, FLOOR_Y + 2.1, 0] }).state;
    expect(s.openings).toHaveLength(1);
    expect(s.openings[0]?.sill_m).toBeCloseTo(0.9, 6);
    expect(s.openings[0]?.height_m).toBeCloseTo(1.2, 6);
  });
});

describe("F4 manual entry emits same ops as taps", () => {
  it("typed width/height/offset/sill equals tap-derived opening", () => {
    let sTap = closeRoomWith4Walls();
    sTap = captureReducer(sTap, { type: "modeChange", mode: "window" }).state;
    sTap = captureReducer(sTap, { type: "openingTap", point: [1, FLOOR_Y + 0.9, 0] }).state;
    sTap = captureReducer(sTap, { type: "openingTap", point: [2, FLOOR_Y + 2.1, 0] }).state;
    const wallId = sTap.openings[0]?.wall_id ?? "wall-1";
    let sMan = closeRoomWith4Walls();
    sMan = captureReducer(sMan, { type: "modeChange", mode: "window" }).state;
    sMan = captureReducer(sMan, {
      type: "openingManual",
      wallId,
      kind: "window",
      offsetM: 1,
      widthM: 1,
      heightM: 1.2,
      sillM: 0.9,
    }).state;
    const opsTap = toSceneOps(sTap).ops.filter((o) => o.type === "markOpening");
    const opsMan = toSceneOps(sMan).ops.filter((o) => o.type === "markOpening");
    expect(opsMan).toHaveLength(1);
    if (opsTap[0]?.type === "markOpening" && opsMan[0]?.type === "markOpening") {
      expect(opsMan[0].opening.offset_m).toBeCloseTo(opsTap[0].opening.offset_m, 6);
      expect(opsMan[0].opening.width_m).toBeCloseTo(opsTap[0].opening.width_m, 6);
      expect(opsMan[0].opening.height_m).toBeCloseTo(opsTap[0].opening.height_m, 6);
      expect(opsMan[0].opening.sill_m).toBeCloseTo(opsTap[0].opening.sill_m ?? 0, 6);
    }
  });
});

describe("F4 review-sheet edits emit right ops (store contract)", () => {
  it("wall length edit -> setWallLength measured_tape, height -> setWallHeight, opening -> remove+mark same id", async () => {
    const { wallEditOps, openingEditOps } = await import("./reviewSheetOps");
    const wOps = wallEditOps("wall-1", 4.2, 2.7, 4.0, 2.6);
    expect(wOps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "setWallLength", wallId: "wall-1", lengthM: 4.2, provenance: "measured_tape" }),
        expect.objectContaining({ type: "setWallHeight", wallId: "wall-1", heightM: 2.7 }),
      ]),
    );
    const o = { id: "opening-1", wall_id: "wall-1", kind: "door" as const, offset_m: 1, width_m: 0.9, height_m: 2, sill_m: null as number | null };
    const oOps = openingEditOps(o, { width_m: 1.0 });
    expect(oOps).toEqual([
      { type: "removeOpening", openingId: "opening-1" },
      expect.objectContaining({ type: "markOpening", opening: expect.objectContaining({ id: "opening-1", width_m: 1.0 }) }),
    ]);
  });
});

describe("F5 lintel and sill meshes", () => {
  it("door produces lintel, window produces lintel + sill (sceneToMeshes)", async () => {
    const { sceneToMeshes } = await import("../view3d/sceneToMeshes");
    const { createEmptyScene } = await import("../scene/store");
    let scene = createEmptyScene("lintel-test");
    scene = {
      ...scene,
      ceiling_height_m: 2.6,
      walls: [{ id: "w1", a: [0, 0], b: [4, 0], thickness_m: 0.1, kind: "interior", height_m: 2.6 }],
      openings: [
        { id: "o1", wall_id: "w1", kind: "door", offset_m: 1, width_m: 0.9, height_m: 2.0, sill_m: null },
        { id: "o2", wall_id: "w1", kind: "window", offset_m: 2.5, width_m: 0.9, height_m: 1.2, sill_m: 0.9 },
      ],
    };
    const meshes = sceneToMeshes(scene);
    // Expect side walls + lintels + sill: at least 4 segments for one wall with two openings
    expect(meshes.walls.length).toBeGreaterThan(2);
    // lintel above door exists (height 0.6)
    const lintelDoor = meshes.walls.find((w) => w.id.includes("o1") && w.id.includes("lintel"));
    expect(lintelDoor).toBeDefined();
    // sill below window exists
    const sillWin = meshes.walls.find((w) => w.id.includes("o2") && w.id.includes("sill"));
    expect(sillWin).toBeDefined();
  });
});

describe("F4+ F7 full scripted session 4 walls + door + window + Done", () => {
  it("asserts exact Scene ops", () => {
    let s = withFloor();
    s = captureReducer(s, { type: "baseTap", point: A }).state;
    s = tapWall(s, B, 2.6);
    s = tapWall(s, C, 2.75);
    s = tapWall(s, D, 2.5);
    s = captureReducer(s, { type: "baseTap", point: [0.1, 1.1, 0.05] }).state;
    s = captureReducer(s, { type: "ceilingTap", point: [0, FLOOR_Y + 2.9, 0] }).state;
    expect(s.closed).toBe(true);
    s = captureReducer(s, { type: "modeChange", mode: "door" }).state;
    // door on wall-1
    s = captureReducer(s, { type: "openingTap", point: [1, FLOOR_Y + 0.1, 0] }).state;
    s = captureReducer(s, { type: "openingTap", point: [1.9, FLOOR_Y + 2.0, 0] }).state;
    expect(s.openings).toHaveLength(1);
    s = captureReducer(s, { type: "modeChange", mode: "window" }).state;
    s = captureReducer(s, { type: "openingTap", point: [4, FLOOR_Y + 0.9, -1] }).state;
    s = captureReducer(s, { type: "openingTap", point: [4, FLOOR_Y + 2.1, -2] }).state;
    expect(s.openings).toHaveLength(2);
    s = captureReducer(s, { type: "done" }).state;
    const { ops } = toSceneOps(s);
    const wallOps = ops.filter((o) => o.type === "addWall");
    const openingOps = ops.filter((o) => o.type === "markOpening");
    expect(wallOps).toHaveLength(4);
    expect(openingOps).toHaveLength(2);
    expect(openingOps[0]?.type === "markOpening" && openingOps[0].opening.kind).toBe("door");
    expect(openingOps[1]?.type === "markOpening" && openingOps[1].opening.kind).toBe("window");
  });
});
