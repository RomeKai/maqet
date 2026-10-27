import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { App } from "./App";
import { DEFAULT_LOCALE, getStrings } from "./i18n";
import type { Scene } from "./scene/types";

describe("App stages", () => {
  it("stage capture renders IntakeScreen", () => {
    const t = getStrings(DEFAULT_LOCALE);
    const html = renderToString(<App />);
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
        { id: "w1", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" },
      ],
    };
    const withScene = renderToString(<App initialScene={scene} />);
    expect(withScene).toContain('data-testid="scene-view"');
    expect(withScene).toContain('data-empty="no"');
    expect(withScene).toContain(t["badge.measured"]);

    const withoutScene = renderToString(<App />);
    expect(withoutScene).not.toContain('data-testid="scene-view"');
    expect(withoutScene).toContain(t["sheet.hint"]);
  });
});
