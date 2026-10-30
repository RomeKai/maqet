import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { PresentView } from "./PresentView";
import { getStrings } from "../i18n";
import { getArStrings } from "../ar/ar.i18n";
import type { Scene } from "../scene/types";

const scene = {
  id: "s",
  scale_confirmed: true,
  walls: [{ id: "w1", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" }],
} as unknown as Scene;

const noop = (): void => {};

describe("PresentView", () => {
  it("shows the 3D view, the AR button and the share button", () => {
    const t = getStrings("en");
    const html = renderToString(
      <PresentView scene={scene} locale="en" selectedWallId={null} onSelectWall={noop} onSceneChange={noop} />,
    );
    expect(html).toContain('data-testid="scene-view"');
    expect(html).toContain(t["present.ar"]);
    expect(html).toContain(t["present.share"]);
    expect(html).toContain(t["notice.preliminary"]);
  });

  it("asks for a plan first and disables AR when there are no walls", () => {
    const t = getStrings("es-AR");
    const html = renderToString(
      <PresentView scene={null} locale="es-AR" selectedWallId={null} onSelectWall={noop} onSceneChange={noop} />,
    );
    expect(html).toContain(t["present.empty"]);
    expect(html).not.toContain('data-testid="scene-view"');
  });

  it("shows the AR viewer in its loading state while the exports build", () => {
    const html = renderToString(
      <PresentView scene={scene} locale="en" selectedWallId={null} onSelectWall={noop} onSceneChange={noop} />,
    );
    expect(html).toContain(getArStrings("en")["viewer.loading"]);
    expect(html).toContain(getArStrings("en")["caption.preliminary"]);
  });

  it("does not show the AR viewer when there is no plan", () => {
    const html = renderToString(
      <PresentView scene={null} locale="en" selectedWallId={null} onSelectWall={noop} onSceneChange={noop} />,
    );
    expect(html).not.toContain(getArStrings("en")["viewer.loading"]);
  });

  it("offers the 1:100, 1:50 and 1:20 scales with 1:50 selected by default", () => {
    const html = renderToString(
      <PresentView scene={scene} locale="en" selectedWallId={null} onSelectWall={noop} onSceneChange={noop} />,
    );
    expect(html).toContain('data-scale="50" aria-pressed="true"');
    expect(html).toContain('data-scale="100" aria-pressed="false"');
    expect(html).toContain('data-scale="25" aria-pressed="false"');
    expect(html).toContain('data-scale="20" aria-pressed="false"');
    expect(html).toContain('data-scale="50" aria-pressed="true"');
    expect(html).toContain('data-scale="100" aria-pressed="false"');
    expect(html).toContain("Scale 1:50");
  });

  it("puts the AR card (scale selector, viewer, preliminary label) above the 3D view", () => {
    const html = renderToString(
      <PresentView scene={scene} locale="en" selectedWallId={null} onSelectWall={noop} onSceneChange={noop} />,
    );
    const arCard = html.indexOf('class="ar-scales"');
    expect(arCard).toBeGreaterThan(-1);
    expect(arCard).toBeLessThan(html.indexOf('data-testid="scene-view"'));
    expect(html.indexOf("Preliminary: not a structural certification")).toBeLessThan(html.indexOf('data-testid="scene-view"'));
  });
});
