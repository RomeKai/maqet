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

  // 3D MaquetteSheet toggle — must not cover toolbar nor eat plan taps; collapsed = handle only
  it("collapsed is handle only (single button, no canvas, no 3D mount)", () => {
    const html = renderToString(<MaquetteSheet scene={scene} locale="en" initialExpanded={false} />);
    expect(html).toContain('data-state="collapsed"');
    expect(html).toContain("maquette-handle");
    expect(html).not.toContain("maquette-canvas");
    expect(html).not.toContain('data-testid="scene-view"');
    expect((html.match(/<button/g) ?? []).length).toBe(1);
  });

  it("sheet is in-flow (not overlay) with stacking so it never covers toolbar, and does not steal plan taps", async () => {
    // @ts-ignore node types not in web tsconfig; vitest runs on node and has them
    const { readFile } = await import("node:fs/promises");
    const css = await readFile(new URL("./maquette.css", import.meta.url), "utf8");
    // Must be a flex sibling, not a fixed/absolute overlay that would cover the toolbar
    expect(css).not.toMatch(/\.maquette-sheet\s*\{[^}]*position:\s*fixed/);
    expect(css).not.toMatch(/\.maquette-sheet\s*\{[^}]*position:\s*absolute/);
    // Stacking context so toolbar stays interactive
    expect(css).toMatch(/\.maquette-sheet\s*\{[^}]*z-index:\s*1/);
    // Collapsed is handle only — bounded height so plan editor owns the rest
    expect(css).toMatch(/\.maquette-sheet\[data-state="collapsed"\][^}]*max-height/);
    // Handle drag uses pointer capture so a slide off the 48px handle does not swallow the gesture
    const tsx = await readFile(new URL("./MaquetteSheet.tsx", import.meta.url), "utf8");
    expect(tsx).toContain("setPointerCapture");
  });
});
