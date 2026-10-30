import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { MaquetteViewer, ViewerBody } from "./MaquetteViewer";
import { getArStrings } from "./ar.i18n";

const t = getArStrings("en");

describe("ar.i18n", () => {
  it("has the same keys in en and es-AR", () => {
    expect(Object.keys(getArStrings("es-AR")).sort()).toEqual(Object.keys(getArStrings("en")).sort());
  });
});

describe("MaquetteViewer", () => {
  it("shows the loading state while the exports are pending", () => {
    const html = renderToString(<MaquetteViewer src={null} iosSrc={null} locale="en" />);
    expect(html).toContain(t["viewer.loading"]);
    expect(html).not.toContain("<model-viewer");
  });

  it("shows loading until model-viewer is registered, even with URLs ready", () => {
    const html = renderToString(<MaquetteViewer src="blob:glb" iosSrc="blob:usdz" locale="en" />);
    expect(html).toContain(t["viewer.loading"]);
  });

  it("always carries the preliminary label", () => {
    expect(renderToString(<MaquetteViewer src={null} iosSrc={null} locale="en" />)).toContain(t["caption.preliminary"]);
    expect(renderToString(<ViewerBody phase="ready" src="a" iosSrc="b" canActivateAR locale="en" />)).toContain(
      t["caption.preliminary"],
    );
  });
});

describe("scale caption", () => {
  it("writes the scale next to the preliminary label", () => {
    const html = renderToString(<MaquetteViewer src={null} iosSrc={null} locale="en" scaleDenominator={50} />);
    expect(html).toContain("Scale 1:50");
    expect(html).toContain(t["caption.preliminary"]);
  });

  it("uses the es-AR word for scale", () => {
    const html = renderToString(<MaquetteViewer src={null} iosSrc={null} locale="es-AR" scaleDenominator={20} />);
    expect(html).toContain("Escala 1:20");
  });
});

describe("ViewerBody", () => {
  it("gives model-viewer src, ios-src, AR modes, floor placement and a 48px AR button", () => {
    const html = renderToString(<ViewerBody phase="ready" src="blob:glb" iosSrc="blob:usdz" canActivateAR locale="en" />);
    expect(html).toContain('src="blob:glb"');
    expect(html).toContain('ios-src="blob:usdz"');
    expect(html).toContain('ar-modes="webxr scene-viewer quick-look"');
    expect(html).toContain('ar-placement="floor"');
    expect(html).toContain('ar-scale="fixed"');
    expect(html).toContain('shadow-intensity="1"');
    expect(html).toContain("camera-controls");
    expect(html).toContain(`alt="${t["viewer.alt"]}"`);
    expect(html).toContain('slot="ar-button"');
    expect(html).toContain(t["viewer.arButton"]);
    expect(html).not.toContain(t["viewer.arNotAvailable"]);
  });

  it("shows the fallback text when the import failed, without model-viewer", () => {
    const html = renderToString(<ViewerBody phase="failed" src="a" iosSrc="b" canActivateAR={false} locale="en" />);
    expect(html).toContain(t["viewer.arNotAvailable"]);
    expect(html).not.toContain("<model-viewer");
  });

  it("keeps the 3D view and shows the fallback when canActivateAR is false", () => {
    const html = renderToString(<ViewerBody phase="ready" src="a" iosSrc="b" canActivateAR={false} locale="en" />);
    expect(html).toContain("<model-viewer");
    expect(html).toContain(t["viewer.arNotAvailable"]);
  });

  it("renders the fallback in es-AR", () => {
    const html = renderToString(<ViewerBody phase="failed" src="a" iosSrc="b" canActivateAR={false} locale="es-AR" />);
    expect(html).toContain(getArStrings("es-AR")["viewer.arNotAvailable"]);
  });
});
