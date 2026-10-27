import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import {
  CornerEditor,
  calibratePhotoSpace,
  photoToScene,
  sceneToPhoto,
} from "./CornerEditor";
import type { IntakeProposal } from "./api";
import type { Scene } from "../scene/types";
import type { SceneOp } from "../scene/store";

/**
 * BUG1: the editor canvas is photo-pixel space, but the Scene (meters) was
 * drawn raw in it, piling top-left. The normalized proposal (0..1, y-down)
 * must map to the displayed photo size instead.
 *
 * Fixture: photo 800x600 px. Proposal bbox in px: x 200..600, y 150..450.
 * Scene draft is the server mapping with m_per_px = 0.01, min-shifted:
 *   wall1 (0.25,0.25)->(0.75,0.25) becomes a=[0,3] b=[4,3]
 *   wall2 (0.75,0.25)->(0.75,0.75) becomes a=[4,3] b=[4,0]
 */
const proposal: IntakeProposal = {
  input_kind: "plan",
  walls: [
    { a: [0.25, 0.25], b: [0.75, 0.25], kind: "exterior" },
    { a: [0.75, 0.25], b: [0.75, 0.75], kind: "interior" },
  ],
  openings: [],
  labels: [],
  dimensions: [{ text: "3,50 m", a: [0.25, 0.25], b: [0.75, 0.25], wall_index: 0 }],
};

const scene: Scene = {
  id: "intake",
  version: 1,
  units: "m",
  scale_confirmed: false,
  ceiling_height_m: 2.6,
  walls: [
    { id: "w0", a: [0, 3], b: [4, 3], thickness_m: 0.2, kind: "exterior" },
    { id: "w1", a: [4, 3], b: [4, 0], thickness_m: 0.1, kind: "interior" },
  ],
  openings: [],
  rooms: [],
};

function noopScene(_next: Scene, _op: SceneOp): void {}
function noopUndo(): void {}

/** First <line class="proposal-wall"> coords in render order. */
function proposalWallCoords(html: string): { x1: number; y1: number; x2: number; y2: number } {
  const match = /<line[^>]*class="proposal-wall"[^>]*>/.exec(html);
  if (match === null) throw new Error("no proposal-wall line rendered");
  const tag = match[0];
  const num = (name: string): number => {
    const m = new RegExp(`${name}="([\\d.]+)"`).exec(tag);
    if (m === null || m[1] === undefined) throw new Error(`missing ${name}`);
    return Number(m[1]);
  };
  return { x1: num("x1"), y1: num("y1"), x2: num("x2"), y2: num("y2") };
}

/** left/top % of the first .handle-btn (w0 endpoint a). */
function firstHandlePercent(html: string): { left: number; top: number } {
  const match = /<button[^>]*class="handle-btn"[^>]*>/.exec(html);
  if (match === null) throw new Error("no handle-btn rendered");
  const tag = match[0];
  const pct = (name: string): number => {
    const m = new RegExp(`${name}:([\\d.]+)%`).exec(tag);
    if (m === null || m[1] === undefined) throw new Error(`missing ${name}`);
    return Number(m[1]);
  };
  return { left: pct("left"), top: pct("top") };
}

describe("calibratePhotoSpace", () => {
  it("recovers meters-per-pixel from proposal and scene extents", () => {
    const cal = calibratePhotoSpace(proposal, scene, 800, 600);
    expect(cal).not.toBeNull();
    expect(cal?.metersPerPx).toBeCloseTo(0.01, 9);
  });

  it("maps scene meters onto photo pixels and back", () => {
    const cal = calibratePhotoSpace(proposal, scene, 800, 600);
    if (cal === null) throw new Error("calibration failed");
    // Scene a=[0,3] sits on proposal (0.25,0.25) -> photo (200,150).
    const dsp = sceneToPhoto(cal, 0, 3);
    expect(dsp.x).toBeCloseTo(200, 6);
    expect(dsp.y).toBeCloseTo(150, 6);
    // Scene b=[4,0] sits on proposal (0.75,0.75) -> photo (600,450).
    const dsp2 = sceneToPhoto(cal, 4, 0);
    expect(dsp2.x).toBeCloseTo(600, 6);
    expect(dsp2.y).toBeCloseTo(450, 6);
    // Round trip: photo pixels invert back to scene meters.
    const back = photoToScene(cal, 200, 150);
    expect(back.x).toBeCloseTo(0, 9);
    expect(back.y).toBeCloseTo(3, 9);
  });

  it("returns null when the proposal is missing", () => {
    expect(calibratePhotoSpace(null, scene, 800, 600)).toBeNull();
    expect(calibratePhotoSpace(undefined, scene, 800, 600)).toBeNull();
  });

  it("returns null for degenerate (zero-extent) geometry", () => {
    const point: IntakeProposal = {
      input_kind: "plan",
      walls: [{ a: [0.5, 0.5], b: [0.5, 0.5], kind: null }],
      openings: [],
      labels: [],
      dimensions: [],
    };
    expect(calibratePhotoSpace(point, scene, 800, 600)).toBeNull();
  });
});

describe("CornerEditor proposal overlay (BUG1)", () => {
  it("draws proposal walls at photo-pixel positions", () => {
    const html = renderToString(
      <CornerEditor
        locale="en"
        scene={scene}
        proposal={proposal}
        imageUrl="photo.jpg"
        imageWidth={800}
        imageHeight={600}
        onChange={noopScene}
        onUndo={noopUndo}
        canUndo={false}
      />,
    );
    const wall = proposalWallCoords(html);
    expect(wall.x1).toBeCloseTo(200, 6);
    expect(wall.y1).toBeCloseTo(150, 6);
    expect(wall.x2).toBeCloseTo(600, 6);
    expect(wall.y2).toBeCloseTo(150, 6);
  });

  it("draws proposal dimensions with their transcribed text", () => {
    const html = renderToString(
      <CornerEditor
        locale="en"
        scene={scene}
        proposal={proposal}
        imageUrl="photo.jpg"
        imageWidth={800}
        imageHeight={600}
        onChange={noopScene}
        onUndo={noopUndo}
        canUndo={false}
      />,
    );
    expect(html).toContain("proposal-dim");
    expect(html).toContain("3,50 m");
  });

  it("places scene handles at displayed-size positions, not top-left", () => {
    const html = renderToString(
      <CornerEditor
        locale="en"
        scene={scene}
        proposal={proposal}
        imageUrl="photo.jpg"
        imageWidth={800}
        imageHeight={600}
        onChange={noopScene}
        onUndo={noopUndo}
        canUndo={false}
      />,
    );
    // Scene w0 endpoint a=[0,3] displays at photo (200,150) -> 25%, 25%.
    const handle = firstHandlePercent(html);
    expect(handle.left).toBeCloseTo(25, 6);
    expect(handle.top).toBeCloseTo(25, 6);
  });

  it("keeps the legacy scene rendering when no proposal is given", () => {
    const html = renderToString(
      <CornerEditor
        locale="en"
        scene={scene}
        imageUrl="photo.jpg"
        imageWidth={800}
        imageHeight={600}
        onChange={noopScene}
        onUndo={noopUndo}
        canUndo={false}
      />,
    );
    expect(html).not.toContain("proposal-wall");
    expect(html).toContain('x1="0"');
    expect(html).toContain('y2="3"');
  });
});
