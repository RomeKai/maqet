import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ArOverlay } from "./ArOverlay";

describe("ar overlay quad styles (fix: black wall quads)", () => {
  it("paints wall quads translucent instead of SVG default black fill", () => {
    const html = renderToString(
      <ArOverlay
        frameRef={{ current: null }}
        corners={[]}
        locale="en"
        walls={[{ id: "wall-1", start: { x: 0, z: -2 }, end: { x: 1, z: -2 }, heightM: 2.6, flaggedHeight: false }]}
        floorY={0}
      />,
    );
    expect(html).toContain("ar-overlay-quad");
  });

  it("dashes the rubber-band quad so the pending wall reads as preview", () => {
    const html = renderToString(
      <ArOverlay
        frameRef={{ current: null }}
        corners={[]}
        locale="en"
        walls={[]}
        pendingStart={{ x: 0, z: -2 }}
        pendingEnd={{ x: 1, z: -2 }}
        floorY={0}
      />,
    );
    expect(html).toContain("ar-overlay-quad-rubber");
  });
});
