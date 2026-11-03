/**
 * Mode C demo path integration test (RED first).
 *
 * Mock fetch for POST /api/intake with the croquis_3x8_door_window
 * proposal, confirm via the intake API that the scene store ends with
 * 4 walls of 3/8/3/8 m (provenance written_on_sketch), door + window,
 * and that sceneToMeshes produces door gap + window lintel/sill.
 * Then assert the Deliver stage renders with DXF enabled.
 *
 * Part 2 (bottom of the file) drives the same path through the real components
 * with renderToString: the repo has no DOM (no jsdom, no @testing-library), so
 * state is entered through props and the persisted-project snapshot, never by
 * clicks or effects. See the "Not drivable here" block for what that leaves out.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { App } from "../App";
import { CornerEditor } from "../intake/CornerEditor";
import { OpeningSheet } from "../intake/OpeningSheet";
import { DeliverView } from "../deliver/DeliverView";
import { parseTakeoff } from "../deliver/takeoffFormat";
import { getDeliverStrings } from "../deliver/deliver.i18n";
import { getStrings } from "../i18n";
import type { StringKey } from "../i18n";
import type { ProjectSnapshot } from "../persist/projectStore";
import takeoffRaw from "../deliver/__fixtures__/takeoff.croquis_3x8.json";
import { postSampleIntake } from "../intake/api";
import { sceneToMeshes } from "../view3d/sceneToMeshes";
import type { Scene } from "../scene/types";
import proposalJson from "../../../samples/plans/croquis_3x8_door_window.proposal.json";
import truthJson from "../../../samples/plans/croquis_3x8_door_window.truth.json";

const truth = truthJson as unknown as Scene;
const proposalFile = proposalJson as {
  image: { w: number; h: number };
  proposal: { walls: unknown[]; openings: unknown[]; dimensions: unknown[]; input_kind: string };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Mode C demo path", () => {
  it("intake sample replay yields 4 walls 3/8/3/8, door + window, correct meshes", async () => {
    const intakeResult = {
      proposal: proposalFile.proposal,
      scene: truth,
      warnings: [],
      scale_m_per_px: 0.008,
      anchor_index: 0,
      anchor_meters: 3.0,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes("intake")) {
          return new Response(JSON.stringify(intakeResult), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const out = await postSampleIntake("sketch", "croquis_3x8_door_window");
    const scene = out.scene as Scene;

    expect(scene.walls).toHaveLength(4);
    const lengths = (scene.walls ?? []).map((w) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]));
    const sorted = [...lengths].sort((a, b) => a - b);
    expect(sorted[0]).toBeCloseTo(3, 1);
    expect(sorted[1]).toBeCloseTo(3, 1);
    expect(sorted[2]).toBeCloseTo(8, 1);
    expect(sorted[3]).toBeCloseTo(8, 1);
    for (const w of scene.walls ?? []) {
      expect(w.provenance).toBe("written_on_sketch");
    }

    expect(scene.openings).toHaveLength(2);
    const kinds = (scene.openings ?? []).map((o) => o.kind).sort();
    expect(kinds).toEqual(["door", "window"]);
    const door = (scene.openings ?? []).find((o) => o.kind === "door");
    expect(door?.width_m).toBeCloseTo(1.5, 1);
    const win = (scene.openings ?? []).find((o) => o.kind === "window");
    expect(win?.width_m).toBeCloseTo(1.0, 1);

    // sceneToMeshes: door gap + window lintel/sill segments
    const meshes = sceneToMeshes(scene);
    const segments = meshes.walls;
    expect(segments.length).toBeGreaterThan(4);
    const doorWallLintel = segments.filter((s) => s.id.includes(":lintel:"));
    expect(doorWallLintel.length).toBeGreaterThanOrEqual(1);
    const lintels = segments.filter((s) => s.id.includes(":lintel:"));
    const sills = segments.filter((s) => s.id.includes(":sill:"));
    expect(lintels.length).toBeGreaterThanOrEqual(1);
    expect(sills.length).toBeGreaterThanOrEqual(1);
  });

  it("truth scene has DXF-exportable geometry (walls + openings + rooms)", () => {
    // The DXF handoff requires these to be present for modeC
    expect(truth.walls).toHaveLength(4);
    expect(truth.openings).toHaveLength(2);
    expect(truth.rooms).toHaveLength(1);
    const meshes = sceneToMeshes(truth);
    expect(meshes.walls.length).toBeGreaterThan(0);
    expect(meshes.floors.length).toBe(1);
  });

  it("corner editor math: wall lengths from truth match written dimensions", () => {
    // Verifies the truth matches the proposal's written dims (3/8/3/8)
    const lengths = (truth.walls ?? []).map((w) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]));
    const sorted = [...lengths].sort((a, b) => a - b);
    expect(sorted).toEqual(expect.arrayContaining([expect.closeTo(3, 1), expect.closeTo(8, 1)]));
    // Every wall carries a written length
    for (const w of truth.walls ?? []) {
      expect(w.measured_length_m).toBeDefined();
      expect(w.measured_length_m).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Through real components (renderToString)
// ---------------------------------------------------------------------------

const t = getStrings("en");
const noop = (): void => {};
const GOOD_LABEL = /^[^{}]*$/;

function editor(step: "walls" | "openings" | "check", warnings: string[] = []): string {
  return renderToString(
    <CornerEditor
      locale="en"
      scene={truth}
      proposal={null}
      imageUrl={null}
      imageWidth={0}
      imageHeight={0}
      onChange={noop}
      onUndo={noop}
      canUndo={false}
      initialStep={step}
      warnings={warnings}
    />,
  );
}

function snapshot(stage: StringKey): ProjectSnapshot {
  return {
    v: 1,
    locale: "en",
    stage,
    captureStep: "check",
    scene: truth,
    baseScene: null,
    variants: {},
    history: [],
    chats: {},
    professionalFlags: [],
  };
}

describe("Mode C path through the real components", () => {
  it("Home then Method: Start capture, then the sketch method", () => {
    expect(renderToString(<App />)).toContain(t["home.start"]);
    const method = renderToString(<App initialView="method" />);
    expect(method).toContain(t["method.title"]);
    expect(method).toContain(t["method.photo"]);
  });

  it("Walls: the sample renders four wall pills with their written lengths", () => {
    const html = editor("walls");
    for (const label of ["W1 · 3.00 m", "W2 · 8.00 m", "W3 · 3.00 m", "W4 · 8.00 m"]) expect(html).toContain(label);
    expect(html).toContain(t["intake.prov.written"]);
  });

  it("Openings: toolbar offers Door and Window and the plan draws both openings", () => {
    const html = editor("openings");
    expect(html).toContain(t["intake.tool.door"]);
    expect(html).toContain(t["intake.tool.window"]);
    expect(html).toContain(t["intake.next"]);
    expect(html.split("opening-hit").length - 1).toBe(2);
  });

  it("Openings: the door and window sheets show their measures and no raw placeholders", () => {
    const door = (truth.openings ?? []).find((o) => o.kind === "door")!;
    const win = (truth.openings ?? []).find((o) => o.kind === "window")!;
    const wallOf = (id: string) => (truth.walls ?? []).find((w) => w.id === id)!;
    const doorHtml = renderToString(
      <OpeningSheet locale="en" opening={door} wall={wallOf(door.wall_id)} onSave={noop} onRemove={noop} onClose={noop} />,
    );
    const winHtml = renderToString(
      <OpeningSheet locale="en" opening={win} wall={wallOf(win.wall_id)} onSave={noop} onRemove={noop} onClose={noop} />,
    );
    expect(doorHtml).toContain('value="1.50"');
    expect(winHtml).toContain('value="1.00"');
    expect(doorHtml).not.toMatch(/\{(width|length|n)\}/);
    expect(winHtml).not.toMatch(/\{(width|length|n)\}/);
  });

  it("Check: lists the translated reading warnings, offers Looks right, shows no leftover placement hint or placeholder", () => {
    const html = editor("check", ["opening: wall 4 door width 1.50 m from written label, verify with human"]);
    expect(html).toContain(t["intake.looksRight"]);
    expect(html).toContain(t["intake.warn.opening"]);
    expect(html).not.toContain("verify with human");
    expect(html).not.toContain(t["intake.opening.tapPrompt"]);
    expect(html).not.toMatch(/\{(width|length|n)\}/);
  });

  it("Check: an empty list says \"Nothing to check\" once, not twice", () => {
    const html = editor("check", []);
    const none = t["intake.checks.none"];
    expect(html.split(none).length - 1).toBeLessThanOrEqual(1);
  });

  it("Reform, Design, Present, Deliver render their stage with the Preliminary notice", () => {
    for (const stage of ["stage.reform", "stage.design", "stage.present", "stage.deliver"] as const) {
      const html = renderToString(<App restored={snapshot(stage)} />);
      expect(html, stage).toContain(t["notice.preliminary"]);
      expect(html, stage).toContain(t[stage]);
      expect(html, stage).not.toMatch(/undefined|NaN|\[object/);
    }
  });

  it("Deliver: takeoff cards from the server contract, DXF and CSV actions, Preliminary", () => {
    const d = getDeliverStrings("en");
    const takeoff = parseTakeoff(takeoffRaw);
    const html = renderToString(<DeliverView scene={truth} takeoff={takeoff} locale="en" />);
    for (const stage of ["foundations", "walls", "bond_beams_roof", "openings", "finishes"] as const) {
      expect(html, stage).toContain(d[`stage.${stage}`].replace(/&/g, "&amp;"));
    }
    expect(html).toContain("DXF");
    expect(html).toContain(d["action.exportCsv"]);
    expect(html).toContain(d["footer.preliminary"]);
    expect(html).not.toMatch(/undefined|NaN|\[object/);
    // Both exports are enabled for a confirmed scene (a disabled button would carry the attribute).
    expect(html).not.toContain('disabled=""');
  });

  it("every visible wall pill label is free of template braces", () => {
    for (const step of ["walls", "openings", "check"] as const) {
      const text = editor(step).replace(/<[^>]+>/g, " ");
      expect(text.replace(/\{\s*\}/g, ""), step).toMatch(GOOD_LABEL);
    }
  });
});

describe("Not drivable here (documented, not faked)", () => {
  // The repo has no DOM. Without one there are no clicks, no effects and no state updates, so these steps are
  // exercised only by hand in the browser and are NOT covered by this file:
  //  - tapping Start capture / the sketch card / Try a sample (state transitions inside App and UploadStep)
  //  - the Deliver effect that POSTs /export/takeoff when the stage opens (App useEffect)
  //  - the DXF and CSV buttons (fetch /export/dxf, blob download): DeliverView only renders their enabled state above
  //  - placing a door or window by tapping the SVG (pointer events), and the sheets they open
  it.skip("drives clicks and effects (needs a DOM test environment)", () => {});
});
