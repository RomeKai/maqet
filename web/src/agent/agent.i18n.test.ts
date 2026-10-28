import { describe, expect, it } from "vitest";
import { getAgentStrings, professionalFlagLabel } from "./agent.i18n";

describe("agent i18n", () => {
  it("has identical keys in en and es-AR", () => {
    expect(Object.keys(getAgentStrings("es-AR")).sort()).toEqual(Object.keys(getAgentStrings("en")).sort());
  });

  it("has no empty strings", () => {
    for (const locale of ["en", "es-AR"] as const) {
      for (const [key, value] of Object.entries(getAgentStrings(locale))) {
        expect(value.trim(), `${locale}:${key}`).not.toBe("");
      }
    }
  });

  it("labels every ADR-023 professional flag in both locales", () => {
    const flags = [
      "needs_professional:second_floor",
      "needs_professional:load_bearing_wall",
      "needs_professional:span_over_limit",
      "needs_professional:unknown_soil",
    ];
    for (const locale of ["en", "es-AR"] as const) {
      for (const flag of flags) {
        expect(professionalFlagLabel(locale, flag)).not.toBe(getAgentStrings(locale)["flag.generic"]);
      }
    }
  });

  it("falls back to the generic label for unknown flags", () => {
    expect(professionalFlagLabel("en", "needs_professional:nope")).toBe(getAgentStrings("en")["flag.generic"]);
  });
});
