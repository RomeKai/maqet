import { describe, expect, it } from "vitest";
import type { Scene, Wall } from "../scene/types";
import { summarizeFidelity } from "./summarizeFidelity";

function wall(id: string, provenance?: Wall["provenance"]): Wall {
  return { id, a: [0, 0], b: [3, 0], thickness_m: 0.2, kind: "exterior", ...(provenance ? { provenance } : {}) };
}

function scene(parts: Partial<Scene>): Scene {
  return { id: "s", ...parts };
}

describe("summarizeFidelity", () => {
  it("is Measured when every wall is measured", () => {
    const summary = summarizeFidelity(scene({ walls: [wall("w1", "measured_ar"), wall("w2", "measured_tape")] }));
    expect(summary.label).toBe("measured");
    expect(summary.counts).toEqual({ measured_ar: 1, measured_tape: 1, written_on_sketch: 0, estimated: 0 });
    expect(summary.estimatedWallIds).toEqual([]);
    expect(summary.hasConcept).toBe(false);
  });

  it("treats measurements written on a sketch as measured", () => {
    const summary = summarizeFidelity(scene({ walls: [wall("w1", "written_on_sketch"), wall("w2", "measured_tape")] }));
    expect(summary.label).toBe("measured");
    expect(summary.counts.written_on_sketch).toBe(1);
  });

  it("is Preliminary and lists the estimated walls when the Scene is mixed", () => {
    const summary = summarizeFidelity(
      scene({
        walls: [wall("w1", "measured_ar"), wall("w2", "estimated"), wall("w3", "written_on_sketch"), wall("w4", "estimated")],
      }),
    );
    expect(summary.label).toBe("preliminary");
    expect(summary.counts).toEqual({ measured_ar: 1, measured_tape: 0, written_on_sketch: 1, estimated: 2 });
    expect(summary.estimatedWallIds).toEqual(["w2", "w4"]);
  });

  it("is Preliminary when every wall is estimated", () => {
    const summary = summarizeFidelity(scene({ walls: [wall("w1", "estimated"), wall("w2", "estimated")] }));
    expect(summary.label).toBe("preliminary");
    expect(summary.estimatedWallIds).toEqual(["w1", "w2"]);
  });

  it("counts a wall without provenance as estimated", () => {
    const summary = summarizeFidelity(scene({ walls: [wall("w1", "measured_ar"), wall("w2")] }));
    expect(summary.label).toBe("preliminary");
    expect(summary.counts.estimated).toBe(1);
    expect(summary.estimatedWallIds).toEqual(["w2"]);
  });

  it("is Preliminary when there are no walls to vouch for", () => {
    expect(summarizeFidelity(scene({})).label).toBe("preliminary");
    expect(summarizeFidelity(scene({ walls: [] })).label).toBe("preliminary");
  });

  it("flags a concept piece of furniture", () => {
    const furniture = [
      { id: "f1", room_id: "r1", position: [1, 1] as [number, number], size_m: [1, 1, 1] as [number, number, number], concept: true },
    ];
    expect(summarizeFidelity(scene({ walls: [wall("w1", "measured_ar")], furniture })).hasConcept).toBe(true);
  });

  it("flags a concept material", () => {
    const materials = [{ id: "m1", source: "generated" as const, concept: true }];
    expect(summarizeFidelity(scene({ materials })).hasConcept).toBe(true);
  });

  it("does not flag catalog items that are not concept", () => {
    const furniture = [
      { id: "f1", room_id: "r1", position: [1, 1] as [number, number], size_m: [1, 1, 1] as [number, number, number], concept: false },
      { id: "f2", room_id: "r1", position: [2, 2] as [number, number], size_m: [1, 1, 1] as [number, number, number] },
    ];
    const materials = [{ id: "m1", source: "catalog" as const }];
    expect(summarizeFidelity(scene({ furniture, materials })).hasConcept).toBe(false);
  });

  it("does not mutate the Scene", () => {
    const walls = Object.freeze([Object.freeze(wall("w1", "estimated"))]) as Wall[];
    const input = Object.freeze(scene({ walls }));
    expect(() => summarizeFidelity(input)).not.toThrow();
  });
});
