import { describe, expect, it } from "vitest";
import { MIN_PILL_PX, pillMetrics, provenanceKind } from "./wallPill";
import type { Wall } from "../scene/types";

const wall = (provenance?: Wall["provenance"]): Wall =>
  ({ id: "w", a: [0, 0], b: [1, 0], thickness_m: 0.2, kind: "exterior", provenance }) as Wall;

describe("wall length pill", () => {
  it("keeps the font at least 14 screen px at any photo zoom", () => {
    for (const unitsPerPx of [0.25, 1, 2.7, 6]) {
      const m = pillMetrics("W1 · 4,00 m", unitsPerPx);
      expect(m.fontUnits / unitsPerPx).toBeGreaterThanOrEqual(MIN_PILL_PX);
      expect(m.heightUnits).toBeGreaterThan(m.fontUnits);
    }
  });
  it("widens with the label", () => {
    expect(pillMetrics("W1 · 10,00 m", 1).widthUnits).toBeGreaterThan(pillMetrics("W1 · 1 m", 1).widthUnits);
  });
  it("maps provenance to written / measured / estimated", () => {
    expect(provenanceKind(wall("written_on_sketch"))).toBe("written");
    expect(provenanceKind(wall("measured_tape"))).toBe("measured");
    expect(provenanceKind(wall("measured_ar"))).toBe("measured");
    expect(provenanceKind(wall("estimated"))).toBe("estimated");
    expect(provenanceKind(wall(undefined))).toBe("estimated");
  });
});
