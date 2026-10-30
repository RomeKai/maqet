import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { DeliverView } from "./DeliverView";
import { getDeliverStrings } from "./deliver.i18n";

const takeoffFixture = {
  preliminary: true as const,
  flags: [] as { code: string }[],
  stages: {
    foundations: [],
    walls: [],
    bond_beams_roof: [],
    openings: [],
    finishes: [],
  },
};

describe("DeliverView fetch", () => {
  it("shows DXF and CSV export buttons", () => {
    const scene = { id: "s", scale_confirmed: true, walls: [] } as unknown as import("../scene/types").Scene;
    const html = renderToString(<DeliverView scene={scene} takeoff={takeoffFixture as any} locale="en" />);
    expect(html).toContain("DXF");
    expect(html).toContain(getDeliverStrings("en")["action.exportCsv"]);
  });

  it("shows preliminary label", () => {
    const scene = { id: "s", scale_confirmed: true, walls: [] } as unknown as import("../scene/types").Scene;
    const html = renderToString(<DeliverView scene={scene} takeoff={null} locale="en" />);
    expect(html).toContain(getDeliverStrings("en")["footer.preliminary"]);
  });
});
