import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { MaquetteSheet, resolveSheetDrag } from "./MaquetteSheet";
import type { Scene } from "../scene/types";

const scene: Scene = {
  id: "intake",
  version: 1,
  units: "m",
  scale_confirmed: false,
  ceiling_height_m: 2.6,
  walls: [{ id: "w0", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" }],
  openings: [],
  rooms: [],
};

describe("resolveSheetDrag", () => {
  it("treats small travel as a tap (the caller toggles)", () => {
    expect(resolveSheetDrag(0)).toBeNull();
    expect(resolveSheetDrag(5)).toBeNull();
    expect(resolveSheetDrag(-8)).toBeNull();
  });

  it("expands on drag up, collapses on drag down", () => {
    expect(resolveSheetDrag(-30)).toBe(true);
    expect(resolveSheetDrag(30)).toBe(false);
  });

  it("honors a custom slop", () => {
    expect(resolveSheetDrag(12, 16)).toBeNull();
    expect(resolveSheetDrag(12, 8)).toBe(false);
  });
});

describe("MaquetteSheet", () => {
  it("expanded by default: handle plus 3D canvas", () => {
    const html = renderToString(<MaquetteSheet scene={scene} locale="en" />);
    expect(html).toContain('data-state="expanded"');
    expect(html).toContain("maquette-handle");
    expect(html).toContain('data-testid="scene-view"');
    expect(html).toContain('aria-expanded="true"');
  });

  it("collapsed: handle only, canvas unmounted so the editor owns the screen", () => {
    const html = renderToString(
      <MaquetteSheet scene={scene} locale="en" initialExpanded={false} />,
    );
    expect(html).toContain('data-state="collapsed"');
    expect(html).toContain("maquette-handle");
    expect(html).not.toContain('data-testid="scene-view"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("labels the handle for screen readers in both locales", () => {
    const enHtml = renderToString(
      <MaquetteSheet scene={scene} locale="en" initialExpanded={false} />,
    );
    expect(enHtml).toContain('aria-label="Show 3D"');
    const esHtml = renderToString(
      <MaquetteSheet scene={scene} locale="es-AR" initialExpanded={false} />,
    );
    expect(esHtml).toContain('aria-label="Ver 3D"');
  });

  it("marks an empty scene on the wrapper", () => {
    const html = renderToString(<MaquetteSheet scene={{ id: "empty" }} locale="en" />);
    expect(html).toContain('data-empty="yes"');
  });
});
