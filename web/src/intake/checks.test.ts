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
    const items = buildChecks(scene, ["Dimension unclear"], t);
    expect(items.map((i) => i.text)).toEqual([
      "Dimension unclear",
      "Wall 2 length is estimated. Tap to confirm it.",
      "The door on wall 1 is narrower than 0.80 m.",
    ]);
  });
  it("links wall-based items to their wall so the editor can highlight it", () => {
    const items = buildChecks(scene, ["x"], t);
    expect(items[0]?.wallId).toBeNull();
    expect(items[1]?.wallId).toBe("b");
    expect(items[2]?.wallId).toBe("a");
  });
  it("is empty for a clean scene", () => {
    const clean = { ...scene, walls: [{ ...scene.walls![0]! }], openings: [] } as Scene;
    expect(buildChecks(clean, [], t)).toEqual([]);
  });
});
