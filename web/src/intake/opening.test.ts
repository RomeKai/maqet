import { describe, expect, it } from "vitest";
import type { Wall, Opening } from "../scene/types";
import {
  tapsToPlacement,
  formToPlacement,
  validateAgainstWall,
  placementToOpening,
  projectOntoSegment,
} from "./opening";

const wall: Wall = {
  id: "w0",
  a: [0, 0],
  b: [4, 0],
  thickness_m: 0.1,
  kind: "interior",
};

describe("opening: taps", () => {
  it("two taps in either order give the same opening", () => {
    const a = tapsToPlacement(wall, "door", [0.5, 0], [2, 0]);
    const b = tapsToPlacement(wall, "door", [2, 0], [0.5, 0]);
    expect("placement" in a && "placement" in b).toBe(true);
    const pa = (a as { placement: { offset_m: number; width_m: number } }).placement;
    const pb = (b as { placement: { offset_m: number; width_m: number } }).placement;
    expect(pa.offset_m).toBeCloseTo(pb.offset_m, 9);
    expect(pa.width_m).toBeCloseTo(pb.width_m, 9);
  });

  it("two taps define correct offset and width", () => {
    const res = tapsToPlacement(wall, "window", [0, 0], [2, 0]);
    expect("placement" in res).toBe(true);
    const p = (res as { placement: { offset_m: number; width_m: number } }).placement;
    expect(p.offset_m).toBeCloseTo(0, 9);
    expect(p.width_m).toBeCloseTo(2, 9);
  });

  it("form and taps emit the same opening kind + offset/width", () => {
    const taps = tapsToPlacement(wall, "window", [0.4, 0], [1.8, 0]);
    expect("placement" in taps).toBe(true);
    const tp = (taps as { placement: { offset_m: number; width_m: number; kind: string; wallId: string } }).placement;
    const form = formToPlacement({
      wallId: wall.id,
      kind: "window",
      wallOffsetM: tp.offset_m,
      widthM: tp.width_m,
      heightM: 1.4,
      sillM: 0.8,
    });
    expect("placement" in form).toBe(true);
    const fp = (form as { placement: typeof tp }).placement;
    expect(fp.offset_m).toBeCloseTo(tp.offset_m, 9);
    expect(fp.width_m).toBeCloseTo(tp.width_m, 9);
    expect(fp.kind).toBe(tp.kind);
    expect(fp.wallId).toBe(tp.wallId);
  });

  it("outside-wall taps are rejected with reason", () => {
    // Far off the wall axis
    const res = tapsToPlacement(wall, "door", [0.2, 5], [0.8, 5]);
    expect("rejected" in res).toBe(true);
    expect((res as { rejected: { reason: string } }).rejected.reason).toBe("outside-wall");
  });

  it("outside-wall: tap beyond wall span is rejected", () => {
    const res = tapsToPlacement(wall, "door", [5, 0], [6, 0]);
    expect("rejected" in res).toBe(true);
    expect((res as { rejected: { reason: string } }).rejected.reason).toBe("outside-wall");
  });

  it("door < 0.80 m is kept (not rejected) — flagged elsewhere", () => {
    const res = tapsToPlacement(wall, "door", [0, 0], [0.5, 0]);
    expect("placement" in res).toBe(true);
    const p = (res as { placement: { width_m: number } }).placement;
    expect(p.width_m).toBeCloseTo(0.5, 9);
  });

  it("window sill kept in placement", () => {
    const res = tapsToPlacement(wall, "window", [0, 0], [1, 0]);
    expect("placement" in res).toBe(true);
    const p = (res as { placement: { sill_m?: number | null } }).placement;
    expect(typeof p.sill_m).toBe("number");
    expect(p.sill_m).toBeCloseTo(0.8, 9);
  });

  it("form window sill kept", () => {
    const res = formToPlacement({ wallId: wall.id, kind: "window", wallOffsetM: 0.2, widthM: 1, heightM: 1.1, sillM: 1.0 });
    expect("placement" in res).toBe(true);
    expect((res as { placement: { sill_m?: number | null } }).placement.sill_m).toBeCloseTo(1.0, 9);
  });

  it("validateAgainstWall rejects overflow", () => {
    expect(validateAgainstWall(wall, 3, 2)).not.toBeNull();
    expect(validateAgainstWall(wall, 0, 4)).toBeNull();
    expect(validateAgainstWall(wall, 1, 1)).toBeNull();
  });

  it("placementToOpening maps fields and keeps sill for window", () => {
    const opening: Opening = placementToOpening(
      { wallId: "w0", kind: "window", offset_m: 0.3, width_m: 1.2, height_m: 1.1, sill_m: 0.9 },
      "o1",
    );
    expect(opening.wall_id).toBe("w0");
    expect(opening.width_m).toBeCloseTo(1.2, 9);
    expect(opening.sill_m).toBeCloseTo(0.9, 9);
  });

  it("placementToOpening door has no spurious sill requirement", () => {
    const opening = placementToOpening(
      { wallId: "w0", kind: "door", offset_m: 0.3, width_m: 0.6, height_m: 2.05 },
      "o2",
    );
    expect(opening.kind).toBe("door");
    // sill is optional — absent is fine
    expect(opening.sill_m).toBeUndefined();
  });

  it("projectOntoSegment: on-wall point -> small perp", () => {
    const pr = projectOntoSegment([1, 0.02], [0, 0], [4, 0]);
    expect(pr.perp).toBeCloseTo(0.02, 9);
    expect(pr.t).toBeCloseTo(0.25, 9);
  });
});
