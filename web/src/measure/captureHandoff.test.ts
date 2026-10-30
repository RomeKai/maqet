import { describe, expect, it } from "vitest";
import { applySceneOp, createEmptyScene } from "../scene/store";
import {
  captureReducer,
  initialCaptureState,
  toHandoffOps,
  type CaptureEvent,
} from "./captureSession";

const Y = 0.5;
const closedRoom: CaptureEvent[] = [
  { type: "floorHit", point: [0, Y, 0], horizontal: true },
  { type: "baseTap", point: [0, Y, 0] },
  { type: "baseTap", point: [4, Y, 0] },
  { type: "ceilingConfirm", heightM: 2.6 },
  { type: "baseTap", point: [4, Y, -3] },
  { type: "baseTap", point: [0, Y, -3] },
  { type: "baseTap", point: [0.05, Y, 0.05] },
];

function stateOf(events: CaptureEvent[]) {
  let s = initialCaptureState();
  for (const e of events) s = captureReducer(s, e).state;
  return s;
}

describe("Mode A hand-off to the shared Scene (same treatment as Mode C)", () => {
  it("a closed room yields walls, one room on the plan polygon and a confirmed scale", () => {
    let scene = createEmptyScene("a");
    for (const op of toHandoffOps(stateOf(closedRoom))) scene = applySceneOp(scene, op);
    expect(scene.walls).toHaveLength(4);
    expect(scene.walls?.every((w) => w.provenance === "measured_ar")).toBe(true);
    expect(scene.rooms).toHaveLength(1);
    expect(scene.rooms?.[0]?.polygon).toEqual([
      [0, -0],
      [4, -0],
      [4, 3],
      [0, 3],
    ]);
    expect(scene.scale_confirmed).toBe(true);
  });

  it("an open (finished) trace still confirms the scale but adds no room", () => {
    const open = stateOf([...closedRoom.slice(0, 5), { type: "finishWalls" }]);
    let scene = createEmptyScene("a");
    for (const op of toHandoffOps(open)) scene = applySceneOp(scene, op);
    expect(scene.walls).toHaveLength(2);
    expect(scene.rooms).toHaveLength(0);
    expect(scene.scale_confirmed).toBe(true);
  });

  it("an empty capture emits nothing", () => {
    expect(toHandoffOps(initialCaptureState())).toEqual([]);
  });

  it("a window keeps its measured sill and a door has none", () => {
    const s = stateOf([
      ...closedRoom,
      { type: "openingManual", wallId: "wall-1", kind: "window", offsetM: 1, widthM: 1.2, heightM: 1.2, sillM: 0.9 },
      { type: "openingManual", wallId: "wall-1", kind: "door", offsetM: 2.5, widthM: 0.9, heightM: 2.05, sillM: null },
    ]);
    let scene = createEmptyScene("a");
    for (const op of toHandoffOps(s)) scene = applySceneOp(scene, op);
    const win = scene.openings?.find((o) => o.kind === "window");
    const door = scene.openings?.find((o) => o.kind === "door");
    expect(win?.sill_m).toBe(0.9);
    expect(door?.sill_m ?? null).toBeNull();
  });
});
