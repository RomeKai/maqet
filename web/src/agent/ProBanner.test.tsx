import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProBanner } from "./ProBanner";
import { normalizeProfessionalFlags, professionalFlagLabel, getAgentStrings } from "./agent.i18n";

describe("professional flags", () => {
  it("labels wall-suffixed flags with their reason", () => {
    const label = professionalFlagLabel("en", "needs_professional:span_over_limit:w3");
    expect(label).not.toBe(getAgentStrings("en")["flag.generic"]);
    expect(label).toContain("span over the limit");
  });

  it("dedupes flags that share a code", () => {
    expect(
      normalizeProfessionalFlags([
        "needs_professional:span_over_limit",
        "needs_professional:span_over_limit:w1",
        "needs_professional:span_over_limit:w3",
      ]),
    ).toEqual(["needs_professional:span_over_limit"]);
  });

  it("renders one bullet per distinct reason, never a bare generic line", () => {
    const html = renderToStaticMarkup(
      <ProBanner
        locale="en"
        flags={[
          "needs_professional:span_over_limit",
          "needs_professional:span_over_limit:w1",
          "needs_professional:span_over_limit:w3",
        ]}
      />,
    );
    const items = [...html.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => m[1]);
    expect(items).toEqual(["Needs a licensed professional: span over the limit"]);
  });
});

describe("ProBanner compact mode (bug D)", () => {
  const flags = ["needs_professional:span_over_limit", "needs_professional:unknown_soil"];
  it("collapses to one line with the reasons behind a details toggle", () => {
    const html = renderToStaticMarkup(<ProBanner locale="en" flags={flags} compact />);
    expect(html).toContain("<details");
    expect(html).toContain("Needs a licensed professional");
    expect(html).toContain("span over the limit");
  });
  it("never lets the banner take over the screen", () => {
    const html = renderToStaticMarkup(<ProBanner locale="en" flags={flags} />);
    expect(html).toMatch(/max-h-\[\d+dvh\]/);
    expect(html).toContain("overflow-y-auto");
  });
});
