import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { MaquetteViewer } from "./MaquetteViewer";
import { getArStrings } from "./ar.i18n";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ar.i18n", () => {
  it("has the same keys in en and es-AR", () => {
    expect(Object.keys(getArStrings("es-AR")).sort()).toEqual(Object.keys(getArStrings("en")).sort());
  });
});

describe("MaquetteViewer", () => {
  it("shows a clear fallback when <model-viewer> is not registered", () => {
    const t = getArStrings("en");
    const html = renderToString(<MaquetteViewer src="blob:maquette" locale="en" />);
    expect(html).toContain(t["viewer.unavailable"]);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<model-viewer");
  });

  it("renders the fallback in es-AR", () => {
    const html = renderToString(<MaquetteViewer src="blob:maquette" locale="es-AR" />);
    expect(html).toContain(getArStrings("es-AR")["viewer.unavailable"]);
  });

  it("renders <model-viewer> with AR modes when the custom element is registered", () => {
    vi.stubGlobal("customElements", { get: (name: string) => (name === "model-viewer" ? class {} : undefined) });
    const html = renderToString(<MaquetteViewer src="blob:maquette" locale="en" />);
    expect(html).toContain("<model-viewer");
    expect(html).toContain('src="blob:maquette"');
    expect(html).toContain('ar-modes="webxr scene-viewer quick-look"');
    expect(html).toContain('camera-controls');
    expect(html).not.toContain(getArStrings("en")["viewer.unavailable"]);
  });

  it("passes a pre-baked USDZ to iOS when given", () => {
    vi.stubGlobal("customElements", { get: () => class {} });
    const html = renderToString(<MaquetteViewer src="blob:glb" iosSrc="blob:usdz" locale="en" />);
    expect(html).toContain('ios-src="blob:usdz"');
  });

  it("always carries the preliminary label", () => {
    expect(renderToString(<MaquetteViewer src="blob:maquette" locale="en" />)).toContain(
      "Preliminary: not a structural certification",
    );
    vi.stubGlobal("customElements", { get: () => class {} });
    expect(renderToString(<MaquetteViewer src="blob:maquette" locale="en" />)).toContain(
      "Preliminary: not a structural certification",
    );
  });
});
