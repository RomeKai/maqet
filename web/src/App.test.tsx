import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { App } from "./App";
import { DEFAULT_LOCALE, getStrings } from "./i18n";
import type { Scene } from "./scene/types";

describe("App stages", () => {
  it("stage capture renders IntakeScreen", () => {
    const t = getStrings(DEFAULT_LOCALE);
    const html = renderToString(<App initialView="work" />);
    expect(html).toContain(t["intake.upload.cta"]);
    expect(html).toContain(t["intake.upload.hint"]);
    expect(html).toContain(t["stage.capture"]);
  });

  // jsdom has no WebGL, so this asserts SceneView's SSR-safe fallback
  // wrapper (data-testid="scene-view") — not real canvas pixels. Geometry
  // math is covered by sceneToMeshes.test.ts, which needs no renderer.
  it("stage 3d", () => {
    const t = getStrings(DEFAULT_LOCALE);
    const scene: Scene = {
      id: "intake-1",
      scale_confirmed: true,
      walls: [
        { id: "w1", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior", provenance: "measured_tape", measured_length_m: 4 },
      ],
    };
    const withScene = renderToString(<App initialScene={scene} />);
    // Phone-first: in Capture the 3D lives in MaquetteSheet collapsed (canvas hidden at SSR).
    // Assert the sheet is present; geometry itself is covered by sceneToMeshes.test.ts.
    expect(withScene).toContain('maquette-sheet');
    expect(withScene).toContain('data-empty="no"');
    expect(withScene).toContain(t["badge.measured"]);

    const withSceneCheck: Scene = {
      ...scene,
      rooms: [{ id: "r1", polygon: [[0,0],[4,0],[4,4],[0,4]], name: "Room" }] as unknown as Scene["rooms"],
      openings: [{ id: "o1", wall_id: "w1", kind: "door", offset_m: 1, width_m: 0.9, height_m: 2.05 }] as unknown as Scene["openings"],
    };
    const withCheck = renderToString(<App initialScene={withSceneCheck} />);
    expect(withCheck).toContain('data-testid="scene-view"');

    const withoutScene = renderToString(<App initialView="work" />);
    expect(withoutScene).not.toContain('data-testid="scene-view"');
    expect(withoutScene).toContain(t["intake.upload.hint"]);
  });
});
