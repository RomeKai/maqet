import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import {
  CornerEditor,
  calibratePhotoSpace,
  photoToScene,
  previewEndpoint,
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

  it("renders proposal openings on their wall spans", () => {    const withOpenings: IntakeProposal = {
      ...proposal,
      openings: [{ wall_index: 0, t0: 0.2, t1: 0.5, kind: "door" }],
    };
    const html = renderToString(
      <CornerEditor
        locale="en"
        scene={scene}
        proposal={withOpenings}
        imageUrl="photo.jpg"
        imageWidth={800}
        imageHeight={600}
        onChange={noopScene}
        onUndo={noopUndo}
        canUndo={false}
      />,
    );
    // Wall 0 spans photo x 200..600: door t0..t1 maps to x 280..400, y 150.
    expect(html).toContain("proposal-opening-door");
    expect(html).toContain('x1="280"');
    expect(html).toContain('x2="400"');
  });
});

describe("shared corner handles", () => {
  const square: Scene = {
    id: "intake",
    version: 1,
    units: "m",
    scale_confirmed: false,
    ceiling_height_m: 2.6,
    walls: [
      { id: "w0", a: [0, 0], b: [4, 0], thickness_m: 0.2, kind: "exterior" },
      { id: "w1", a: [4, 0], b: [4, 3], thickness_m: 0.2, kind: "exterior" },
      { id: "w2", a: [4, 3], b: [0, 3], thickness_m: 0.2, kind: "exterior" },
      { id: "w3", a: [0, 3], b: [0, 0], thickness_m: 0.2, kind: "exterior" },
    ],
    openings: [],
    rooms: [],
  };

  function renderEditor(extra: Record<string, unknown> = {}): string {
    return renderToString(
      <CornerEditor
        locale="en"
        scene={square}
        imageUrl={null}
        imageWidth={800}
        imageHeight={600}
        onChange={noopScene}
        onUndo={noopUndo}
        canUndo={false}
        {...extra}
      />,
    );
  }

  it("renders one handle per shared corner (4, not 8)", () => {
    const html = renderEditor();
    const count = (html.match(/handle-btn/g) ?? []).length;
    expect(count).toBe(4);
  });

  it("shows the selected wall length label", () => {
    const html = renderEditor({ initialSelectedWallId: "w0" });
    expect(html).toContain("W1");
    expect(html).toContain("4.00");
  });

  it("highlights dragging walls and the active handle", () => {
    const html = renderEditor({
      initialPreview: { wallId: "w0", end: "a", point: { x: 0, y: 0 } },
    });
    expect(html).toContain("wall-dragging");
    expect(html).toContain("handle-active");
  });
});
describe("Mode C toolbar — Door/Window tools (RED: toolbar regression from a24ea68)", () => {
  function toolbarHtml(locale: "en" | "es-AR" = "en"): string {
    return renderToString(
      <CornerEditor
        locale={locale}
        scene={scene}
        imageUrl={null}
        imageWidth={800}
        imageHeight={600}
        onChange={noopScene}
        onUndo={noopUndo}
        canUndo={false}
      />,
    );
  }

  it("toolbar shows Select / Wall / Door / Window / Undo (Door and Window were removed in a24ea68)", () => {
    const html = toolbarHtml();
    expect(html).toContain("Select");
    expect(html).toContain("Wall");
    expect(html).toContain("Door");
    expect(html).toContain("Window");
    expect(html).toContain("Undo");
  });

  it("toolbar labels are localized (es-AR: Puerta / Ventana)", () => {
    const html = toolbarHtml("es-AR");
    expect(html).toContain("Puerta");
    expect(html).toContain("Ventana");
  });
});

