import { describe, expect, it } from "vitest";
import type { Scene } from "../scene/types";
import { wallBadgeLayout } from "./sceneToMeshes";

function box(w: number, d: number): Scene {
  const pts: [number, number][] = [[0, 0], [w, 0], [w, d], [0, d]];
  return {
    id: "s",
    walls: pts.map((p, i) => ({ id: `w${i + 1}`, a: p, b: pts[(i + 1) % 4], thickness_m: 0.1, kind: "interior" })),
  } as unknown as Scene;
}

describe("wallBadgeLayout", () => {
  it("scales with the scene and is capped", () => {
    const small = wallBadgeLayout(box(0.7, 0.7)).size;
    const big = wallBadgeLayout(box(20, 20)).size;
    expect(small).toBeLessThan(0.15);
    expect(big).toBe(0.45);
    expect(wallBadgeLayout(box(4, 3)).size).toBeGreaterThan(small);
  });
  it("does not let badges overlap, even in a half square meter room", () => {
    const { size, badges } = wallBadgeLayout(box(0.7, 0.7));
    expect(badges).toHaveLength(4);
    for (let i = 0; i < badges.length; i += 1)
      for (let j = i + 1; j < badges.length; j += 1) {
        const [a, b] = [badges[i].position, badges[j].position];
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) >= size || Math.hypot(a[0] - b[0], a[1] - b[1]) >= size).toBe(true);
      }
  });
  it("is empty for an empty scene", () => {
    expect(wallBadgeLayout({ id: "s", walls: [] } as unknown as Scene).badges).toEqual([]);
  });
});
