import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import {
  ArHud,
  parseTypedHeightM,
  previewCeilingHeight,
} from "./ArMeasure";
import { captureReducer, initialCaptureState } from "./captureSession";

const FLOOR_Y = 0.5;

/** Pending wall A(0,0)->B(4,0) at floor 0.5: the ceiling step. */
function ceilingState() {
  let s = initialCaptureState();
  s = captureReducer(s, {
    type: "floorHit",
    point: [0, FLOOR_Y, 0],
    horizontal: true,
  }).state;
  s = captureReducer(s, { type: "baseTap", point: [0, FLOOR_Y, 0] }).state;
  s = captureReducer(s, { type: "baseTap", point: [4, FLOOR_Y, 0] }).state;
  return s;
}

/** World->view matrix: camera at (0,1.6,2) looking -Z. */
const EYE_UP_VIEW = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, -1.6, -2, 1,
];

describe("fix 2 ceiling confirm UI (RED: no hit-test ceiling)", () => {
  it("pill shows type-height input + Use 2.60 m on the ceiling step", () => {
    const html = renderToString(
      <ArHud
        locale="en"
        hudRef={{ current: null }}
        capture={ceilingState()}
        measureLocale="en"
        previewCeilM={2.7}
      />,
    );
    expect(html).toContain("Type height");
    expect(html).toContain("Use 2.60 m");
    expect(html).toContain("2.70");
  });

  it("renders the es-AR copy under es-AR", () => {
    const html = renderToString(
      <ArHud
        locale="es-AR"
        hudRef={{ current: null }}
        capture={ceilingState()}
        measureLocale="es-AR"
        previewCeilM={2.7}
      />,
    );
    expect(html).toContain("Escrib");
    expect(html).toContain("Usar 2,60 m");
  });

  it("shows no ceiling UI before the ceiling step", () => {
    let s = initialCaptureState();
    s = captureReducer(s, {
      type: "floorHit",
      point: [0, FLOOR_Y, 0],
      horizontal: true,
    }).state;
    const html = renderToString(
      <ArHud
        locale="en"
        hudRef={{ current: null }}
        capture={s}
        measureLocale="en"
        previewCeilM={null}
      />,
    );
    expect(html).not.toContain("Type height");
    expect(html).not.toContain("Use 2.60 m");
  });

  it("previewCeilingHeight: null without matrices, ray height with them", () => {
    const s = ceilingState();
    expect(previewCeilingHeight(s, null)).toBeNull();
    // Wall plane z=0; eye (0,1.6,2) looking -Z hits at t=2, y=1.6: 1.6-0.5=1.1.
    expect(previewCeilingHeight(s, EYE_UP_VIEW)).toBeCloseTo(1.1, 6);
  });

  it("parseTypedHeightM accepts 2.6 and 2,6, rejects junk", () => {
    expect(parseTypedHeightM("2.6")).toBeCloseTo(2.6, 9);
    expect(parseTypedHeightM("2,6")).toBeCloseTo(2.6, 9);
    expect(parseTypedHeightM(" 2.60 m ")).toBeCloseTo(2.6, 9);
    expect(parseTypedHeightM("")).toBeNull();
    expect(parseTypedHeightM("abc")).toBeNull();
    expect(parseTypedHeightM("-1")).toBeNull();
    expect(parseTypedHeightM("0")).toBeNull();
  });
});