describe("Mode C opening — two taps on a wall span produce markOpening (RED)", () => {
  it("two taps along a wall project to an opening placement (form prefilled from span)", async () => {
    const { tapsToPlacement, placementToOpening } = await import("./opening");
    const { applySceneOp, createEmptyScene } = await import("../scene/store");
    const wall = { id: "w0", a: [0, 0] as [number, number], b: [4, 0] as [number, number], thickness_m: 0.1, kind: "interior" as const };
    const res = tapsToPlacement(wall, "door", [0.5, 0], [1.4, 0]);
    expect("placement" in res).toBe(true);
    if (!("placement" in res)) throw new Error("taps rejected");
    expect(res.placement.width_m).toBeCloseTo(0.9, 9);
    expect(res.placement.offset_m).toBeCloseTo(0.5, 9);
    // Form is prefilled from the span: width/height/sill per spec (door 0.9/2.05, window 1.4/1.4 sill 0.8)
    expect(res.placement.height_m).toBeCloseTo(2.05, 9);
    const opening = placementToOpening(res.placement, "o1");
    let sc = createEmptyScene();
    sc = applySceneOp(sc, { type: "addWall", wall });
    sc = applySceneOp(sc, { type: "markOpening", opening });
    expect(sc.openings).toHaveLength(1);
    expect(sc.openings![0]!.kind).toBe("door");
  });

  it("window span prefills sill 0.80 and double-tap still yields window opening", async () => {
    const { tapsToPlacement, placementToOpening } = await import("./opening");
    const wall = { id: "w0", a: [0, 0] as [number, number], b: [4, 0] as [number, number], thickness_m: 0.1, kind: "interior" as const };
    const res = tapsToPlacement(wall, "window", [0.2, 0], [1.6, 0]);
    expect("placement" in res).toBe(true);
    if (!("placement" in res)) throw new Error("taps rejected");
    expect(res.placement.sill_m).toBeCloseTo(0.8, 9);
    expect(res.placement.height_m).toBeCloseTo(1.4, 9);
    const opening = placementToOpening(res.placement, "o2");
    expect(opening.sill_m).toBeCloseTo(0.8, 9);
  });
});


describe("Mode C opening line styles — door arc+gap vs window double line (RED)", () => {
  const makeScene = (): Scene => ({
    id: "intake",
    version: 1,
    units: "m",
    scale_confirmed: false,
    ceiling_height_m: 2.6,
    walls: [{ id: "w0", a: [0, 0], b: [4, 0], thickness_m: 0.1, kind: "interior" }],
    openings: [
      { id: "o-door", wall_id: "w0", kind: "door", offset_m: 0.5, width_m: 0.9, height_m: 2.05 },
      { id: "o-win", wall_id: "w0", kind: "window", offset_m: 2, width_m: 1.2, height_m: 1.4, sill_m: 0.8 },
    ],
    rooms: [],
  });

  it("door renders as an arc+gap (not same style as window) and window as double line", () => {
    const html = renderToString(
      <CornerEditor
        locale="en"
        scene={makeScene()}
        imageUrl={null}
        imageWidth={800}
        imageHeight={600}
        onChange={noopScene}
        onUndo={noopUndo}
        canUndo={false}
      />,
    );
    // Door: a swung-arc path + a gap marker on the wall line
    expect(html).toContain('class="opening-door"');
    expect(html).toContain('class="opening-door-arc"');
    expect(html).toContain('class="opening-door-gap"');
    // Window: two thin parallel lines (double line), not a single dashed line
    expect(html).toContain('class="opening-window"');
    expect((html.match(/class="opening-window"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("previewEndpoint (live drag preview)", () => {
  const wall = scene.walls![0]!;

  it("returns the finger point while its wall corner is dragged", () => {
    expect(
      previewEndpoint(wall, "a", { wallId: "w0", end: "a", point: { x: 1, y: 2 } }),
    ).toEqual([1, 2]);
  });

  it("returns the stored endpoint when nothing is dragged", () => {
    expect(previewEndpoint(wall, "a", null)).toEqual(wall.a);
    expect(previewEndpoint(wall, "b", null)).toEqual(wall.b);
  });

  it("ignores a preview for another wall or the other end", () => {
    expect(
      previewEndpoint(wall, "a", { wallId: "w9", end: "a", point: { x: 1, y: 2 } }),
    ).toEqual(wall.a);
    expect(
      previewEndpoint(wall, "a", { wallId: "w0", end: "b", point: { x: 1, y: 2 } }),
    ).toEqual(wall.a);
  });
});
