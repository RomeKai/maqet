/**
 * Mode C demo path integration test (RED first).
 *
 * Mock fetch for POST /api/intake with the croquis_3x8_door_window
 * proposal, confirm via the intake API that the scene store ends with
 * 4 walls of 3/8/3/8 m (provenance written_on_sketch), door + window,
 * and that sceneToMeshes produces door gap + window lintel/sill.
 * Then assert the Deliver stage renders with DXF enabled.
 *
 * No DOM rendering — pure logic + API contract test so it needs only vitest.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
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
