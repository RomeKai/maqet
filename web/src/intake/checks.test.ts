import { describe, expect, it } from "vitest";
import { buildChecks } from "./checks";
import { getStrings } from "../i18n";
import type { Scene } from "../scene/types";

const t = getStrings("en");
const scene = {
  id: "s",
  walls: [
    { id: "a", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior", provenance: "written_on_sketch" },
    { id: "b", a: [4, 0], b: [4, 3], thickness_m: 0.2, kind: "exterior", provenance: "estimated" },
  ],
  openings: [{ id: "o", wall_id: "a", kind: "door", offset_m: 1, width_m: 0.7, height_m: 2 }],
} as unknown as Scene;

describe("buildChecks", () => {
  it("lists reading warnings, estimated walls and narrow doors", () => {
    const items = buildChecks(scene, ["kind_defaulted: null kind -> exterior, confirm with human"], t);
    expect(items.map((i) => i.text)).toEqual([
      t["intake.warn.kind_defaulted"],
      "Wall 2 length is estimated. Tap to confirm it.",
      "The door on wall 1 is narrower than 0.80 m.",
    ]);
  });
  it("links wall-based items to their wall so the editor can highlight it", () => {
    const items = buildChecks(scene, ["kind_defaulted: x"], t);
    expect(items[0]?.wallId).toBeNull();
    expect(items[1]?.wallId).toBe("b");
    expect(items[2]?.wallId).toBe("a");
  });
  it("is empty for a clean scene", () => {
    const clean = { ...scene, walls: [{ ...scene.walls![0]! }], openings: [] } as Scene;
    expect(buildChecks(clean, [], t)).toEqual([]);
  });

  it("never shows a raw engine string: known codes are translated, in both languages", () => {
    const raw = "kind_defaulted: null kind -> exterior, confirm with human";
    for (const locale of ["en", "es-AR"] as const) {
      const tl = getStrings(locale);
      const [item] = buildChecks(scene, [raw], tl);
      expect(item?.text).toBe(tl["intake.warn.kind_defaulted"]);
      expect(item?.text).not.toContain("kind_defaulted");
      expect(item?.text).not.toContain("->");
    }
    expect(getStrings("es-AR")["intake.warn.kind_defaulted"]).not.toBe(t["intake.warn.kind_defaulted"]);
  });

  it("falls back to a generic sentence for an unknown code or free text, never the raw string", () => {
    const items = buildChecks(scene, ["brand_new_code: something 3.2 m", "Dimension unclear"], t);
    const generic = items.filter((i) => i.id.startsWith("warn-"));
    expect(generic.map((i) => i.text)).toEqual([t["intake.warn.unknown"]]);
  });

  it("shows no stale measurements: a cached door width is not repeated, the item follows the Scene", () => {
    const cached = "opening: wall 1 door width 1.50 m from written label, verify with human";
    const withDoor = buildChecks(scene, [cached], t);
    expect(withDoor.some((i) => i.text === t["intake.warn.opening"])).toBe(true);
    expect(withDoor.map((i) => i.text).join(" ")).not.toMatch(/1\.50|1,50/);
    // Every opening gone: nothing left to describe, so the item disappears.
    const noOpenings = { ...scene, openings: [] } as Scene;
    expect(buildChecks(noOpenings, [cached], t).some((i) => i.text === t["intake.warn.opening"])).toBe(false);
  });

  it("drops the cached 'estimated' notice because estimated walls are derived from the Scene (and still flagged)", () => {
    const items = buildChecks(scene, ["estimated: walls 2 have no written length, confirm with human"], t);
    expect(items.filter((i) => i.id.startsWith("warn-"))).toEqual([]);
    expect(items.some((i) => i.id === "est-b")).toBe(true);
    const confirmed = {
      ...scene,
      walls: scene.walls!.map((w) => ({ ...w, provenance: "written_on_sketch" })),
    } as Scene;
    expect(buildChecks(confirmed, ["estimated: walls 2 have no written length"], t).some((i) => i.id.startsWith("est-"))).toBe(false);
  });

  it("collapses repeated codes into one item", () => {
    const items = buildChecks(scene, ["opening: wall 1 door width 0.9 m x", "opening: wall 2 window width 1.2 m x"], t);
    expect(items.filter((i) => i.text === t["intake.warn.opening"])).toHaveLength(1);
  });
});
