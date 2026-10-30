import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ViewerBody } from "./MaquetteViewer";
import { getArStrings } from "./ar.i18n";

const t = getArStrings("en");

describe("Scene Viewer failure handling", () => {
  it("passes a restricted ar-modes through to model-viewer", () => {
    const html = renderToString(<ViewerBody phase="ready" src="blob:glb" iosSrc={null} canActivateAR locale="en" arModes="webxr" />);
    expect(html).toContain('ar-modes="webxr"');
    expect(html).not.toContain("scene-viewer");
  });

  it("shows a clear message and a WebXR retry when the AR launch failed", () => {
    const html = renderToString(
      <ViewerBody phase="ready" src="https://h/api/ar/model/x.glb" iosSrc={null} canActivateAR locale="en" attemptFailed onRetryWebXr={() => undefined} />,
    );
    expect(html).toContain(t["viewer.arFailed"]);
    expect(html).toContain(t["viewer.retryWebXr"]);
    expect(html).toContain("ar-retry");
  });

  it("shows no failure UI by default", () => {
    const html = renderToString(<ViewerBody phase="ready" src="a" iosSrc={null} canActivateAR locale="en" />);
    expect(html).not.toContain(t["viewer.arFailed"]);
  });

  it("explains the untrusted-certificate cause when the host looks self-signed", () => {
    const html = renderToString(
      <ViewerBody phase="ready" src="a" iosSrc={null} canActivateAR locale="en" attemptFailed untrustedHost onRetryWebXr={() => undefined} />,
    );
    expect(html).toContain(t["viewer.hostHint"]);
  });

  it("es-AR has the failure strings", () => {
    const es = getArStrings("es-AR");
    expect(es["viewer.arFailed"]).not.toBe(t["viewer.arFailed"]);
    expect(es["viewer.retryWebXr"]).not.toBe(t["viewer.retryWebXr"]);
  });
});
