import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import {
  ArHud,
  ArMeasure,
  createArStartHandler,
  createStartGuard,
  openingFailureKey,
  resolveOpeningTap,
  startErrorMessage,
} from "./ArMeasure";
import { applySceneOp, createEmptyScene } from "../scene/store";
import { pairCornersToWallUpdate, traceCornerTap, emptyCornerTrace } from "./cornerMath";
import {
  openingDefaults,
  openingHeightFromTopTap,
  openingSillFromEdgeTap,
  projectEdgesToOpening,
} from "./openingMath";
import { getStrings } from "../i18n";
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

  it("pill carries the step copy in every mode: no separate wall hint line", () => {
    // Step 6: the static wall-corner hint line is gone — the pill shows the
    // mode-specific step copy + live length in every mode.
    for (const traceMode of ["wall", "door", "window"] as const) {
      const html = hudHtml({ traceMode });
      expect(html).toContain("Tap the first corner");
      expect(html).not.toContain("ar-hud-hint");
    }
    expect(hudHtml({ traceMode: "wall" })).not.toContain("wall corner");
  });

  it("HUD is one top pill + SVG + bottom bar: no centered readout, no opaque middle", () => {
    // Step 6 restructure: a single top step pill carries the step copy AND
    // the live length (no separate hint/step/readout lines stacking over the
    // camera feed). The big centered readout is gone — lengths live in the
    // pill and the SVG edge/band labels.
    const html = hudHtml({ previewM: 3.5, targetLengthM: 2 });
    expect(html).toContain("ar-hud-pill");
    expect(html).toContain("Tap the first corner");
    expect(html).toContain("3.50");
    expect(html).not.toContain("ar-hud-readout");
    expect(html).not.toContain("ar-hud-hint");
    expect(html).not.toContain("ar-hud-step");
    // The mode selector lives in the bottom bar (thumb zone), not mid-screen.
    expect(html).not.toContain("ar-hud-modes");
  });

  it("bottom bar holds modes + Undo/Done/Cancel in the thumb zone", () => {
    const html = hudHtml({});
    expect(html).toContain("ar-hud-bar");
    expect(html).toContain("Wall");
    expect(html).toContain("Door");
    expect(html).toContain("Undo");
    // Confirm still only while a length is previewed.
    expect(hudHtml({ canConfirm: false })).not.toContain("Use this measure");
    expect(hudHtml({ canConfirm: true, previewM: 3.5 })).toContain(
      "Use this measure",
    );
  });

  it("surface searching copy merges into the pill when the floor is found", () => {
    // One pill, one status: searching shows the search line, found shows the
    // step copy. No separate surface line competing mid-screen.
    expect(hudHtml({ surfaceFound: false })).toContain(
      "Move the phone slowly to find the floor",
    );
    const found = hudHtml({ surfaceFound: true });
    expect(found).not.toContain("Move the phone slowly");
    expect(found).toContain("Tap the first corner");
    expect(found).not.toContain("ar-hud-surface");
  });

  it("during a session only the HUD renders, nothing else from the app", () => {
    const html = hudHtml();
    // HUD content: NO static crosshair (the SVG reticle projected at the hit
    // point is the only reticle — a centered DOM circle doubles it on the
    // phone). Single pill, SVG overlay, bottom bar with Undo/Done/Cancel.
    expect(html).not.toContain("ar-hud-crosshair");
    expect(html).toContain("ar-hud-pill");
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

  it("surface state lives in the pill: searching prefix until the floor is found", () => {
    // Initial state is searching (no surface yet); the adapter flips it via
    // the transition-only onSurfaceChange seam. No WebXR needed: renderToString.
    // Searching pill carries the search copy; found pill carries only the
    // step copy + length — no separate surface line, no found copy.
    const searching = hudHtml({ surfaceFound: false });
    expect(searching).toContain("Move the phone slowly to find the floor");
    expect(searching).toContain("Tap the first corner");
    expect(searching).not.toContain("ar-hud-surface");
    const found = hudHtml({ surfaceFound: true });
    expect(found).not.toContain("Move the phone slowly");
    expect(found).toContain("Tap the first corner");
    expect(found).not.toContain("ar-hud-surface");
  });

  it("searching copy renders the es-AR copy under es-AR", () => {
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
    expect(html).toContain("Tocá la primera esquina");
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
    expect(found).toContain("Tocá la primera esquina");
    expect(found).not.toContain("Mové el teléfono despacio");
    expect(found).not.toContain("ar-hud-surface");
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
    // And the pill is what the HUD shows once the state flips: step copy +
    // length, no search copy, no separate surface line.
    expect(hudHtml({ surfaceFound })).toContain("Tap the first corner");
    expect(hudHtml({ surfaceFound })).not.toContain("Move the phone slowly");
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

  it("door mode snaps to the nearest wall: no picker UI, no W chips", () => {
    const html = hudHtml({ traceMode: "door" });
    expect(html).not.toContain("ar-hud-walls");
    expect(html).not.toContain("Pick a wall");
    expect(html).not.toContain("W1");
    const spanish = renderToString(
      <ArHud locale="es-AR" hudRef={{ current: null }} traceMode="door" />,
    );
    expect(spanish).not.toContain("ar-hud-walls");
    expect(spanish).not.toContain("Elegí una pared");
  });

  it("re-tap-closer selects the right wall: snap is per-tap, not per-picker", () => {
    const twoWalls: Scene = {
      ...scene,
      walls: [
        { id: "wall-1", a: [0, 0], b: [4, 0], thickness_m: 0.1, kind: "interior", provenance: "measured_ar" },
        { id: "wall-2", a: [4, 0], b: [4, 3], thickness_m: 0.1, kind: "interior", provenance: "measured_ar" },
      ],
    };
    // First tap near wall-2 snaps there even with wall-1 traced first.
    const second = resolveOpeningTap({
      scene: twoWalls,
      kind: "door",
      edges: [
        [4, 0, -1],
        [4, 0, -2],
      ],
    });
    expect(second.op?.type).toBe("markOpening");
    if (second.op?.type === "markOpening") {
      expect(second.op.opening.wall_id).toBe("wall-2");
    }
    // Re-tap closer to wall-1: the snap follows the taps, no picker override.
    const retap = resolveOpeningTap({
      scene: twoWalls,
      kind: "door",
      edges: [
        [1, 0, 0],
        [2, 0, 0],
      ],
    });
    expect(retap.op?.type).toBe("markOpening");
    if (retap.op?.type === "markOpening") {
      expect(retap.op.opening.wall_id).toBe("wall-1");
    }
  });

  it("3-tap window: height comes from the top tap, sill from the first edge", () => {
    const t = getStrings("en");
    const floorY = 0.05;
    const edge1: Vec3 = [0.5, 0.95, 0];
    const height_m = openingHeightFromTopTap(floorY, 2.15);
    const sill_m = openingSillFromEdgeTap(floorY, edge1[1], "window");
    expect(height_m).toBeCloseTo(2.1, 9);
    expect(sill_m).toBeCloseTo(0.9, 9);
    expect(t["measure.ar.topFirst"]).toBeDefined();
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

  it("resolveOpeningTap routes the opening through buildOpening + defaults fallback", () => {
    // Snap-only: resolveOpeningTap always snaps via nearestWallToTap on the
    // first edge tap — the deleted wallId override parameter is gone.
    const next = resolveOpeningTap({
      scene,
      kind: "window",
      edges: [
        [0.5, 0, 0],
        [1.5, 0, 0],
      ],
    });
    expect(next.op?.type).toBe("markOpening");
    if (next.op?.type === "markOpening") {
      expect(next.op.opening.wall_id).toBe("w0");
      expect(next.op.opening.id).toBe("opening-1");
      expect(next.op.opening.width_m).toBeCloseTo(1, 9);
    }
  });

  it("resolveOpeningTap auto-snaps to the just-traced wall, no picker needed", () => {
    const twoWalls: Scene = {
      ...scene,
      walls: [
        { id: "wall-1", a: [0, 0], b: [4, 0], thickness_m: 0.1, kind: "interior", provenance: "measured_ar" },
        { id: "wall-2", a: [4, 0], b: [4, 3], thickness_m: 0.1, kind: "interior", provenance: "measured_ar" },
      ],
    };
    const next = resolveOpeningTap({
      scene: twoWalls,
      kind: "door",
      edges: [
        [4, 0, -1],
        [4, 0, -2],
      ],
    });
    expect(next.op?.type).toBe("markOpening");
    if (next.op?.type === "markOpening") {
      expect(next.op.opening.wall_id).toBe("wall-2");
    }
  });

  it("resolveOpeningTap with explicit dims emits measured height/sill, not defaults", () => {
    // 3-tap flow: the top tap fixes height, the first edge tap fixes the
    // sill. The en/es-AR topFirst copy is what the HUD shows while waiting.
    const next = resolveOpeningTap({
      scene,
      kind: "window",
      edges: [
        [0.5, 0.95, 0],
        [1.5, 0.95, 0],
      ],
      dims: { height_m: 2.1, sill_m: 0.9 },
    });
    expect(next.op?.type).toBe("markOpening");
    if (next.op?.type === "markOpening") {
      expect(next.op.opening.height_m).toBeCloseTo(2.1, 9);
      expect(next.op.opening.sill_m).toBeCloseTo(0.9, 9);
    }
    expect(getStrings("en")["measure.ar.topFirst"]).toBeDefined();
    expect(getStrings("es-AR")["measure.ar.topFirst"]).toBeDefined();
  });

  it("resolveOpeningTap for a door emits height with a null sill", () => {
    const next = resolveOpeningTap({
      scene,
      kind: "door",
      edges: [
        [0.5, 0, 0],
        [1.5, 0, 0],
      ],
      dims: { height_m: 2.05, sill_m: null },
    });
    expect(next.op?.type).toBe("markOpening");
    if (next.op?.type === "markOpening") {
      expect(next.op.opening.height_m).toBeCloseTo(2.05, 9);
      expect(next.op.opening.sill_m).toBeNull();
    }
  });

  it("opening failures surface dictionary keys, not nulls", () => {
    // narrow door (0.1 m < 0.8 m server minimum): the HUD must say WHY.
    const narrow = resolveOpeningTap({
      scene,
      kind: "door",
      edges: [
        [0.5, 0, 0],
        [0.6, 0, 0],
      ],
    });
    expect(narrow.op).toBeNull();
    expect(narrow.failure).toBe("door-narrow");
    expect(openingFailureKey("door-narrow")).toBe("measure.ar.opening.doorNarrow");
    // degenerate pair: same tap twice.
    const tap: Vec3 = [1, 0, 0];
    const degenerate = resolveOpeningTap({
      scene,
      kind: "window",
      edges: [tap, tap],
    });
    expect(degenerate.op).toBeNull();
    expect(openingFailureKey(degenerate.failure)).toBe(
      "measure.ar.opening.degenerate",
    );
    // no walls at all: nothing to snap to.
    const empty = resolveOpeningTap({
      scene: createEmptyScene(),
      kind: "window",
      edges: [
        [0.5, 0, 0],
        [1.5, 0, 0],
      ],
    });
    expect(empty.op).toBeNull();
    expect(openingFailureKey(empty.failure)).toBe("measure.ar.opening.noWalls");
    // non-finite edge tap: degenerate, not unknown-wall (the snap cannot
    // run on a bad tap, but the taps — not the wall — are at fault).
    const invalid = resolveOpeningTap({
      scene,
      kind: "window",
      edges: [
        [NaN, 0, 0],
        [1.5, 0, 0],
      ],
    });
    expect(invalid.op).toBeNull();
    expect(invalid.failure).toBe("degenerate");
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
