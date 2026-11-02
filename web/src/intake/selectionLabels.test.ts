import { describe, expect, it } from "vitest";
import { getStrings } from "../i18n";
import { openingSelectedLabel, wallSelectedLabel } from "./selectionLabels";

describe("selection labels fill every placeholder", () => {
  for (const locale of ["en", "es-AR"] as const) {
    const t = getStrings(locale);
    it(`wall label has no leftover braces (${locale})`, () => {
      const label = wallSelectedLabel(t["intake.selected.wall"], 4, "8.00 m");
      expect(label).toContain("4");
      expect(label).toContain("8.00 m");
      expect(label).not.toMatch(/[{}]/);
    });
    it(`door and window labels carry the width, no braces (${locale})`, () => {
      for (const key of ["intake.selected.door", "intake.selected.window"] as const) {
        const label = openingSelectedLabel(t[key], "1.20 m");
        expect(label).toContain("1.20 m");
        expect(label).not.toMatch(/[{}]/);
      }
    });
  }
});
