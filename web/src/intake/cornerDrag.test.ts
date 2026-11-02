import { describe, expect, it } from "vitest";
import { clusterHandles, previewEndpoint, type DragPreview } from "./CornerEditor";
import type { Wall } from "../scene/types";

const wall = (id: string, a: [number, number], b: [number, number]): Wall => ({ id, a, b, thickness_m: 0.2, kind: "exterior" });
// A 3 x 8 m rectangle, corners shared between consecutive walls.
const WALLS: Wall[] = [
  wall("w1", [0, 0], [3, 0]),
  wall("w2", [3, 0], [3, 8]),
  wall("w3", [3, 8], [0, 8]),
  wall("w4", [0, 8], [0, 0]),
];
const toDisplay = (x: number, y: number) => ({ x: x * 40, y: y * 40 });

describe("dragging a shared corner keeps the walls joined", () => {
  // The finger is 2 m away from the corner: well beyond the 12 px cluster tolerance.
  const preview: DragPreview = {
    wallId: "w1",
    end: "b",
    point: { x: 5, y: 0 },
    members: [{ wallId: "w1", end: "b" }, { wallId: "w2", end: "a" }],
  };

  it("moves every wall meeting at the corner to the live position", () => {
    expect(previewEndpoint(WALLS[0]!, "b", preview)).toEqual([5, 0]);
    expect(previewEndpoint(WALLS[1]!, "a", preview)).toEqual([5, 0]);
    expect(previewEndpoint(WALLS[1]!, "b", preview)).toEqual([3, 8]);
  });

  it("still shows one handle for the dragged corner (no split mid-drag)", () => {
    const handles = clusterHandles(WALLS, toDisplay, preview);
    expect(handles).toHaveLength(4);
    const dragged = handles.find((h) => h.members.some((m) => m.wallId === "w1" && m.end === "b"));
    expect(dragged?.members).toHaveLength(2);
  });
});
