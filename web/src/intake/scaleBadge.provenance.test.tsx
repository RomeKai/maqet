import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { getStrings } from "../i18n";
import { ScaleBadge, scaleBadgeState } from "./ScaleBadge";
import { applySceneOp } from "../scene/store";
import type { Scene, Wall } from "../scene/types";

const wall = (id: string, provenance: Wall["provenance"]): Wall => ({
  id, a: [0, 0], b: [3, 0], thickness_m: 0.2, kind: "exterior", provenance,
  ...(provenance === "estimated" ? {} : { measured_length_m: 3 }),
});
const scene = (...p: Wall["provenance"][]): Scene => ({ id: "s", scale_confirmed: true, walls: p.map((x, i) => wall(`w${i}`, x)) });

describe("the scale badge reflects wall provenance, not just scale_confirmed", () => {
  it("measured only when every wall is really measured", () => {
    expect(scaleBadgeState(scene("measured_ar", "measured_tape")).kind).toBe("measured");
  });

  it("a sketch with written lengths is 'written', never 'Measured 1:1'", () => {
    const state = scaleBadgeState(scene("written_on_sketch", "written_on_sketch", "written_on_sketch", "written_on_sketch"));
    expect(state.kind).toBe("written");
    for (const locale of ["en", "es-AR"] as const) {
      const t = getStrings(locale);
      const html = renderToString(<ScaleBadge locale={locale} scene={scene("written_on_sketch", "written_on_sketch")} />);
      expect(html).toContain(t["badge.written"]);
      expect(html).not.toContain(t["badge.measured"]);
    }
  });

  it("any estimated wall is a visible signal with the count, even when scale_confirmed is true", () => {
    const s = scene("written_on_sketch", "written_on_sketch", "written_on_sketch", "estimated");
    expect(scaleBadgeState(s)).toMatchObject({ kind: "estimated", estimated: 1, total: 4 });
    const html = renderToString(<ScaleBadge locale="en" scene={s} />);
    expect(html).toContain("1 of 4 walls estimated");
    expect(html).not.toContain("Measured");
  });

  it("no measured walls at all is Not to scale", () => {
    expect(scaleBadgeState(scene("estimated", "estimated")).kind).toBe("none");
    expect(scaleBadgeState({ id: "empty" }).kind).toBe("none");
  });

  it("stays consistent after Edit measures and Undo (derived from the Scene each time)", () => {
    const written = scene("written_on_sketch", "written_on_sketch");
    const edited = applySceneOp(written, { type: "setWallLength", wallId: "w0", lengthM: 4, provenance: "estimated" });
    expect(scaleBadgeState(edited).kind).toBe("estimated");
    expect(scaleBadgeState(written).kind).toBe("written"); // undo restores the previous Scene
  });
});
