import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { DeliverView } from "./DeliverView";
import { getDeliverStrings } from "./deliver.i18n";
import type { Scene } from "../scene/types";

const scene = {
  id: "s",
  walls: [
    { id: "a", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior", provenance: "written_on_sketch" },
    { id: "b", a: [4, 0], b: [4, 3], thickness_m: 0.2, kind: "exterior", provenance: "estimated" },
  ],
} as unknown as Scene;

describe("DeliverView", () => {
  it("keeps the preliminary label and the DXF export", () => {
    const t = getDeliverStrings("en");
    const html = renderToString(<DeliverView scene={scene} takeoff={null} locale="en" />);
    expect(html).toContain('data-testid="preliminary-label"');
    expect(html).toContain(t["footer.preliminary"]);
    expect(html).toContain(t["action.dxf"]);
  });

  it("warns when walls still have estimated lengths", () => {
    const html = renderToString(<DeliverView scene={scene} takeoff={null} locale="en" />);
    expect(html).toContain("1 walls have a guessed length");
  });

  it("does not offer a server CSV (no /export/takeoff.csv route yet)", () => {
    const html = renderToString(<DeliverView scene={scene} takeoff={null} locale="es-AR" />);
    expect(html).not.toContain(getDeliverStrings("es-AR")["action.exportCsv"]);
  });
});
