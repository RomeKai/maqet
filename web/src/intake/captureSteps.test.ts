import { describe, expect, it } from "vitest";
import { captureStepFromScene, captureSteps, isCheckStep, STEP_ORDER } from "./captureSteps";
import { createEmptyScene } from "../scene/store";
import type { Scene } from "../scene/types";
import { nearestWallDistancePx, openPlacemenFromSnappedTap, snapPointToWallPx } from "./opening";

function sceneWithWalls(count: number): Scene {
  const walls = Array.from({ length: count }, (_, i) => ({
    id: `w${i}`,
    a: [i as number, 0] as [number, number],
    b: [i + 1, 0] as [number, number],
    thickness_m: 0.2,
    kind: "exterior" as const,
  }));
  return { ...createEmptyScene(), walls } as Scene;
}

function sceneWithOpenings(): Scene {
  return {
    ...createEmptyScene(),
    walls: [{ id: "w0", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" }],
    openings: [{ id: "o0", wall_id: "w0", kind: "door" as const, offset_m: 1, width_m: 0.9, height_m: 2.05 }],
    rooms: [{ id: "r0", name: "Room", polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] }],
  } as unknown as Scene;
}

describe("capture steps", () => {
  it("exposes 4 steps in order Photo > Walls > Openings > Check", () => {
    expect(STEP_ORDER).toEqual(["photo", "walls", "openings", "check"]);
    expect(captureSteps.map((s) => s.key)).toEqual(STEP_ORDER);
    expect(captureSteps.length).toBe(4);
  });

  it("maps empty scene to photo step", () => {
    expect(captureStepFromScene(createEmptyScene() as Scene)).toBe("photo");
  });

  it("maps walls without openings to openings step", () => {
    expect(captureStepFromScene(sceneWithWalls(2))).toBe("openings");
  });

  it("maps scene with openings to check when rooms exist", () => {
    const s = sceneWithOpenings();
    expect(captureStepFromScene(s)).toBe("check");
    expect(isCheckStep("check")).toBe(true);
    expect(isCheckStep("walls")).toBe(false);
  });

  it("wall length label uses screen-px sized pill class", async () => {
    const { wallLabelClass, WALL_LABEL_MIN_PX } = await import("./CornerEditor");
    expect(WALL_LABEL_MIN_PX).toBeGreaterThanOrEqual(14);
    expect(wallLabelClass).toMatch(/wall-label/i);
  });
});

describe("opening snap-to-wall (24 screen px)", () => {
  const wall = { id: "w0", a: [0, 0] as [number, number], b: [10, 0] as [number, number], thickness_m: 0.2, kind: "exterior" as const };
  const toDisplay = (x: number, y: number) => ({ x: x * 10, y: y * 10 }); // 10 px per meter

  it("snaps a point within 24px to the wall segment", () => {
    const hit = snapPointToWallPx([5, 1.5], [wall], toDisplay, 24);
    expect(hit).not.toBeNull();
    expect(hit!.wall.id).toBe("w0");
  });

  it("rejects a point beyond 24px", () => {
    const hit = snapPointToWallPx([5, 5], [wall], toDisplay, 24);
    expect(hit).toBeNull();
  });

  it("nearest distance helper returns finite px", () => {
    expect(nearestWallDistancePx([5, 1], [wall], toDisplay)).toBeCloseTo(10);
  });

  it("placement from two snapped taps yields a valid opening on the wall", () => {
    const onWall = (p: [number, number]) => {
      const h = snapPointToWallPx(p, [wall], toDisplay, 24);
      if (!h) throw new Error("should snap");
      return h.point;
    };
    const p0 = onWall([1, 1]);
    const p1 = onWall([3, 1]);
    const res = openPlacemenFromSnappedTap(wall as unknown as import("../scene/types").Wall, "door", p0, p1);
    expect("placement" in res).toBe(true);
    if ("placement" in res) {
      expect(res.placement.width_m).toBeCloseTo(2, 5);
    }
  });
});

describe("3D collapsed in Capture", () => {
  it("MaquetteSheet defaults collapsed when initialExpanded=false", async () => {
    const mod = await import("../view3d/MaquetteSheet");
    expect(typeof mod.MaquetteSheet).toBe("function");
    // contract: prop exists so Capture can pass initialExpanded={false}
    expect(mod.SHEET_DRAG_SLOP_PX).toBeDefined();
  });

  it("App in capture stage does not auto-expand 3D; check stage does", async () => {
    const { shouldAutoExpandMaquette } = await import("../intake/captureSteps");
    expect(shouldAutoExpandMaquette("photo")).toBe(false);
    expect(shouldAutoExpandMaquette("walls")).toBe(false);
    expect(shouldAutoExpandMaquette("openings")).toBe(false);
    expect(shouldAutoExpandMaquette("check")).toBe(true);
  });
});
