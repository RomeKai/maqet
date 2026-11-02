import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { IntakeScreen } from "./IntakeScreen";
import { getStrings } from "../i18n";
import type { Scene } from "../scene/types";
import truthJson from "../../../samples/plans/croquis_3x8_door_window.truth.json";

const truth = truthJson as unknown as Scene;

describe("a restored project reopens its plan editor", () => {
  it("a scene with walls shows the editor (wall pills), not the photo upload", () => {
    const t = getStrings("en");
    const html = renderToString(<IntakeScreen locale="en" initialScene={truth} />);
    expect(html).toContain("W1 · 3.00 m");
    expect(html).not.toContain(t["intake.upload.cta"]);
  });

  it("an empty project still starts at the photo upload", () => {
    const t = getStrings("en");
    const html = renderToString(<IntakeScreen locale="en" />);
    expect(html).toContain(t["intake.upload.cta"]);
    expect(html).not.toContain("W1 ·");
  });
});
