import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { App } from "./App";
import { DEFAULT_LOCALE, getStrings } from "./i18n";

describe("App stages", () => {
  it("stage capture renders IntakeScreen", () => {
    const t = getStrings(DEFAULT_LOCALE);
    const html = renderToString(<App />);
    expect(html).toContain(t["intake.upload.cta"]);
    expect(html).toContain(t["intake.upload.hint"]);
    expect(html).toContain(t["stage.capture"]);
  });
});
