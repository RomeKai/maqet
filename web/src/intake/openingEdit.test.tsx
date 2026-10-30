import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { openPlacemenFromSnappedTap } from "./opening";
import { editOpeningOps } from "./openingEdit";
import { OpeningSheet } from "./OpeningSheet";
import type { Opening, Wall } from "../scene/types";

const wall: Wall = { id: "w1", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" };
const door: Opening = { id: "o1", wall_id: "w1", kind: "door", offset_m: 1, width_m: 0.9, height_m: 2.05 };
const win: Opening = { id: "o2", wall_id: "w1", kind: "window", offset_m: 2, width_m: 1, height_m: 1.2, sill_m: 0.9 };

describe("two-tap placement defaults", () => {
  it("uses the default door width when the taps are closer than the minimum", () => {
    const r = openPlacemenFromSnappedTap(wall, "door", [2, 0], [2.05, 0]);
    if (!("placement" in r)) throw new Error("rejected");
    expect(r.placement.width_m).toBeCloseTo(0.9);
    expect(r.placement.offset_m).toBeCloseTo(2.025 - 0.45);
  });
  it("uses the default window width (1.00) for a tiny span, even with identical taps", () => {
    const r = openPlacemenFromSnappedTap(wall, "window", [1, 0], [1, 0]);
    if (!("placement" in r)) throw new Error("rejected");
    expect(r.placement.width_m).toBeCloseTo(1.0);
  });
  it("keeps the default opening inside the wall near an end", () => {
    const r = openPlacemenFromSnappedTap(wall, "door", [0, 0], [0.02, 0]);
    if (!("placement" in r)) throw new Error("rejected");
    expect(r.placement.offset_m).toBeGreaterThanOrEqual(0);
  });
  it("keeps a deliberate wide span as tapped", () => {
    const r = openPlacemenFromSnappedTap(wall, "door", [1, 0], [2.2, 0]);
    if (!("placement" in r)) throw new Error("rejected");
    expect(r.placement.width_m).toBeCloseTo(1.2);
  });
});

describe("editOpeningOps", () => {
  it("removes then marks with the same id and new size", () => {
    const ops = editOpeningOps(door, { width: 1.1, height: 2.1, sill: null });
    expect(ops[0]).toEqual({ type: "removeOpening", openingId: "o1" });
    expect(ops[1]).toMatchObject({ type: "markOpening", opening: { id: "o1", width_m: 1.1, height_m: 2.1 } });
  });
  it("keeps sill only for windows", () => {
    const [, mark] = editOpeningOps(win, { width: 1, height: 1.2, sill: 1 });
    expect(mark).toMatchObject({ opening: { sill_m: 1 } });
    const [, mark2] = editOpeningOps(door, { width: 1, height: 2, sill: 1 });
    expect(JSON.stringify(mark2)).not.toContain("sill_m");
  });
});

describe("OpeningSheet", () => {
  it("shows sill only for windows and a remove button", () => {
    const noop = (): void => {};
    const d = renderToString(<OpeningSheet locale="en" opening={door} wall={wall} onSave={noop} onRemove={noop} onClose={noop} />);
    const w = renderToString(<OpeningSheet locale="en" opening={win} wall={wall} onSave={noop} onRemove={noop} onClose={noop} />);
    expect(d).toContain("opening-width-input");
    expect(d).not.toContain("opening-sill-input");
    expect(w).toContain("opening-sill-input");
    expect(w).toContain("Remove");
  });
});
