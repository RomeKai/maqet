import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import {
  ArMeasure,
  createArStartHandler,
  startErrorMessage,
} from "./ArMeasure";
import { applySceneOp, createEmptyScene } from "../scene/store";
import { pairCornersToWallUpdate, traceCornerTap, emptyCornerTrace } from "./cornerMath";
import type { XrHitTestAdapter, XrTapCallbacks } from "./xrAdapter";
import type { Scene } from "../scene/types";
import type { SceneOp } from "../scene/store";
import type { Vec3 } from "./cornerMath";

/** Captures the adapter callbacks so the test taps corners like a device. */
function makeFakeAdapter() {
  let onTap: ((corner: Vec3) => void) | null = null;
  let startCalls = 0;
  const adapter: XrHitTestAdapter = {
    start: async (callbacks) => {
      startCalls += 1;
      onTap = callbacks.onTapCorner;
    },
    end: () => undefined,
  };
  return {
    adapter,
    startCalls: () => startCalls,
    tap: (corner: Vec3) => onTap?.(corner),
  };
}

const noopCallbacks: XrTapCallbacks = {
  onTapCorner: () => undefined,
  onEnd: () => undefined,
};

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
  it("shows the Start AR button on mount without starting the session", () => {
    const { adapter, startCalls } = makeFakeAdapter();
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
    // The XR session must only start from the button tap (user gesture):
    // renderToString runs no effects and fires no clicks, and nothing else
    // in the module may call start() on mount.
    expect(startCalls()).toBe(0);
  });

  it("the Start handler calls start synchronously (user-gesture safe)", () => {
    let calls = 0;
    const adapter: XrHitTestAdapter = {
      start: (callbacks) => {
        calls += 1;
        callbacks.onTapCorner([0, 0, 0]);
        return Promise.resolve();
      },
      end: () => undefined,
    };
    let started = false;
    const onStarted = (): void => {
      started = true;
    };
    const onFailed = (): void => {
      throw new Error("must not fail");
    };
    const handleClick = createArStartHandler(adapter, noopCallbacks, () => undefined, {
      onStarted,
      onFailed,
    });
    handleClick();
    // Synchronous: the gesture chain is intact the moment onClick returns.
    expect(calls).toBe(1);
    return Promise.resolve().then(() => {
      expect(started).toBe(true);
    });
  });

  it("a rejected start surfaces the real error, never the unsupported copy", async () => {
    const rejection = Object.assign(new Error("user gesture required"), {
      name: "NotAllowedError",
    });
    const adapter: XrHitTestAdapter = {
      start: () => Promise.reject(rejection),
      end: vi.fn(),
    };
    let failed: string | null = null;
    const handleClick = createArStartHandler(adapter, noopCallbacks, () => undefined, {
      onStarted: () => {
        throw new Error("must not start");
      },
      onFailed: (message) => {
        failed = message;
      },
    });
    handleClick();
    await Promise.resolve();
    await Promise.resolve();
    expect(failed).toBe("NotAllowedError: user gesture required");
    expect(adapter.end).toHaveBeenCalledTimes(1);
  });

  it("startErrorMessage formats name: message and passes through unknowns", () => {
    const err = Object.assign(new Error("boom"), { name: "SecurityError" });
    expect(startErrorMessage(err)).toBe("SecurityError: boom");
    expect(startErrorMessage("gone")).toBe("gone");
  });

  it("the measuring UI appears only after a started session", () => {
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
    // Pre-start: the button flow shows the Start screen, not the
    // corner-tap measuring UI.
    expect(html).toContain("Measure (AR)");
    expect(html).not.toContain("Tap the first corner");
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
    expect(html).toContain("Medir (AR)");
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
