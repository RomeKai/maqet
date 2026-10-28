import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import type { Scene, Wall } from "../scene/types";
import { FidelitySummary } from "./FidelitySummary";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { getFidelityStrings } from "./fidelity.i18n";

function wall(id: string, provenance?: Wall["provenance"]): Wall {
  return { id, a: [0, 0], b: [3, 0], thickness_m: 0.2, kind: "exterior", ...(provenance ? { provenance } : {}) };
}

const measuredScene: Scene = { id: "s", walls: [wall("w1", "measured_ar"), wall("w2", "measured_tape")] };
const mixedScene: Scene = { id: "s", walls: [wall("w1", "measured_ar"), wall("w2", "estimated"), wall("w3", "estimated")] };
const conceptScene: Scene = {
  ...measuredScene,
  furniture: [{ id: "f1", room_id: "r1", position: [1, 1], size_m: [1, 1, 1], concept: true }],
};

describe("fidelity.i18n", () => {
  it("has the same keys in en and es-AR", () => {
    expect(Object.keys(getFidelityStrings("es-AR")).sort()).toEqual(Object.keys(getFidelityStrings("en")).sort());
  });
});

describe("ProvenanceBadge", () => {
  it.each(["measured_ar", "measured_tape", "written_on_sketch", "estimated"] as const)(
    "renders %s in both locales",
    (provenance) => {
      for (const locale of ["en", "es-AR"] as const) {
        const html = renderToString(<ProvenanceBadge provenance={provenance} locale={locale} />);
        expect(html).toContain(getFidelityStrings(locale)[`provenance.${provenance}`]);
        expect(html).toContain(`data-provenance="${provenance}"`);
      }
    },
  );

  it("styles estimated as a warning and measured ones as not", () => {
    expect(renderToString(<ProvenanceBadge provenance="estimated" locale="en" />)).toContain("fidelity-warn");
    expect(renderToString(<ProvenanceBadge provenance="measured_ar" locale="en" />)).not.toContain("fidelity-warn");
  });
});

describe("FidelitySummary", () => {
  it("shows only the Measured chip when every wall is measured", () => {
    const html = renderToString(<FidelitySummary scene={measuredScene} locale="en" />);
    expect(html).toContain('data-chip="measured"');
    expect(html).not.toContain('data-chip="preliminary"');
    expect(html).not.toContain('data-chip="concept"');
    expect(html).not.toContain("fidelity-estimated-walls");
  });

  it("scopes the measured label to walls, since openings carry no provenance", () => {
    const withOpening: Scene = {
      ...measuredScene,
      openings: [{ id: "o1", wall_id: "w1", kind: "door", offset_m: 1, width_m: 0.9, height_m: 2.05 }],
    };
    const en = renderToString(<FidelitySummary scene={withOpening} locale="en" />);
    expect(en).toContain("Walls measured");
    expect(en).not.toContain(">Measured<");
    const es = renderToString(<FidelitySummary scene={withOpening} locale="es-AR" />);
    expect(es).toContain("Muros medidos");
    expect(es).not.toContain(">Medido<");
  });

  it("shows the Preliminary chip and flags the estimated walls when mixed", () => {
    const t = getFidelityStrings("en");
    const html = renderToString(<FidelitySummary scene={mixedScene} locale="en" />);
    expect(html).toContain('data-chip="preliminary"');
    expect(html).not.toContain('data-chip="measured"');
    expect(html).toContain("fidelity-estimated-walls");
    expect(html).toContain(t["summary.estimatedWalls"]);
    expect(html).toContain("w2");
    expect(html).toContain("w3");
    expect(html).not.toContain(">w1<");
  });

  it("adds the Concept chip when a concept item exists", () => {
    expect(renderToString(<FidelitySummary scene={conceptScene} locale="en" />)).toContain('data-chip="concept"');
  });

  it("lists a count for each provenance that is present", () => {
    const html = renderToString(<FidelitySummary scene={mixedScene} locale="en" />);
    expect(html).toContain('data-provenance="measured_ar"');
    expect(html).toContain('data-provenance="estimated"');
    expect(html).not.toContain('data-provenance="measured_tape"');
  });

  it("renders in es-AR", () => {
    const t = getFidelityStrings("es-AR");
    const html = renderToString(<FidelitySummary scene={mixedScene} locale="es-AR" />);
    expect(html).toContain(t["label.preliminary"]);
    expect(html).toContain(t["summary.estimatedWalls"]);
  });
});
