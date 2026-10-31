import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Scene } from "../scene/types";
import { getDesignStrings } from "./design.i18n";
import { EMPTY_REAL_LIFE, RealLifeCard, STYLE_IDS } from "./RealLifeCard";

const noop = (): void => {};
const scene = { id: "s", walls: [], rooms: [{ id: "r1", name: "Bedroom", polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }] } as unknown as Scene;

describe("RealLifeCard", () => {
  it("offers the five styles, the button and the cost note in both locales", () => {
    for (const locale of ["en", "es-AR"] as const) {
      const t = getDesignStrings(locale);
      const html = renderToString(<RealLifeCard scene={scene} locale={locale} state={EMPTY_REAL_LIFE} onGenerate={noop} />);
      for (const id of STYLE_IDS) expect(html).toContain(t[`real.style.${id}`]);
      expect(html).toContain(t["real.button"]);
      expect(html).toContain(t["real.cost"]);
    }
    expect(STYLE_IDS).toHaveLength(5);
  });
  it("disables the button and says so while an image is pending", () => {
    const t = getDesignStrings("en");
    const html = renderToString(<RealLifeCard scene={scene} locale="en" state={{ ...EMPTY_REAL_LIFE, pending: true }} onGenerate={noop} />);
    expect(html).toContain(t["real.pending"]);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Creating the image/s);
  });
  it("shows the image with no extra concept label, and the present wording", () => {
    const html = renderToString(<RealLifeCard scene={scene} locale="en" state={{ image: "data:image/png;base64,AA", pending: false, error: null }} onGenerate={noop} variant="present" />);
    expect(html).toContain("data:image/png;base64,AA");
    expect(html).toContain("See it in real life");
    expect(html.toLowerCase()).not.toContain("concept");
  });
});

describe("RealLifeCard placement", () => {
  it("compact strip keeps the style chips and the button inline and leaves the image to the screen", () => {
    const html = renderToString(<RealLifeCard scene={scene} locale="en" state={{ image: "data:image/png;base64,AA", pending: false, error: null }} onGenerate={noop} compact />);
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("Show it in real life");
    expect(html).not.toContain("data:image/png");
  });
});
