import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ArHud } from "./ArMeasure";
import { captureReducer, initialCaptureState, toSceneOps } from "./captureSession";
import { applySceneOp, createEmptyScene } from "../scene/store";
import { sceneToMeshes } from "../view3d/sceneToMeshes";
import type { Vec3 } from "./cornerMath";
import type { CaptureEvent } from "./captureSession";

const Y = 0.5;
const events: CaptureEvent[] = [
  { type: "floorHit", point: [0, Y, 0], horizontal: true },
  { type: "baseTap", point: [0, Y, 0] },
  { type: "baseTap", point: [4, Y, 0] },
  { type: "ceilingConfirm", heightM: 2.6 },
  { type: "baseTap", point: [4, Y, -3] as Vec3 },
  { type: "baseTap", point: [0, Y, -3] as Vec3 },
  { type: "baseTap", point: [0.05, Y, 0.05] as Vec3 },
  { type: "setWallHeight", wallId: "wall-3", heightM: 2.4 },
];

function room() {
  let state = initialCaptureState();
  for (const e of events) state = captureReducer(state, e).state;
  return state;
}

describe("per-wall height reaches every output", () => {
  it("4-wall room with wall 3 at 2.40 m: Scene walls and 3D meshes reflect it", () => {
    const state = room();
    expect(state.closed).toBe(true);
    let scene = createEmptyScene("ar-heights");
    for (const op of toSceneOps(state).ops) scene = applySceneOp(scene, op);
    expect((scene.walls ?? []).map((w) => w.height_m)).toEqual([2.6, 2.6, 2.4, 2.6]);
    const meshes = sceneToMeshes(scene);
    const tops = meshes.walls.map((w) => Math.max(...w.size.slice(2)));
    expect(tops.some((h) => Math.abs(h - 2.4) < 1e-9)).toBe(true);
    expect(tops.filter((h) => Math.abs(h - 2.6) < 1e-9)).toHaveLength(3);
  });

  it("HUD offers the per-wall height form in both locales", () => {
    const state = captureReducer(
      captureReducer(initialCaptureState(), events[0]!).state,
      events[1]!,
    ).state;
    let s = state;
    for (const e of events.slice(2, 5)) s = captureReducer(s, e).state;
    const en = renderToString(<ArHud locale="en" hudRef={{ current: null }} capture={s} measureLocale="en" />);
    expect(en).toContain("Wall 2 height");
    expect(en).toContain("Set wall height");
    const es = renderToString(<ArHud locale="es-AR" hudRef={{ current: null }} capture={s} measureLocale="es-AR" />);
    expect(es).toContain("Altura pared 2");
  });
});
