import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { IntakeScreen } from "./IntakeScreen";
import { getStrings } from "../i18n";

/** aria-checked value of the radio button whose visible label is `label`. */
function checkedOf(html: string, label: string): string | null {
  const labelAt = html.indexOf(`>${label}<`);
  if (labelAt < 0) return null;
  const buttonAt = html.lastIndexOf("<button", labelAt);
  const tag = html.slice(buttonAt, labelAt);
  if (tag.includes('aria-checked="true"')) return "true";
  if (tag.includes('aria-checked="false"')) return "false";
  return null;
}

describe("Capture kind toggle on arrival (Photograph a sketch)", () => {
  for (const locale of ["en", "es-AR"] as const) {
    it(`${locale}: opens with Sketch selected and Plan not`, () => {
      const t = getStrings(locale);
      const html = renderToString(<IntakeScreen locale={locale} arSupported={false} />);
      expect(checkedOf(html, t["intake.kind.sketch"])).toBe("true");
      expect(checkedOf(html, t["intake.kind.plan"])).toBe("false");
    });
  }
});
