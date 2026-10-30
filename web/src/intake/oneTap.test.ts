import { describe, expect, it } from "vitest";
import { placeOpeningAtTap, TAP_SLOP_PX } from "./opening";
import type { Wall } from "../scene/types";

const wall: Wall = { id: "w1", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" };
const id = (x: number, y: number) => ({ x, y });
// display units are 100 per meter here, so 28 px at 1 unit/px = 0.28 m.
const toDisplay = (x: number, y: number) => ({ x: x * 100, y: y * 100 });

describe("one-tap opening placement", () => {
  it("centres a default door (0.90) at the tap", () => {
    const r = placeOpeningAtTap([wall], toDisplay, "door", [2, 0], 28);
    expect(r?.placement.width_m).toBeCloseTo(0.9);
    expect(r?.placement.offset_m).toBeCloseTo(2 - 0.45);
  });
  it("uses window 1.00 with a sill", () => {
    const r = placeOpeningAtTap([wall], toDisplay, "window", [1.5, 0], 28);
    expect(r?.placement.width_m).toBeCloseTo(1.0);
    expect(r?.placement.sill_m).toBeCloseTo(0.8);
  });
  it("clamps inside the wall near both ends", () => {
    const a = placeOpeningAtTap([wall], toDisplay, "door", [0.05, 0], 28);
    expect(a?.placement.offset_m).toBe(0);
    const b = placeOpeningAtTap([wall], toDisplay, "door", [3.98, 0], 28);
    expect((b?.placement.offset_m ?? 0) + (b?.placement.width_m ?? 0)).toBeCloseTo(4);
  });
  it("hits a wall within tolerance and misses beyond it", () => {
    expect(placeOpeningAtTap([wall], toDisplay, "door", [2, 0.2], 28)).not.toBeNull();
    expect(placeOpeningAtTap([wall], toDisplay, "door", [2, 0.5], 28)).toBeNull();
  });
  it("is not placed on a wall shorter than the opening", () => {
    const tiny: Wall = { ...wall, b: [0.5, 0] };
    expect(placeOpeningAtTap([tiny], toDisplay, "door", [0.25, 0], 28)).toBeNull();
  });
  it("exposes an 8px tap slop", () => {
    expect(TAP_SLOP_PX).toBe(8);
    expect(id(0, 0)).toBeTruthy();
  });
});
