import { describe, expect, it } from "vitest";
import { floorAreaM2 } from "./floorArea";
import type { Scene } from "../scene/types";

const w = (id: string, a: [number, number], b: [number, number]) => ({ id, a, b, thickness_m: 0.2, kind: "exterior" as const });

describe("floorAreaM2", () => {
  it("sums room polygons when rooms exist", () => {
    const s = { id: "s", walls: [], rooms: [
      { id: "r1", name: "a", polygon: [[0, 0], [3, 0], [3, 4], [0, 4]] },
      { id: "r2", name: "b", polygon: [[3, 0], [5, 0], [5, 2], [3, 2]] },
    ] } as unknown as Scene;
    expect(floorAreaM2(s)).toBeCloseTo(16);
  });
  it("falls back to the closed wall loop when there are no rooms", () => {
    const s = { id: "s", walls: [w("1", [0, 0], [3, 0]), w("2", [3, 0], [3, 8]), w("3", [3, 8], [0, 8]), w("4", [0, 8], [0, 0])] } as unknown as Scene;
    expect(floorAreaM2(s)).toBeCloseTo(24);
  });
  it("is null when nothing encloses an area", () => {
    expect(floorAreaM2({ id: "s", walls: [w("1", [0, 0], [3, 0])] } as unknown as Scene)).toBeNull();
  });
});
