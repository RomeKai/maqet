import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextSteps, nextStepKeys } from "./NextSteps";

describe("nextStepKeys", () => {
  it("always ends with handing the DXF to a professional", () => {
    expect(nextStepKeys({ estimatedWalls: 0, flagCount: 0 })).toEqual(["step.dxf"]);
  });
  it("asks to measure estimated walls first, then the professional check", () => {
    expect(nextStepKeys({ estimatedWalls: 2, flagCount: 1 })).toEqual(["step.measure", "step.professional", "step.dxf"]);
  });
});

describe("NextSteps", () => {
  it("renders localized steps and the call-a-professional note", () => {
    const html = renderToStaticMarkup(<NextSteps locale="es-AR" estimatedWalls={1} flagCount={1} />);
    expect(html).toContain("Próximos pasos");
    expect(html).toContain("profesional");
  });
});
