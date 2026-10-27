import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { App } from "../App";
import { DEFAULT_LOCALE, getStrings } from "../i18n";
import { UploadStatus, uploadBusyText } from "./UploadStep";
import { IntakeScreen } from "./IntakeScreen";
import { ScaleBadge } from "./ScaleBadge";
import type { Scene } from "../scene/types";

const confirmedScene: Scene = {
  id: "intake",
  version: 3,
  units: "m",
  scale_confirmed: true,
  ceiling_height_m: 2.6,
  walls: [{ id: "w1", a: [0, 0], b: [3.5, 0], thickness_m: 0.2, kind: "exterior" }],
  openings: [],
  rooms: [],
};

/** Initial receipt text for the locale under test. */
function startReceipt(): string {
  return getStrings(DEFAULT_LOCALE)["sheet.receipt"];
}

describe("BUG4: reading state, receipt hiding, scale badge", () => {
  it("staged reading label is visible during the Spark POST (en + es-AR)", () => {
    expect(uploadBusyText("en", "reading")).toBe("Reading your plan… up to a minute");
    expect(uploadBusyText("es-AR", "reading")).toBe("Leyendo tu plano… puede tardar hasta un minuto");
    // The preparing (downscale) stage keeps the existing busy label.
    expect(uploadBusyText("en", "preparing")).toBe(getStrings("en")["intake.upload.busy"]);
    expect(uploadBusyText("es-AR", "preparing")).toBe(getStrings("es-AR")["intake.upload.busy"]);
  });

  it("UploadStatus renders the reading line with a polite live region", () => {
    const html = renderToString(<UploadStatus locale="en" phase="reading" />);
    expect(html).toContain("Reading your plan");
    expect(html).toContain('role="status"');
    expect(html).toContain("aria-live");
  });

  it("start receipt is hidden once a photo is set", () => {
    const before = renderToString(<App />);
    expect(before).toContain(startReceipt());
  });

  it("topbar badge flips to Measured once scale_confirmed is true", () => {
    const t = getStrings(DEFAULT_LOCALE);
    const html = renderToString(<IntakeScreen locale={DEFAULT_LOCALE} initialScene={confirmedScene} />);
    expect(html).toContain(t["badge.measured"]);
    expect(html).not.toContain("badge-notoscale");
  });

  it("unconfirmed scenes keep the Not to scale badge", () => {
    const t = getStrings(DEFAULT_LOCALE);
    const html = renderToString(<App />);
    expect(html).toContain(t["badge.notToScale"]);
    expect(html).not.toContain(t["badge.measured"]);
  });

  it("ScaleBadge is the single source of truth for both render paths (en + es-AR)", () => {
    for (const locale of ["en", "es-AR"] as const) {
      const t = getStrings(locale);
      // Component renders both states in both locales.
      expect(renderToString(<ScaleBadge locale={locale} scaleConfirmed />)).toContain(t["badge.measured"]);
      expect(renderToString(<ScaleBadge locale={locale} scaleConfirmed={false} />)).toContain(
        t["badge.notToScale"],
      );
      // App topbar consumes the component (confirmed scene -> measured).
      const appHtml = renderToString(<App initialLocale={locale} initialScene={confirmedScene} />);
      expect(appHtml).toContain(t["badge.measured"]);
      // IntakeScreen head consumes the component (confirmed scene -> measured).
      const intakeHtml = renderToString(
        <IntakeScreen locale={locale} initialScene={confirmedScene} />,
      );
      expect(intakeHtml).toContain(t["badge.measured"]);
    }
  });
});
