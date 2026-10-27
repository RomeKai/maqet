import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { IntakeScreen } from "./IntakeScreen";
import { ArMeasure } from "../measure/ArMeasure";
import { applySceneOp } from "../scene/store";
import { chainCornersToWalls } from "../measure/cornerMath";
import type { XrHitTestAdapter, XrTapCallbacks } from "../measure/xrAdapter";
import type { Scene } from "../scene/types";
import type { SceneOp } from "../scene/store";
import type { Vec3 } from "../measure/cornerMath";
import { getStrings } from "../i18n";

/**
 * ADR-025 Mode A reachability: "Measure (AR)" is a first-class Capture chip
 * next to Plan/Sketch, visible from no photo when WebXR immersive-ar is
 * supported, hidden when unsupported (B/C fallback).
 * `arSupported` is the detection seam (production auto-detects).
 */
describe("Capture modes (ADR-025 Mode A chip)", () => {
  it("shows Measure (AR) with no photo when AR is supported", () => {
    const html = renderToString(<IntakeScreen locale="en" arSupported={true} />);
    expect(html).toContain(getStrings("en")["intake.capture.ar"]);
    // Plan/Sketch capture stays reachable alongside it.
    expect(html).toContain(getStrings("en")["intake.kind.plan"]);
    expect(html).toContain(getStrings("en")["intake.kind.sketch"]);
  });

  it("hides the AR chip when unsupported (B/C fallback)", () => {
    const html = renderToString(<IntakeScreen locale="en" arSupported={false} />);
    expect(html).not.toContain("Measure (AR)");
    expect(html).toContain(getStrings("en")["intake.kind.plan"]);
    expect(html).toContain(getStrings("en")["intake.kind.sketch"]);
  });

  it("has the es-AR string", () => {
    const html = renderToString(<IntakeScreen locale="es-AR" arSupported={true} />);
    expect(html).toContain(getStrings("es-AR")["intake.capture.ar"]);
  });
});

/** Fake hit-test adapter: injects tapped corners without a device. */
function makeTapAdapter(taps: Vec3[]): XrHitTestAdapter {
  return {
    async start(callbacks: XrTapCallbacks): Promise<void> {
      for (const tap of taps) callbacks.onTapCorner(tap);
    },
    end(): void {},
  };
}

describe("Mode A from empty (no photo, no walls yet)", () => {
  const emptyScene: Scene = { id: "intake" };
  const room: Vec3[] = [
    [0, 0, 0],
    [4, 0, 0],
    [4, 0, -3],
    [0, 0, -3],
  ];

  it("offers corner taps, not the no-walls dead end", () => {
    const html = renderToString(
      <ArMeasure
        locale="en"
        scene={emptyScene}
        adapter={makeTapAdapter(room)}
        onChange={() => {}}
        onDone={() => {}}
        onCancel={() => {}}
      />,
    );
    // No "no walls" dead-end: the AR flow offers tape action directly.
    expect(html).not.toContain("No walls yet");
    expect(html).toContain("Measure with AR");
  });

  it("chained taps become connected addWall ops with measured_ar provenance", () => {
    // Same pure path the component wires: chain taps -> addWall ops -> store.
    const closing: Vec3 = [0.08, 0, 0.06]; // ~10 cm from the first corner
    const chain = chainCornersToWalls([...room, closing]);
    expect(chain.closed).toBe(true);
    expect(chain.walls).toHaveLength(4);
    let next = emptyScene;
    for (const wall of chain.walls) {
      const op: SceneOp = { type: "addWall", wall };
      next = applySceneOp(next, op);
    }
    const walls = next.walls ?? [];
    expect(walls.map((w) => w.id)).toEqual(["wall-1", "wall-2", "wall-3", "wall-4"]);
    expect(walls.map((w) => w.measured_length_m)).toEqual([4, 3, 4, 3]);
    expect(walls.every((w) => w.provenance === "measured_ar")).toBe(true);
    for (let i = 1; i < walls.length; i++) {
      expect(walls[i]!.a).toEqual(walls[i - 1]!.b);
    }
    expect(walls[3]!.b).toEqual(walls[0]!.a);
  });
});
