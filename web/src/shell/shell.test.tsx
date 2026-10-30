import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Header } from "./Header";
import { Stepper } from "./Stepper";
import { getStrings } from "../i18n";

describe("shell", () => {
  it("stepper lists five stages and marks the optional ones", () => {
    const t = getStrings("en");
    const html = renderToString(<Stepper locale="en" stage="stage.reform" onSelect={() => {}} />);
    for (const k of ["stage.capture", "stage.reform", "stage.design", "stage.present", "stage.deliver"] as const) {
      expect(html).toContain(t[k]);
    }
    expect(html.split(t["stage.optional"]).length - 1).toBe(2);
    expect(html).toContain('aria-current="step"');
  });

  it("header offers EN/ES and disables back when there is nowhere to go", () => {
    const html = renderToString(<Header locale="es-AR" onLocaleChange={() => {}} scaleConfirmed={false} onBack={null} />);
    expect(html).toContain(">EN<");
    expect(html).toContain(">ES<");
    expect(html).toContain("disabled");
    expect(html).toContain(getStrings("es-AR")["project.place"]);
  });
});
