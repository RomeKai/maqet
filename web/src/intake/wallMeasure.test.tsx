import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ScaleTool, formatMeasureM } from "./ScaleTool";
import { CornerEditor } from "./CornerEditor";
import {
  allWallsMeasured,
  applySceneOp,
  isWallEstimated,
  wallDisplayLengthM,
} from "../scene/store";
import { parseDimensionMeters } from "./image";
import type { IntakeProposalDimension } from "./api";
import type { Scene } from "../scene/types";
import type { SceneOp } from "../scene/store";

const dims: IntakeProposalDimension[] = [
  { text: "3,50", a: [0, 0.02], b: [1, 0.02], wall_index: 0 },
];

const scene: Scene = {
  id: "intake",
  version: 1,
  units: "m",
  scale_confirmed: false,
  ceiling_height_m: 2.6,
  walls: [
    { id: "w0", a: [0, 0], b: [2.4, 0], thickness_m: 0.2, kind: "exterior", provenance: "estimated" },
    {
      id: "w1",
      a: [2.4, 0],
      b: [2.4, 3.5],
      thickness_m: 0.1,
      kind: "interior",
      provenance: "written_on_sketch",
      measured_length_m: 3.5,
    },
  ],
  openings: [],
  rooms: [],
};

function noopChange(_next: Scene, _op: SceneOp): void {}
function noopDone(_next: Scene): void {}
function noopCancel(): void {}

describe("per-wall measure flow (BUG2+3)", () => {
  it("parses the read chip '3,50' as 3.5 m", () => {
    expect(parseDimensionMeters("3,50")).toBeCloseTo(3.5, 6);
  });

  it("setWallLength stores the length + provenance and stretches the wall", () => {
    const next = applySceneOp(scene, {
      type: "setWallLength",
      wallId: "w0",
      lengthM: 3.5,
      provenance: "written_on_sketch",
    });
    expect(next.version).toBe(2);
    const w0 = next.walls?.[0];
    expect(w0?.measured_length_m).toBeCloseTo(3.5, 9);
    expect(w0?.provenance).toBe("written_on_sketch");
    expect(Math.hypot(w0!.b[0] - w0!.a[0], w0!.b[1] - w0!.a[1])).toBeCloseTo(3.5, 9);
    // The other wall is untouched.
    expect(next.walls?.[1]).toEqual(scene.walls?.[1]);
  });

  it("setWallLength rejects non-positive lengths without touching the scene", () => {
    for (const lengthM of [0, -2, Number.NaN]) {
      const next = applySceneOp(scene, {
        type: "setWallLength",
        wallId: "w0",
        lengthM,
        provenance: "measured_tape",
      });
      expect(next.version).toBe(scene.version);
      expect(next.walls?.[0]).toEqual(scene.walls?.[0]);
    }
  });

  it("allWallsMeasured flips only when no estimated wall remains", () => {
    expect(allWallsMeasured(scene)).toBe(false);
    const confirmed = applySceneOp(scene, {
      type: "setWallLength",
      wallId: "w0",
      lengthM: 3.5,
      provenance: "measured_tape",
    });
    expect(allWallsMeasured(confirmed)).toBe(true);
  });

  it("wallDisplayLengthM prefers the measured length over geometry", () => {
    expect(wallDisplayLengthM(scene.walls![1]!)).toBeCloseTo(3.5, 9);
    expect(wallDisplayLengthM(scene.walls![0]!)).toBeCloseTo(2.4, 9);
  });

  it("treats estimated provenance as not measured", () => {
    expect(isWallEstimated(scene.walls![0]!)).toBe(true);
    expect(isWallEstimated(scene.walls![1]!)).toBe(false);
  });

  it("formats measures per locale (Intl: 3.50 m / 3,50 m)", () => {
    expect(formatMeasureM("en", 3.5)).toBe("3.50 m");
    expect(formatMeasureM("es-AR", 3.5)).toBe("3,50 m");
  });

  it("ScaleTool shows one row per wall with its measure, estimated flagged", () => {
    const html = renderToString(
      <ScaleTool
        locale="en"
        scene={scene}
        dimensions={dims}
        onChange={noopChange}
        onDone={noopDone}
        onCancel={noopCancel}
      />,
    );
    // Measure on each wall.
    expect(html).toContain("2.40");
    expect(html).toContain("3.50");
    // Estimated wall is flagged, both in text and with the amber row style.
    expect(html).toContain("estimated");
    expect(html).toContain("wall-row-estimated");
    // The read chip keeps its transcribed text and parses to the wall length.
    expect(html).toContain("3,50");
    // No pixel/scale-math wording anywhere in the UI.
    expect(html.toLowerCase()).not.toContain("pixel");
  });

  it("ScaleTool labels sketch-read walls From sketch, not Measured", () => {
    const html = renderToString(
      <ScaleTool
        locale="en"
        scene={scene}
        dimensions={dims}
        onChange={noopChange}
        onDone={noopDone}
        onCancel={noopCancel}
      />,
    );
    // w1 carries written_on_sketch: its row flag names the sketch source.
    expect(html).toContain("From sketch");
  });

  it("CornerEditor marks estimated walls with the amber dashed style", () => {
    const html = renderToString(
      <CornerEditor
        locale="en"
        scene={scene}
        imageUrl={null}
        imageWidth={800}
        imageHeight={600}
        onChange={noopChange}
        onUndo={noopCancel}
        canUndo={false}
      />,
    );
    expect(html).toContain("wall-estimated");
  });
});
