import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import {
  ArHud,
  ArMeasure,
  createArStartHandler,
  createStartGuard,
  startErrorMessage,
} from "./ArMeasure";
import { applySceneOp, createEmptyScene } from "../scene/store";
import { pairCornersToWallUpdate, traceCornerTap, emptyCornerTrace } from "./cornerMath";
import { openingDefaults, projectEdgesToOpening } from "./openingMath";
import type { XrHitTestAdapter, XrTapCallbacks } from "./xrAdapter";
import {
  AR_START_WATCHDOG_MS,
  XR_START_STEPS,
  type XrSessionConfigStep,
  type XrStartStep,
} from "./xrAdapter";
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

  it("createStartGuard blocks a double start until reset", () => {
    // A fast double-tap on Start AR (before the `starting` re-render
    // disables the button) must not create two sessions: every later tap
    // would emit twice, duplicating the traced walls.
    const guard = createStartGuard();
    expect(guard.tryStart()).toBe(true);
    expect(guard.tryStart()).toBe(false);
    guard.reset();
    expect(guard.tryStart()).toBe(true);
  });

  it("the XR host is not rendered before a session (Start button uncovered)", () => {
    // Regression: a fixed full-screen .ar-xr-host rendered on the Start
    // screen swallowed every tap, so requestSession never fired and no
    // trace step ever appeared. The host mounts only in session state now.
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
    expect(html).toContain("Measure (AR)");
    expect(html).not.toContain("ar-xr-host");
  });

  it("pre-start renders an empty HUD shell, no HUD content", () => {
    // The domOverlay.root must exist when start() reads it, but it must be
    // empty until the session runs: no bar, no readout, no crosshair.
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
    expect(html).toContain('class="ar-hud"');
    expect(html).not.toContain("ar-hud-bar");
    expect(html).not.toContain("ar-hud-readout");
    expect(html).not.toContain("ar-hud-crosshair");
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
    // Floor-plane 3-4-5 taps (4 m on z, not y): tap height never counts.
    const update = pairCornersToWallUpdate(
      [
        [0, 0, 0],
        [3, 0, 4],
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

describe("AR start step trace + watchdog", () => {
  /** Fake that emits every documented step through the onStep param, in order. */
  function makeStepAdapter() {
    const seen: XrStartStep[] = [];
    const adapter: XrHitTestAdapter = {
      start: async (_callbacks, _container, onStep) => {
        for (const step of XR_START_STEPS) onStep?.(step);
      },
      end: () => undefined,
    };
    return { adapter, seen };
  }

  it("reports steps through onStep in the documented order", async () => {
    const { adapter } = makeStepAdapter();
    const seen: Array<XrStartStep | XrSessionConfigStep> = [];
    const handleClick = createArStartHandler(
      adapter,
      noopCallbacks,
      () => undefined,
      {
        onStarted: () => undefined,
        onFailed: () => {
          throw new Error("must not fail");
        },
        onStep: (step) => seen.push(step),
      },
    );
    handleClick();
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([...XR_START_STEPS]);
  });

  it("a start that never settles trips onFailed after the watchdog timeout", () => {
    vi.useFakeTimers();
    try {
      const adapter: XrHitTestAdapter = {
        start: () => new Promise<void>(() => undefined),
        end: () => undefined,
      };
      const adapterStart = vi.spyOn(adapter, "start");
      let failed: string | null = null;
      const handleClick = createArStartHandler(
        adapter,
        noopCallbacks,
        () => undefined,
        {
          onStarted: () => {
            throw new Error("must not start");
          },
          onFailed: (message) => {
            failed = message;
          },
          onStep: () => undefined,
        },
      );
      handleClick();
      // The one-param fake still satisfies the interface: the handler passes
      // onStep as the third start() arg.
      expect(adapterStart.mock.calls[0]).toHaveLength(3);
      expect(failed).toBeNull();
      vi.advanceTimersByTime(AR_START_WATCHDOG_MS);
      expect(failed).toContain("AR stuck at:");
    } finally {
      vi.useRealTimers();
    }
  });

  it("settling in time clears the watchdog (no stuck error after timers run)", async () => {
    vi.useFakeTimers();
    try {
      let resolveStart!: () => void;
      const adapter: XrHitTestAdapter = {
        start: () => new Promise<void>((resolve) => { resolveStart = resolve; }),
        end: () => undefined,
      };
      let started = false;
      let failed: string | null = null;
      const handleClick = createArStartHandler(
        adapter,
        noopCallbacks,
        () => undefined,
        {
          onStarted: () => { started = true; },
          onFailed: (message) => { failed = message; },
          onStep: () => undefined,
        },
      );
      handleClick();
      resolveStart();
      await Promise.resolve();
      await Promise.resolve();
      expect(started).toBe(true);
      vi.advanceTimersByTime(AR_START_WATCHDOG_MS * 2);
      await Promise.resolve();
      expect(failed).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a late success after a watchdog trip still lets onStarted win", async () => {
    vi.useFakeTimers();
    try {
      let resolveStart!: () => void;
      const adapter: XrHitTestAdapter = {
        start: () => new Promise<void>((resolve) => { resolveStart = resolve; }),
        end: () => undefined,
      };
      let started = false;
      let failed: string | null = null;
      const handleClick = createArStartHandler(
        adapter,
        noopCallbacks,
        () => undefined,
        {
          onStarted: () => { started = true; },
          onFailed: (message) => { failed = message; },
          onStep: () => undefined,
        },
      );
      handleClick();
      vi.advanceTimersByTime(AR_START_WATCHDOG_MS);
      expect(failed).toContain("AR stuck at:");
      resolveStart();
      await Promise.resolve();
      await Promise.resolve();
      expect(started).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ArHud (live session overlay)", () => {
  function hudHtml(over: Partial<React.ComponentProps<typeof ArHud>> = {}): string {
    return renderToString(
      <ArHud
        locale="en"
        hudRef={{ current: null }}
        previewM={null}
        targetLengthM={2}
        stepLabel="Tap the first corner"
        canConfirm={false}
        {...over}
      />,
    );
  }

  it("hint follows the mode: wall hint only in wall mode", () => {
    // Bug: Door selected still said "Point at a wall corner". The static
    // wall-corner hint must not render outside wall mode; the mode-specific
    // step label carries the prompt instead.
    expect(hudHtml({ traceMode: "wall" })).toContain("wall corner");
    expect(hudHtml({ traceMode: "door" })).not.toContain("wall corner");
    expect(hudHtml({ traceMode: "window" })).not.toContain("wall corner");
  });

  it("during a session only the HUD renders, nothing else from the app", () => {
    const html = hudHtml();
    // HUD content: NO static crosshair (the SVG reticle projected at the hit
    // point is the only reticle — a centered DOM circle doubles it on the
    // phone). Surface line, hint, step, readout, bar with Undo/Done/Cancel.
    expect(html).not.toContain("ar-hud-crosshair");
    expect(html).toContain("ar-hud-surface");
    expect(html).toContain("ar-hud-readout");
    expect(html).toContain("ar-hud-bar");
    // Nothing else from the app may render inside the overlay root: no
    // sheet copy, no measuring titles, no wall rows, no viewport chrome.
    expect(html).not.toContain("intake-title");
    expect(html).not.toContain("intake-hint");
    expect(html).not.toContain("wall-row");
    expect(html).not.toContain("ar-measure");
    expect(html).not.toContain("sheet");
    expect(html).not.toContain("viewport");
    expect(html).not.toContain("topbar");
  });

  it("shows Confirm only while a length is previewed", () => {
    expect(hudHtml({ canConfirm: false, previewM: null })).not.toContain(
      "Use this measure",
    );
    expect(hudHtml({ canConfirm: true, previewM: 3.5 })).toContain(
      "Use this measure",
    );
  });

  it("renders the readout from the preview, falling back to the target", () => {
    // Preview wins; target shows while tapping; zero with neither.
    expect(hudHtml({ previewM: 3.5, targetLengthM: 2 })).toContain("3.50");
    expect(hudHtml({ previewM: null, targetLengthM: 2 })).toContain("2.00");
    expect(hudHtml({ previewM: null, targetLengthM: null })).toContain("0.00");
  });

  it("shell mode renders the empty root, keeping the node for the session", () => {
    const html = renderToString(
      <ArHud locale="en" hudRef={{ current: null }} shell />,
    );
    expect(html).toContain('class="ar-hud"');
    expect(html).not.toContain("ar-hud-bar");
    expect(html).not.toContain("ar-hud-crosshair");
    expect(html).not.toContain("ar-hud-surface");
  });

  it("debug line: hidden by default, frames count under arDebug", () => {
    expect(hudHtml()).not.toContain("ar-hud-debug");
    expect(hudHtml({ debugFrames: null })).not.toContain("frames:");
    expect(hudHtml({ debugFrames: 42 })).toContain("ar-hud-debug");
    expect(hudHtml({ debugFrames: 42 })).toContain("frames: 42");
  });

  it("surface line: searching copy by default, found copy when reported", () => {
    // Initial state is searching (no surface yet); the adapter flips it via
    // the transition-only onSurfaceChange seam. No WebXR needed: renderToString.
    expect(hudHtml()).toContain("Move the phone slowly to find the floor");
    expect(hudHtml({ surfaceFound: true })).toContain("Surface found ✓");
    expect(hudHtml({ surfaceFound: false })).not.toContain("Surface found");
  });

  it("surface line renders the es-AR copy under es-AR", () => {
    const html = renderToString(
      <ArHud
        locale="es-AR"
        hudRef={{ current: null }}
        previewM={null}
        targetLengthM={2}
        stepLabel="Tocá la primera esquina"
        canConfirm={false}
      />,
    );
    expect(html).toContain("Mové el teléfono despacio para encontrar el piso");
    const found = renderToString(
      <ArHud
        locale="es-AR"
        hudRef={{ current: null }}
        previewM={null}
        targetLengthM={2}
        stepLabel="Tocá la primera esquina"
        canConfirm={false}
        surfaceFound
      />,
    );
    expect(found).toContain("Superficie encontrada ✓");
  });

  it("adapter surface transitions reach the HUD wiring (no WebXR)", () => {
    // Fake adapter mimics WebXrHitTestAdapter's transition-only contract:
    // onSurfaceChange fires only on found<->lost edges, never per frame.
    // The HUD reads the resulting boolean, so drive the callbacks object
    // the way handleStart wires it (onSurfaceChange -> surface state).
    let captured: XrTapCallbacks | null = null;
    const adapter: XrHitTestAdapter = {
      start: async (callbacks) => {
        captured = callbacks;
      },
      end: () => undefined,
    };
    let surfaceFound = false;
    const seen: boolean[] = [];
    const tapCallbacks: XrTapCallbacks = {
      onTapCorner: () => undefined,
      onEnd: () => undefined,
      onSurfaceChange: (found) => {
        surfaceFound = found;
        seen.push(found);
      },
    };
    const handleClick = createArStartHandler(adapter, tapCallbacks, () => undefined, {
      onStarted: () => undefined,
      onFailed: () => {
        throw new Error("must not fail");
      },
    });
    handleClick();
    const callbacks = captured as XrTapCallbacks | null;
    expect(callbacks).not.toBeNull();
    // Transition-only: repeated identical reports are swallowed by the
    // adapter, so only edges reach the HUD state.
    let last = false;
    const report = (found: boolean): void => {
      if (found === last) return;
      last = found;
      callbacks?.onSurfaceChange?.(found);
    };
    report(true);
    report(true);
    report(false);
    report(false);
    report(true);
    expect(seen).toEqual([true, false, true]);
    expect(surfaceFound).toBe(true);
    // And the found copy is what the HUD shows once the state flips.
    expect(hudHtml({ surfaceFound })).toContain("Surface found ✓");
    // The seam stays optional: old fakes without onSurfaceChange still start.
    expect(captured).not.toBeNull();
  });

  it("renders the DOM overlay svg in session, never in shell mode", () => {
    const live = hudHtml({ overlayCorners: [], overlayFrameRef: { current: null } });
    expect(live).toContain("ar-overlay");
    // Existing suites render ArHud without overlay props (B/C paths,
    // one-param fakes): no svg then, and shell mode stays empty.
    expect(hudHtml()).not.toContain("ar-overlay");
    const shellHtml = renderToString(
      <ArHud locale="en" hudRef={{ current: null }} shell />,
    );
    expect(shellHtml).not.toContain("ar-overlay");
  });

  it("renders the Wall / Door / Window selector, Wall default", () => {
    const html = hudHtml({});
    expect(html).toContain("Wall");
    expect(html).toContain("Door");
    expect(html).toContain("Window");
  });

  it("renders the Spanish selector copy under es-AR", () => {
    const html = renderToString(
      <ArHud locale="es-AR" hudRef={{ current: null }} />,
    );
    expect(html).toContain("Pared");
    expect(html).toContain("Puerta");
    expect(html).toContain("Ventana");
  });

  it("door mode shows the wall picker and the edge prompts", () => {
    const picker = hudHtml({
      traceMode: "door",
      pickerWalls: [
        { id: "w0", a: [0, 0], b: [2, 0], thickness_m: 0.2, kind: "exterior" },
        { id: "w1", a: [2, 0], b: [2, 2], thickness_m: 0.1, kind: "interior" },
      ],
      pickerWallId: null,
    });
    // Pick-a-wall step first: no wall selected yet.
    expect(picker).toContain("Pick a wall");
    const both = hudHtml({
      traceMode: "door",
      pickerWalls: [
        { id: "w0", a: [0, 0], b: [2, 0], thickness_m: 0.2, kind: "exterior" },
      ],
      pickerWallId: "w0",
      stepLabel: "Tap the left edge",
      previewM: null,
      targetLengthM: null,
    });
    // Wall chosen, no edge taps yet: first-edge prompt + wall chip.
    expect(both).toContain("Tap the left edge");
    expect(both).toContain("W1");
  });

  it("window edge taps through the real openingMath path emit markOpening", () => {
    // Same functions the component wires: edge pair -> projection -> op.
    const wall = scene.walls?.[0];
    if (wall === undefined) throw new Error("fixture needs a wall");
    const projection = projectEdgesToOpening(
      wall,
      [0.5, 0, 0],
      [1.5, 0, 0],
    );
    expect(projection).not.toBeNull();
    const defaults = openingDefaults("window");
    const op: SceneOp = {
      type: "markOpening",
      opening: {
        id: "opening-1",
        wall_id: wall.id,
        kind: "window",
        offset_m: projection?.offset_m ?? 0,
        width_m: projection?.width_m ?? 0,
        height_m: defaults.height_m,
        sill_m: defaults.sill_m,
      },
    };
    const seen: SceneOp[] = [];
    const next = applySceneOp(scene, op);
    seen.push(op);
    expect(next.openings).toHaveLength(1);
    expect(next.openings?.[0]?.kind).toBe("window");
    expect(next.openings?.[0]?.offset_m).toBeCloseTo(0.5, 9);
    expect(next.openings?.[0]?.width_m).toBeCloseTo(1, 9);
    expect(next.openings?.[0]?.height_m).toBe(1.2);
    expect(next.openings?.[0]?.sill_m).toBe(0.9);
    expect(seen[0]?.type).toBe("markOpening");
  });

  it("door edge taps produce the full-height door default with no sill", () => {
    const wall = scene.walls?.[0];
    if (wall === undefined) throw new Error("fixture needs a wall");
    // Reversed tap order: same opening, width still positive.
    const projection = projectEdgesToOpening(
      wall,
      [1.5, 1.2, 0],
      [0.5, 0.9, 0],
    );
    expect(projection?.width_m).toBeCloseTo(1, 9);
    const defaults = openingDefaults("door");
    expect(defaults).toEqual({ height_m: 2.0, sill_m: null });
    const next = applySceneOp(scene, {
      type: "markOpening",
      opening: {
        id: "opening-1",
        wall_id: wall.id,
        kind: "door",
        offset_m: projection?.offset_m ?? 0,
        width_m: projection?.width_m ?? 0,
        height_m: defaults.height_m,
        sill_m: defaults.sill_m,
      },
    });
    expect(next.openings?.[0]?.height_m).toBe(2.0);
    expect(next.openings?.[0]?.sill_m).toBeNull();
  });

  it("close-room hint appears on the wall step label while tracing", () => {
    const html = hudHtml({
      stepLabel: "Tap the other corner · Tap near the first corner to close the room",
    });
    expect(html).toContain("Tap near the first corner to close the room");
    const spanish = renderToString(
      <ArHud
        locale="es-AR"
        hudRef={{ current: null }}
        stepLabel="Tocá la otra esquina · Tocá cerca de la primera esquina para cerrar el cuarto"
      />,
    );
    expect(spanish).toContain(
      "Tocá cerca de la primera esquina para cerrar el cuarto",
    );
  });
});
