import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import fixture from "./__fixtures__/takeoff.sample.json";
import { TakeoffView } from "./TakeoffView";
import { getDeliverStrings } from "./deliver.i18n";
import { parseTakeoff } from "./takeoffFormat";

const takeoff = parseTakeoff(fixture);

/** Position of each string in the markup, matching how React escapes text ("&" becomes "&amp;"). */
function indexOfAll(html: string, needles: string[]): number[] {
  return needles.map((n) => html.indexOf(n.replace(/&/g, "&amp;")));
}

describe("deliver.i18n", () => {
  it("has the same keys in en and es-AR", () => {
    expect(Object.keys(getDeliverStrings("es-AR")).sort()).toEqual(Object.keys(getDeliverStrings("en")).sort());
  });
});

describe("TakeoffView", () => {
  it("renders stage blocks in construction order", () => {
    const t = getDeliverStrings("en");
    const html = renderToString(<TakeoffView takeoff={takeoff} locale="en" />);
    const positions = indexOfAll(html, [
      t["stage.foundations"],
      t["stage.walls"],
      t["stage.bond_beams_roof"],
      t["stage.openings"],
      t["stage.finishes"],
    ]);
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("formats quantities per locale", () => {
    expect(renderToString(<TakeoffView takeoff={takeoff} locale="en" />)).toContain("1,235"); // 1234.5 pieces: you buy whole pieces
    const es = renderToString(<TakeoffView takeoff={takeoff} locale="es-AR" />);
    expect(es).toContain("1.235");
    expect(es).not.toContain("1,235");
    expect(es).not.toContain("1234.5");
  });

  it("marks estimated lines and only those", () => {
    const t = getDeliverStrings("en");
    const html = renderToString(<TakeoffView takeoff={takeoff} locale="en" />);
    const estimatedLines = Object.values(takeoff.stages)
      .flat()
      .filter((l) => l.estimated).length;
    expect(html.split('data-estimated="true"').length - 1).toBe(estimatedLines);
    expect(html.split(`>${t["line.estimated"]}<`).length - 1).toBe(estimatedLines);
  });

  it("puts the recipe source behind a tap target for every line", () => {
    const html = renderToString(<TakeoffView takeoff={takeoff} locale="en" />);
    const lines = Object.values(takeoff.stages).flat();
    expect(html.split("<details").length - 1).toBe(lines.length);
    expect(html).toContain("confirm with mason");
    expect(html).toContain("<summary");
  });

  it("shows a professional-flags banner with one entry per flag", () => {
    const t = getDeliverStrings("en");
    const html = renderToString(<TakeoffView takeoff={takeoff} locale="en" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain(t["flags.title"]);
    expect(html).toContain(t["flag.second_floor"]);
    expect(html).toContain(t["flag.span_over_limit"]);
    expect(html).not.toContain(t["flag.unknown_soil"]);
  });

  it("omits the banner when there are no flags", () => {
    const html = renderToString(<TakeoffView takeoff={{ ...takeoff, flags: [] }} locale="en" />);
    expect(html).not.toContain('role="alert"');
  });

  it("always shows the preliminary footer, in both locales", () => {
    expect(renderToString(<TakeoffView takeoff={takeoff} locale="en" />)).toContain(
      "Preliminary: not a structural certification",
    );
    expect(renderToString(<TakeoffView takeoff={takeoff} locale="es-AR" />)).toContain(
      getDeliverStrings("es-AR")["footer.preliminary"],
    );
  });

  it("offers the CSV export and never shows prices", () => {
    const t = getDeliverStrings("en");
    const html = renderToString(<TakeoffView takeoff={takeoff} locale="en" />);
    expect(html).toContain(t["action.exportCsv"]);
    expect(html.toLowerCase()).not.toContain("price");
    expect(html).not.toMatch(/[$€]|ARS/);
  });

  it("shows the generic label for an unknown professional flag", () => {
    const t = getDeliverStrings("en");
    const html = renderToString(<TakeoffView takeoff={{ ...takeoff, flags: [{ code: "asbestos" }] }} locale="en" />);
    expect(html).toContain(t["flag.generic"]);
  });
});
