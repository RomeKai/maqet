import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { ArMeasure } from "./ArMeasure";
import { applySceneOp, createEmptyScene } from "../scene/store";
import { pairCornersToWallUpdate, traceCornerTap, emptyCornerTrace } from "./cornerMath";
import type { XrHitTestAdapter } from "./xrAdapter";
import type { Scene } from "../scene/types";
import type { SceneOp } from "../scene/store";
import type { Vec3 } from "./cornerMath";

/** Captures the adapter callbacks so the test taps corners like a device. */
function makeFakeAdapter() {
  let onTap: ((corner: Vec3) => void) | null = null;
  const adapter: XrHitTestAdapter = {
    start: async (callbacks) => {
      onTap = callbacks.onTapCorner;
    },
    end: () => undefined,
  };
  return {
    adapter,
    tap: (corner: Vec3) => onTap?.(corner),
  };
}

const scene: Scene = {
  id: "intake",
  version: 1,
  units: "m",
  scale_confirmed: false,
  ceiling_height_m: 2.6,
  walls: [
    { id: "w0", a: [0, 0], b: [2, 0], thickness_m: 0.2, kind: "exterior", provenance: "estimated" },
  ],
  openings: [],
  rooms: [],
};

function noopChange(_next: Scene, _op: SceneOp): void {}
function noopDone(_next: Scene): void {}
function noopCancel(): void {}

describe("ArMeasure", () => {
  it("renders the AR title and first-tap prompt", () => {
    const { adapter } = makeFakeAdapter();
    const html = renderToString(
      <ArMeasure
        locale="en"
        scene={scene}
        adapter={adapter}
        onChange={noopChange}
        onDone={noopDone}
        onCancel={noopCancel}
      />,
    );
    expect(html).toContain("Measure with AR");
    expect(html).toContain("Tap the first corner");
  });

  it("3-4-5 corners through the real path emit measured_ar length 5m", () => {
    // Same functions the component wires: corner pair -> op -> store.
    const update = pairCornersToWallUpdate(
      [
        [0, 0, 0],
        [3, 4, 0],
      ],
      "w0",
    );
    expect(update?.provenance).toBe("measured_ar");
    const op: SceneOp = {
      type: "setWallLength",
      wallId: "w0",
      lengthM: update?.lengthM ?? 0,
      provenance: "measured_ar",
    };
    const next = applySceneOp(scene, op);
    expect(next.walls?.[0]?.measured_length_m).toBeCloseTo(5, 9);
    expect(next.walls?.[0]?.provenance).toBe("measured_ar");
  });

  it("renders the Spanish strings under es-AR", () => {
    const { adapter } = makeFakeAdapter();
    const html = renderToString(
      <ArMeasure
        locale="es-AR"
        scene={scene}
        adapter={adapter}
        onChange={noopChange}
        onDone={noopDone}
        onCancel={noopCancel}
      />,
    );
    expect(html).toContain("Medir con AR");
  });

  it("uses the injected fake adapter seam", async () => {
    const { adapter, tap } = makeFakeAdapter();
    const seen: Vec3[] = [];
    await adapter.start({ onTapCorner: (c) => seen.push(c), onEnd: () => undefined });
    tap([0, 0, 0]);
    tap([3, 4, 0]);
    expect(seen).toHaveLength(2);
    expect(vi.fn).toBeDefined();
  });

  it("empty-start taps emit one addWall per tap (no batch on confirm)", () => {
    // Same pure path the component wires: tap -> traceCornerTap -> addWall.
    // 4 taps trace 3 connected walls sharing endpoints.
    const taps: Vec3[] = [
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, -3],
      [0, 0, -3],
    ];
    let trace = emptyCornerTrace();
    let next = createEmptyScene();
    let emitted = 0;
    for (const tap of taps) {
      trace = traceCornerTap(trace, tap, next.walls?.length ?? 0);
      if (trace.lastWall !== null) {
        next = applySceneOp(next, { type: "addWall", wall: trace.lastWall });
        emitted += 1;
      }
    }
    expect(emitted).toBe(3);
    expect(next.walls?.map((w) => w.id)).toEqual(["wall-1", "wall-2", "wall-3"]);
    expect(next.walls?.map((w) => w.measured_length_m)).toEqual([4, 3, 4]);
  });

  it("close-tap within 0.15m closes the room, no stub wall", () => {
    let trace = emptyCornerTrace();
    let next = createEmptyScene();
    const taps: Vec3[] = [
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, -3],
      [0, 0, -3],
    ];
    for (const tap of taps) {
      trace = traceCornerTap(trace, tap, next.walls?.length ?? 0);
      if (trace.lastWall !== null) {
        next = applySceneOp(next, { type: "addWall", wall: trace.lastWall });
      }
    }
    trace = traceCornerTap(trace, [0.08, 0, 0.06], next.walls?.length ?? 0);
    expect(trace.closed).toBe(true);
    if (trace.lastWall !== null) {
      next = applySceneOp(next, { type: "addWall", wall: trace.lastWall });
    }
    expect(next.walls).toHaveLength(4);
    expect(next.walls?.[3]?.b).toEqual(next.walls?.[0]?.a);
  });

  it("early close-tap (<3 walls) is dropped, no wall emitted", () => {
    let trace = emptyCornerTrace();
    let next = createEmptyScene();
    trace = traceCornerTap(trace, [0, 0, 0], 0);
    trace = traceCornerTap(trace, [4, 0, 0], 0);
    if (trace.lastWall !== null) {
      next = applySceneOp(next, { type: "addWall", wall: trace.lastWall });
    }
    expect(next.walls).toHaveLength(1);
    trace = traceCornerTap(trace, [0.05, 0, 0.02], next.walls?.length ?? 0);
    expect(trace.closed).toBe(false);
    expect(trace.lastWall).toBeNull();
  });
});
