import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Scene } from "../scene/types";
import { GuideScene } from "./GuideCapture";
import { SceneMeshesView } from "./SceneView";
import { GUIDE_EYE_HEIGHT_M, GUIDE_FOV_DEG, GUIDE_SIZE_PX, guideCamera } from "./guideCamera";

const scene = {
  id: "s",
  walls: [
    { id: "w1", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" },
    { id: "w2", a: [4, 0], b: [4, 3], thickness_m: 0.2, kind: "exterior" },
    { id: "w3", a: [4, 3], b: [0, 3], thickness_m: 0.2, kind: "exterior" },
    { id: "w4", a: [0, 3], b: [0, 0], thickness_m: 0.2, kind: "exterior" },
  ],
  openings: [{ id: "d1", wall_id: "w1", kind: "door", offset_m: 1.5, width_m: 0.9, height_m: 2.1 }],
  rooms: [{ id: "r1", name: "Bedroom", polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
  furniture: [{ id: "f1", catalog_id: "bed-single-90x190", room_id: "r1", position: [3, 1.5], rotation_deg: 90, size_m: [0.9, 1.9, 0.55] }],
} as unknown as Scene;

describe("guide camera", () => {
  it("stands in the door at eye level with a wide FOV, looking into the room", () => {
    const cam = guideCamera(scene, "r1");
    expect(cam).not.toBeNull();
    expect(cam!.position[2]).toBe(GUIDE_EYE_HEIGHT_M);
    expect(GUIDE_EYE_HEIGHT_M).toBeCloseTo(1.6);
    expect(cam!.fovDeg).toBe(GUIDE_FOV_DEG);
    expect(GUIDE_FOV_DEG).toBeGreaterThanOrEqual(75);
    expect(cam!.position[0]).toBeCloseTo(1.95, 0); // door center x
    expect(cam!.position[1]).toBeGreaterThan(0); // just inside the south wall
    expect(cam!.position[1]).toBeLessThan(0.5);
    expect(cam!.target[1]).toBeGreaterThan(cam!.position[1]); // looks north, into the room
  });
  it("is fixed: same scene, same camera; 1024 px output", () => {
    expect(guideCamera(scene, "r1")).toEqual(guideCamera(scene, "r1"));
    expect(GUIDE_SIZE_PX.width).toBe(1024);
  });
  it("returns null for an unknown room and falls back to the longest wall without a door", () => {
    expect(guideCamera(scene, "nope")).toBeNull();
    const noDoor = { ...scene, openings: [] } as unknown as Scene;
    expect(guideCamera(noDoor, "r1")).not.toBeNull();
  });
});

describe("guide scene content", () => {
  // No DOM under vitest (node): labels and badges build canvas textures, so give them a stub canvas.
  const g = globalThis as unknown as { document?: unknown };
  const saved = g.document;
  beforeEach(() => {
    g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
  });
  afterEach(() => {
    g.document = saved;
  });

  it("hides wall badges and furniture labels, keeps the furniture", () => {
    const guide = renderToString(<GuideScene scene={scene} />);
    expect(guide).not.toContain("<sprite");
    expect(guide).toContain("furniture:f1");
    const normal = renderToString(<SceneMeshesView scene={scene} wallNumbers />);
    expect(normal).toContain("<sprite");
  });
});
