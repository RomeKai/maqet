import { useEffect, useRef, useState } from "react";
import type { Scene } from "../scene/types";
import {
  allWallsMeasured,
  applySceneOp,
  wallDisplayLengthM,
  type SceneOp,
} from "../scene/store";
import { getStrings, type Locale, type StringKey } from "../i18n";
import { formatMeasureM } from "../intake/ScaleTool";
import {
  emptyCornerTrace,
  heightFromCeilingTap,
  isValidCorner,
  traceCornerTap,
  pairCornersToWallUpdate,
  type CornerTrace,
  type Vec3,
} from "./cornerMath";
import {
  buildOpening,
  nearestWallToTap,
  nextOpeningId,
  openingHeightFromTopTap,
  openingSillFromEdgeTap,
  type OpeningDims,
  type OpeningFailure,
} from "./openingMath";
import {
  AR_START_WATCHDOG_MS,
  isARSupported,
  isArDebugEnabled,
  WebXrHitTestAdapter,
  type OverlayFrame,
  type XrHitTestAdapter,
  type XrSessionConfigStep,
  type XrStartStep,
  type XrTapCallbacks,
} from "./xrAdapter";
import { ArOverlay, type OverlayFrameRef } from "./ArOverlay";

/** A start step or the recorded session-config outcome. */
type ArTraceStep = XrStartStep | XrSessionConfigStep;

/**
 * Formats an adapter.start() rejection for the UI as "name: message" so the
 * technician sees the REAL reason (e.g. NotAllowedError when Chrome got no
 * user gesture). The "unsupported" copy is never used for this path:
 * detection already passed when start() runs. Exported for tests.
 */
export function startErrorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * Starts an XR session from a user gesture. Thin wrapper so the click path
 * is unit-testable: the component calls the returned handler synchronously
 * inside onClick (no await before it) so Chrome counts requestSession as
 * gesture-driven. Exported for tests.
 */
export interface ArStartOutcome {
  onStarted: () => void;
  onFailed: (message: string) => void;
  /** Receives each XR start step in order (diagnostic trace). */
  onStep?: (step: ArTraceStep) => void;
  /** Builds the watchdog message; defaults to English for locale-free tests. */
  stuckMessage?: (step: ArTraceStep | null) => string;
}

function defaultStuckMessage(step: ArTraceStep | null): string {
  return `AR stuck at: ${step ?? "?"}`;
}

/**
 * Re-entrancy guard for AR session start. A fast double-tap on Start AR
 * (before the `starting` re-render disables the button) would otherwise
 * create TWO live sessions, and every later tap would emit TWICE —
 * duplicated overlapping walls from a single trace. The guard is a tiny
 * pure object so it stays unit-testable without DOM clicks; the component
 * resets it on failure and on session end so re-tap keeps working.
 */
export function createStartGuard(): {
  tryStart: () => boolean;
  reset: () => void;
} {
  let started = false;
  return {
    tryStart: (): boolean => {
      if (started) return false;
      started = true;
      return true;
    },
    reset: (): void => {
      started = false;
    },
  };
}

/**
 * Failure -> dictionary key for the HUD step line, so a dropped opening says
 * WHY the taps missed instead of silently keeping the first edge. The
 * `unknown-wall` key reuses the "that wall is gone" copy (a picked wall that
 * vanished is the same situation to the technician). Exported for tests.
 */
export function openingFailureKey(failure: OpeningFailure | null): StringKey {
  switch (failure) {
    case "door-narrow":
      return "measure.ar.opening.doorNarrow";
    case "degenerate":
      return "measure.ar.opening.degenerate";
    case "no-fit":
      return "measure.ar.opening.noFit";
    case "unknown-wall":
      return "measure.ar.opening.unknownWall";
    case "no-walls":
    case null:
      return "measure.ar.opening.noWalls";
  }
}

/** Input for resolveOpeningTap: two edge taps snapped to the nearest wall. */
export interface OpeningTapInput {
  scene: Scene;
  kind: "door" | "window";
  edges: [Vec3, Vec3];
  /** Measured dims from the 3-tap flow; without them the Done fallback defaults apply. */
  dims?: OpeningDims;
}

/** Either a markOpening op, or the failure reason to surface in the HUD. */
export interface OpeningTapResult {
  op: SceneOp | null;
  failure: OpeningFailure | null;
}

/**
 * Route two AR edge taps through the single openingMath implementation
 * (snap -> buildOpening -> stable id). ALWAYS snaps: the first edge tap goes
 * to the nearest traced wall, so door/window taps land without a W<n> chip.
 * If the taps land on the wrong wall, the tech re-taps closer to the right
 * wall — that is the documented behavior, not a picker override. Returns the
 * markOpening op, or the failure reason for the HUD step line. Exported for
 * tests.
 */
export function resolveOpeningTap(input: OpeningTapInput): OpeningTapResult {
  const walls = input.scene.walls ?? [];
  // A non-finite edge is never a wall-pick problem: the taps themselves are
  // bad, and buildOpening reports "degenerate" for them.
  if (!isValidCorner(input.edges[0]) || !isValidCorner(input.edges[1])) {
    return { op: null, failure: "degenerate" };
  }
  const wallId = nearestWallToTap(walls, input.edges[0])?.id ?? null;
  if (wallId === null) {
    return {
      op: null,
      failure: walls.length === 0 ? "no-walls" : "unknown-wall",
    };
  }
  const id = nextOpeningId(input.scene.openings ?? []);
  const result = buildOpening(
    walls,
    id,
    input.kind,
    wallId,
    input.edges[0],
    input.edges[1],
    input.dims,
  );
  if ("failure" in result) return { op: null, failure: result.failure };
  return { op: { type: "markOpening", opening: result.opening }, failure: null };
}

export function createArStartHandler(
  active: XrHitTestAdapter,
  callbacks: XrTapCallbacks,
  getContainer: () => HTMLElement | undefined,
  outcome: ArStartOutcome,
): () => void {
  return () => {
    let lastStep: ArTraceStep | null = null;
    const reportStep = (step: ArTraceStep): void => {
      lastStep = step;
      outcome.onStep?.(step);
    };
    let started: Promise<void>;
    try {
      // Third arg is optional: one-param fakes ignore it and still
      // satisfy the XrHitTestAdapter interface.
      started = active.start(callbacks, getContainer(), reportStep);
    } catch (error: unknown) {
      started = Promise.reject(error);
    }
    // Watchdog: a wedged await inside start() shows no camera and no
    // error on the phone. Trip onFailed with the last reported step.
    // A late settle still runs its own path: a late success lets
    // onStarted win (session state overwrites the stuck error), a late
    // rejection overwrites it with the real error.
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      outcome.onFailed((outcome.stuckMessage ?? defaultStuckMessage)(lastStep));
    }, AR_START_WATCHDOG_MS);
    void started.then(
      () => {
        settled = true;
        clearTimeout(timer);
        outcome.onStarted();
      },
      (error: unknown) => {
        settled = true;
        clearTimeout(timer);
        active.end();
        outcome.onFailed(startErrorMessage(error));
      },
    );
  };
}

interface ArMeasureProps {
  locale: Locale;
  scene: Scene;
  /** Wall under measure; defaults to the first wall needing a measure. */
  wallId?: string;
  /** Adapter seam (fake in tests, WebXR in production). */
  adapter?: XrHitTestAdapter;
  onChange: (scene: Scene, op: SceneOp) => void;
  onDone: (scene: Scene) => void;
  onCancel: () => void;
  /** Fired when the XR session starts/ends so the app can hide/restore chrome. */
  onSessionChange?: (active: boolean) => void;
  /** Fallback actions: B = room photo + tapped lengths, C = sketch measures. */
  onFallbackB?: () => void;
  onFallbackC?: () => void;
}

/** Guided AR HUD tracing mode: walls, room height, or openings. */
export type ArHudMode = "wall" | "height" | "door" | "window";

interface ArHudProps {
  locale: Locale;
  /** Ref to the HUD root: the dedicated domOverlay.root while live. */
  hudRef: { current: HTMLDivElement | null };
  /** Live frame from the adapter's onOverlayFrame (plain assignment, never state). */
  overlayFrameRef?: OverlayFrameRef;
  /** Corners tapped this session, drawn as SVG dots + edges by ArOverlay. */
  overlayCorners?: Vec3[];
  /**
   * Shell mode: renders the empty transparent element only. Every branch
   * renders ArHud (shell or full) at the same tree position so React keeps
   * the DOM node across the ar-ready -> starting -> session transitions —
   * the overlay root is captured at start() time and a replaced node would
   * leave the overlay empty. Content props are ignored in shell mode.
   */
  shell?: boolean;
  /** Length preview, or null while tapping. */
  previewM?: number | null;
  /** Wall still needing a measure (its current length shows), or null. */
  targetLengthM?: number | null;
  /** Step prompt: tap-first / tap-second. */
  stepLabel?: string;
  /** Hit-test presence: false = still searching (initial), true = floor seen. */
  surfaceFound?: boolean;
  /**
   * Debug frame count from the adapter's onDebugFrame (arDebug only).
   * Null hides the debug line: the HUD never renders it in normal sessions.
   */
  debugFrames?: number | null;
  canConfirm?: boolean;
  /** Active tracing mode + setter for the Wall / Door / Window selector. */
  traceMode?: ArHudMode;
  onTraceModeChange?: (mode: ArHudMode) => void;
  onConfirm?: () => void;
  onReset?: () => void;
  onEnd?: () => void;
  onCancel?: () => void;
}

/**
 * Dedicated AR HUD: the ONLY app content rendered while the XR session runs,
 * and the domOverlay.root passed to requestSession. Transparent full-screen
 * root (the camera shows through), one top pill (status + step + live
 * length), the SVG overlay (ArOverlay: reticle, corners, edges, band), and a
 * small bottom bar with its own semi-opaque background holding the mode
 * selector (Wall / Height / Door / Window) plus Undo / Done / Cancel (and
 * Confirm while a length is previewed — wall-target mode needs it to emit
 * the setWallLength op). Shell mode renders the empty element so
 * the overlay root exists (and keeps its DOM node) before the session
 * starts. Exported for tests.
 */
function noopArHudAction(): void {}
function noopArHudModeChange(_mode: ArHudMode): void {}
const HUD_MODES: ArHudMode[] = ["wall", "height", "door", "window"];
function hudModeKey(mode: ArHudMode): `measure.ar.mode.${ArHudMode}` {
  return `measure.ar.mode.${mode}`;
}
export function ArHud({
  locale,
  hudRef,
  overlayFrameRef,
  overlayCorners,
  shell = false,
  previewM = null,
  targetLengthM = null,
  stepLabel = "",
  surfaceFound = false,
  debugFrames = null,
  canConfirm = false,
  traceMode = "wall",
  onTraceModeChange = noopArHudModeChange,
  onConfirm = noopArHudAction,
  onReset = noopArHudAction,
  onEnd = noopArHudAction,
  onCancel = noopArHudAction,
}: ArHudProps): React.JSX.Element {
  const t = getStrings(locale);
  if (shell) {
    return <div ref={hudRef} className="ar-hud" aria-hidden="true" />;
  }
  const shownM = previewM ?? targetLengthM ?? 0;
  // One pill, one status (Step 6): while the floor is still missing the pill
  // shows the searching copy alongside the step + live length; once found it
  // shows the step + length. No separate surface/hint/step/readout lines
  // stacking over the camera feed — lengths live in the pill and the SVG
  // edge/band labels.
  const pill = surfaceFound
    ? `${stepLabel} · ${formatMeasureM(locale, shownM)}`
    : `${t["measure.ar.surface.searching"]} · ${stepLabel} · ${formatMeasureM(locale, shownM)}`;
  return (
    <div ref={hudRef} className="ar-hud" role="dialog" aria-label={t["measure.ar.title"]}>
      {overlayFrameRef !== undefined && overlayCorners !== undefined && (
        <ArOverlay
          frameRef={overlayFrameRef}
          corners={overlayCorners}
          locale={locale}
        />
      )}
      {/* No static DOM crosshair: the SVG reticle projected at the hit point
          (ArOverlay) is the only reticle — a centered circle doubles it. */}
      <p className="ar-hud-pill" role="status">
        {pill}
      </p>
      {debugFrames !== null && (
        <p className="ar-hud-debug" role="status">
          {`frames: ${debugFrames}`}
        </p>
      )}
      <div className="ar-hud-bar">
        <span className="ar-hud-bar-modes" role="group" aria-label={t["measure.ar.title"]}>
          {HUD_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`chip${traceMode === mode ? " chip-active" : ""}`}
              onClick={() => onTraceModeChange(mode)}
            >
              {t[hudModeKey(mode)]}
            </button>
          ))}
        </span>
        {canConfirm && (
          <button type="button" className="btn-primary" onClick={onConfirm}>
            {t["measure.ar.confirm"]}
          </button>
        )}
        <button type="button" className="chip" onClick={onReset}>
          {t["intake.undo"]}
        </button>
        <button type="button" className="chip" onClick={onEnd}>
          {t["measure.ar.done"]}
        </button>
        <button type="button" className="chip" onClick={onCancel}>
          {t["measure.ar.cancel"]}
        </button>
      </div>
    </div>
  );
}

/**
 * Mode A AR measure (P0, ADR-025): tap two corners, preview the length,
 * confirm to emit a `setWallLength` op with `measured_ar` provenance.
 * Detection runs on mount and decides only whether to offer the Start AR
 * button; the XR session starts from the button's user gesture (Chrome
 * rejects requestSession without one). Unsupported devices get the B/C
 * fallback. Bottom-sheet style, tap targets >= 44px, safe-area aware,
 * preliminary label.
 */
export function ArMeasure({
  locale,
  scene,
  wallId,
  adapter,
  onChange,
  onDone,
  onCancel,
  onSessionChange,
  onFallbackB,
  onFallbackC,
}: ArMeasureProps) {
  const t = getStrings(locale);
  const walls = scene.walls ?? [];
  const target =
    walls.find((w) => w.id === wallId) ??
    walls.find((w) => w.provenance === undefined || w.provenance === "estimated") ??
    walls[0] ??
    null;

  // Detection decides ONLY whether the Start AR button is offered.
  // The XR session starts from the button tap (a user gesture): Chrome
  // rejects requestSession when called from a mount effect, so no start()
  // call may happen before the button exists. "ar-ready" = supported but
  // not started; "starting" = start() pending (button disabled, current
  // step shown); "session" = started (measuring UI); "failed" = start()
  // rejected or the watchdog tripped, showing the real error or the stuck
  // step; "unsupported" = detection said no.
  const [support, setSupport] = useState<
    "checking" | "ar-ready" | "starting" | "session" | "failed" | "unsupported"
  >(adapter ? "ar-ready" : "checking");
  const [startError, setStartError] = useState<string | null>(null);
  // Latest XR start step while pending (diagnostic line under the button).
  const [startStep, setStartStep] = useState<ArTraceStep | null>(null);
  // Ref mirror: the watchdog message reads the current step outside render.
  const startStepRef = useRef<ArTraceStep | null>(null);
  const [corners, setCorners] = useState<Vec3[]>([]);
  const [previewM, setPreviewM] = useState<number | null>(null);
  // Captured room height in meters (Height mode), shown in the step pill.
  const [roomHeightM, setRoomHeightM] = useState<number | null>(null);
  // Height-tap error (no corners yet, or out-of-range tap): rendered in the
  // step line until the next successful height tap clears it.
  const [heightError, setHeightError] = useState<string | null>(null);
  // Guided HUD tracing mode: walls (corner trace), height (ceiling tap), or
  // openings (tap two edges, then the top edge, emit markOpening).
  // Stays across rooms/confirmations: the tech traces several openings in a
  // row without re-selecting Door/Window. Resets only on explicit Undo.
  const [traceMode, setTraceMode] = useState<ArHudMode>("wall");
  const traceModeRef = useRef<ArHudMode>("wall");
  traceModeRef.current = traceMode;
  // Session floor datum for openings: the y of the FIRST floor corner tapped
  // this session — the same reference heightFromCeilingTap uses (its floorY).
  // Height mode plants corners but never updates this ref; it only serves the
  // opening flow. Null until the first wall/height tap: without a floor
  // reference the opening flow refuses (needCorners hint), never y=0.
  const floorYRef = useRef<number | null>(null);
  // Tap error in door/window mode: WHY the last edge pair was dropped
  // (narrow door, taps overlapping, taps off the wall). Shown in the step
  // line until the next successful opening clears it.
  const [openingError, setOpeningError] = useState<string | null>(null);
  // Surface presence from the adapter's onSurfaceChange (transition-only:
  // false = searching, the initial state until the first report). Passed to
  // ArHud as a prop so renderToString tests cover the wiring without WebXR.
  const [surfaceFound, setSurfaceFound] = useState(false);
  // Debug frame count (arDebug only): the adapter reports it throttled
  // (~2/s). One setState per report by construction, never 60/s.
  const [debugFrames, setDebugFrames] = useState<number | null>(null);
  const cornersRef = useRef<Vec3[]>([]);
  cornersRef.current = corners;
  // Live overlay frame: written by the adapter's onOverlayFrame callback via
  // plain assignment, never setState — ArOverlay's own rAF loop reads it and
  // writes SVG attributes directly, so React never re-renders at 60 fps.
  const overlayFrameRef = useRef<OverlayFrame | null>(null);
  // HUD root: the domOverlay.root while a session runs (see the session
  // branch below). Rendered as an empty transparent shell on the
  // Start/starting/failed screens so the element exists when start() reads
  // it in the gesture handler. The XR canvas is NOT hosted here: the
  // adapter appends it to document.body, outside the overlay root.
  const hudRef = useRef<HTMLDivElement | null>(null);
  // Latest onSessionChange (parent hides the sheet + 3D while active).
  const onSessionChangeRef = useRef(onSessionChange);
  onSessionChangeRef.current = onSessionChange;
  // Production adapter owned by this component when no test fake is injected.
  const prodAdapterRef = useRef<XrHitTestAdapter | null>(null);
  // Start re-entrancy guard: persists across renders (a ref, not state) so
  // the synchronous double-tap check works before any re-render lands.
  const startGuardRef = useRef(createStartGuard());
  // Adapter taps arrive through the start() subscription: keep a ref to
  // the latest scene so each tap emits its addWall onto current walls.
  const sceneRef = useRef<Scene>(scene);
  sceneRef.current = scene;
  // Wall ids emitted by this session's corner trace: Height mode applies the
  // tapped ceiling height to exactly these walls. Reset with the trace.
  const tracedWallIdsRef = useRef<string[]>([]);

  // Empty scene (no photo yet, ADR-025 Mode A entry): trace walls corner by
  // corner with stable incremental ids (wall-1, wall-2, ...). Each new tap
  // emits the wall ending at it from the previous corner immediately via
  // onChange + applySceneOp addWall; a tap within CLOSE_ROOM_M of the
  // first corner closes the loop.
  const isEmptyStart = target === null;
  const traceRef = useRef<CornerTrace>(emptyCornerTrace());

  // Detection on mount: decides only whether the Start AR button shows.
  // Never starts a session here — no user gesture exists yet.
  useEffect(() => {
    if (adapter) return;
    let cancelled = false;
    isARSupported().then((ok) => {
      if (cancelled) return;
      setSupport(ok ? "ar-ready" : "unsupported");
    });
    return () => {
      cancelled = true;
    };
    // Mount-only: adapter presence is a construction-time input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleStart(): void {
    // Runs SYNCHRONOUSLY inside the button onClick: no await (not even
    // detection) before adapter.start() so the browser counts it as the
    // user gesture that requestSession requires.
    // Double-tap guard: a second tap before the `starting` re-render lands
    // must not create a second session (every later tap would emit twice,
    // duplicating the traced walls). Reset on failure and on session end so
    // re-tap keeps working.
    if (!startGuardRef.current.tryStart()) return;
    const notify = onSessionChangeRef.current;
    const callbacks: XrTapCallbacks = {
      onTapCorner: (corner) => appendCorner(corner, target?.id ?? null),
      // Device End (or adapter teardown): leave the session state, restore
      // app chrome via the notify, back to the Start screen for re-tap.
      onEnd: () => {
        notify?.(false);
        if (adapter === undefined) prodAdapterRef.current = null;
        startGuardRef.current.reset();
        setSurfaceFound(false);
        setSupport("ar-ready");
      },
      // Transition-only from the adapter: one setState per surface event,
      // never per XR frame. Reset on every start so a re-tap begins searching.
      onSurfaceChange: (found) => {
        setSurfaceFound(found);
      },
      // Debug frame counter (arDebug only, adapter-side throttled ~2/s).
      // Reset on every start so a re-tap proves fresh frames, not stale ones.
      onDebugFrame: isArDebugEnabled() ? setDebugFrames : undefined,
      // Per-frame DOM-overlay payload: plain assignment into the frame ref,
      // never setState. ArOverlay's rAF loop reads it and projects the
      // SVG feedback itself.
      onOverlayFrame: (frame) => {
        overlayFrameRef.current = frame;
      },
    };
    const active = adapter ?? new WebXrHitTestAdapter();
    if (adapter === undefined) prodAdapterRef.current = active;
    startStepRef.current = null;
    setStartStep(null);
    setSurfaceFound(false);
    setDebugFrames(null);
    setSupport("starting");
    const onStarted = (): void => {
      notify?.(true);
      setSupport("session");
    };
    const onFailed = (message: string): void => {
      // Surface the REAL reason (e.g. NotAllowedError when the gesture
      // chain is broken) or the watchdog's stuck step — never the
      // "unsupported" copy: detection already passed, so this device
      // supports AR and something else failed.
      notify?.(false);
      if (adapter === undefined) prodAdapterRef.current = null;
      startGuardRef.current.reset();
      setStartError(message);
      setSupport("failed");
    };
    const onStep = (step: ArTraceStep): void => {
      startStepRef.current = step;
      setStartStep(step);
    };
    // The "AR stuck at: <step>" sentence comes from the dictionary; the
    // step id itself renders raw (same as the "err.name: message" style).
    const stuckMessage = (): string =>
      `${t["measure.ar.stuck"]} ${startStepRef.current ?? "?"}`;
    createArStartHandler(
      active,
      callbacks,
      // The HUD div (transparent, camera shows through); it is mounted as
      // an empty shell on the Start/starting screens so the element exists
      // when start() reads it in the gesture handler. The adapter moves the
      // canvas to document.body itself — the overlay root stays the HUD.
      () => (hudRef.current ?? undefined) as HTMLElement | undefined,
      { onStarted, onFailed, onStep, stuckMessage },
    )();
  }

  function handleTraceModeChange(mode: ArHudMode): void {
    setTraceMode(mode);
    // Pending corner taps belong to the old mode: drop them so a wall
    // trace never leaks into an opening (and vice versa). Height state
    // survives (it applies to the traced walls, not the pending taps), but a
    // stale height error clears on every mode switch.
    traceRef.current = emptyCornerTrace();
    setCorners([]);
    setPreviewM(null);
    setHeightError(null);
    setOpeningError(null);
  }

  /**
   * Door/Window mode, 3 taps: left edge, right edge (offset + width as today,
   * y ignored for plan), then a THIRD tap at the opening's top edge. Height
   * is topTap.y - floorY (session datum); windows take the sill from the
   * FIRST edge tap's y, doors run to the floor (sill null). Invalid third
   * taps wait (dims stay null) instead of emitting guessed geometry — the
   * same re-tap discipline as heightFromCeilingTap.
   */
  function appendOpeningTap(corner: Vec3, kind: "door" | "window"): void {
    const floorY = floorYRef.current;
    if (floorY === null) {
      // Same refusal as Height mode with no corners: no floor datum yet, so
      // refuse instead of silently using y=0.
      setOpeningError(t["measure.ar.height.needCorners"]);
      return;
    }
    const pending = cornersRef.current;
    if (pending.length < 2) {
      setCorners([...pending, corner]);
      return;
    }
    const first = pending[0] as Vec3;
    const second = pending[1] as Vec3;
    const edges: [Vec3, Vec3] = [first, second];
    const height_m = openingHeightFromTopTap(floorY, corner[1]);
    if (height_m === null) {
      // Keep waiting for a valid top tap: the invalid tap is dropped but the
      // two good edges stay pending (re-tap only the top).
      setOpeningError(t[openingFailureKey("degenerate")]);
      return;
    }
    const sill_m = openingSillFromEdgeTap(floorY, first[1], kind);
    const dims: OpeningDims = { height_m, sill_m };
    const { op, failure } = resolveOpeningTap({
      scene: sceneRef.current,
      kind,
      edges,
      dims,
    });
    if (op !== null && op.type === "markOpening") {
      setOpeningError(null);
      setPreviewM(op.opening.width_m);
      onChange(applySceneOp(sceneRef.current, op), op);
      setCorners([]);
    } else {
      // Taps that cannot map: say WHY in the step line (via openingError),
      // keep the two edges so the tech only re-taps the top one.
      setOpeningError(t[openingFailureKey(failure)]);
      setPreviewM(null);
    }
  }

  function appendCorner(corner: Vec3, targetId: string | null): void {
    // Height mode: one ceiling tap sets the room height on every wall traced
    // this session (tracked in tracedWallIdsRef). Out-of-range taps are a
    // miss, not a value: the HUD error asks for a re-tap.
    if (traceModeRef.current === "height") {
      const planted = cornersRef.current;
      if (planted.length === 0) {
        setHeightError(t["measure.ar.height.needCorners"]);
        return;
      }
      const height = heightFromCeilingTap(planted[0]![1], corner[1]);
      if (height === null) {
        setHeightError(t["measure.ar.height.retap"]);
        return;
      }
      setHeightError(null);
      setRoomHeightM(height);
      let next = sceneRef.current;
      for (const wallId of tracedWallIdsRef.current) {
        const op: SceneOp = { type: "setWallHeight", wallId, heightM: height };
        next = applySceneOp(next, op);
        onChange(next, op);
      }
      return;
    }
    // Door/Window mode: 3 taps (two edges + top). The first edge tap snaps
    // the opening to the nearest traced wall (resolveOpeningTap), so no
    // picker: taps landing on the wrong wall mean the tech re-taps closer
    // to the right wall. The tech can trace openings back to back: taps
    // clear only on a successful emit or explicit Undo.
    if (traceModeRef.current !== "wall") {
      appendOpeningTap(corner, traceModeRef.current);
      return;
    }
    if (targetId === null && !isEmptyStart) return;
    if (floorYRef.current === null && Number.isFinite(corner[1])) {
      // Session floor datum: the y of the FIRST floor corner tapped. The
      // opening flow (appendOpeningTap) and heightFromCeilingTap share it —
      // set once per trace, cleared on Undo/confirm. Height/opening taps
      // never write it (their y is ceiling/sill, not floor).
      floorYRef.current = corner[1];
    }
    if (isEmptyStart) {
      // Each new tap completes one wall (the segment ending at it), emitted
      // immediately so the 3D view grows corner by corner. Preview shows the
      // length of the wall just completed.
      const nextTrace = traceCornerTap(
        traceRef.current,
        corner,
        (sceneRef.current.walls ?? []).length,
      );
      traceRef.current = nextTrace;
      setCorners(nextTrace.corners);
      const wall = nextTrace.lastWall;
      setPreviewM(wall?.measured_length_m ?? null);
      if (wall !== null) {
        const op: SceneOp = { type: "addWall", wall };
        tracedWallIdsRef.current = [...tracedWallIdsRef.current, wall.id];
        onChange(applySceneOp(sceneRef.current, op), op);
      }
      return;
    }
    const next = [...cornersRef.current, corner];
    setCorners(next);
    if (next.length === 2 && targetId !== null) {
      const update = pairCornersToWallUpdate(
        [next[0] as Vec3, next[1] as Vec3],
        targetId,
      );
      setPreviewM(update?.lengthM ?? null);
    }
  }

  if (target === null && !isEmptyStart) {
    return (
      <div className="ar-measure" role="dialog" aria-label={t["measure.ar.title"]}>
        <h2 className="intake-title">{t["measure.ar.title"]}</h2>
        <p className="intake-hint">{t["intake.scale.empty"]}</p>
        <button type="button" className="chip" onClick={onCancel}>
          {t["measure.ar.cancel"]}
        </button>
        <p className="preliminary">{t["notice.preliminary"]}</p>
      </div>
    );
  }

  function handleEnd(): void {
    // Fallback: the user ends the session (Done) with exactly 2 valid edge
    // taps pending (width/offset known, height never tapped). Emit the
    // opening with openingDefaults height/sill — the ONLY place defaults
    // still apply. Snap-only: always snap via nearestWallToTap (no picker).
    const kind = traceModeRef.current;
    if (
      (kind === "door" || kind === "window") &&
      cornersRef.current.length === 2 &&
      floorYRef.current !== null
    ) {
      const first = cornersRef.current[0] as Vec3;
      const second = cornersRef.current[1] as Vec3;
      const { op } = resolveOpeningTap({ scene: sceneRef.current, kind, edges: [first, second] });
      if (op !== null && op.type === "markOpening") {
        setOpeningError(null);
        onChange(applySceneOp(sceneRef.current, op), op);
        setCorners([]);
        setPreviewM(null);
      }
    }
    // State transition arrives via the adapter's onEnd (back to Start
    // screen, chrome restored); notify here too in case an adapter ends
    // without firing the event.
    onSessionChangeRef.current?.(false);
    (adapter ?? prodAdapterRef.current)?.end();
  }

  function handleSessionCancel(): void {
    onSessionChangeRef.current?.(false);
    (adapter ?? prodAdapterRef.current)?.end();
    onCancel();
  }

  // Unmount cleanup: end any running session (production adapter only; the
  // injected fake belongs to the test, not to this component) and restore
  // app chrome in case the parent unmounts us mid-session.
  useEffect(() => {
    return () => {
      if (adapter === undefined) {
        prodAdapterRef.current?.end();
        prodAdapterRef.current = null;
      }
      onSessionChangeRef.current?.(false);
    };
    // Mount-only: adapter is a construction-time input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleConfirm(): void {
    if (previewM === null) return;
    if (isEmptyStart) {
      // Walls were already emitted per tap; confirm just clears the trace so
      // the technician can start the next room from a clean state.
      traceRef.current = emptyCornerTrace();
      tracedWallIdsRef.current = [];
      floorYRef.current = null;
      setCorners([]);
      setPreviewM(null);
      setRoomHeightM(null);
      setHeightError(null);
      return;
    }
    if (target === null) return;
    const op: SceneOp = {
      type: "setWallLength",
      wallId: target.id,
      lengthM: previewM,
      provenance: "measured_ar",
    };
    const next = applySceneOp(scene, op);
    onChange(next, op);
    setCorners([]);
    setPreviewM(null);
    if (allWallsMeasured(next)) {
      onDone(applySceneOp(next, { type: "confirmScale" }));
    }
  }

  function handleReset(): void {
    traceRef.current = emptyCornerTrace();
    tracedWallIdsRef.current = [];
    floorYRef.current = null;
    setCorners([]);
    setPreviewM(null);
    setRoomHeightM(null);
    setHeightError(null);
    setOpeningError(null);
    // Undo also returns to Wall mode so the next session starts from the
    // default; the mode selector is one tap away.
    setTraceMode("wall");
  }

  // HUD: the same ArHud element in shell mode on the Start/starting/
  // failed screens and full mode in the session, at the same tree position
  // in every branch ({hudShell} first, then the dialog). Same component +
  // position = same DOM node across the ar-ready -> starting -> session
  // transitions, which the captured domOverlay.root depends on.
  const hudShell = <ArHud locale={locale} hudRef={hudRef} shell />;

  // Start screen: detection passed (or a fake adapter was injected), but no
  // session is running yet. The Start AR tap IS the user gesture.
  if (
    support === "checking" ||
    support === "ar-ready" ||
    support === "starting"
  ) {
    const starting = support === "starting";
    return (
      <>
        {hudShell}
        <div className="ar-measure" role="dialog" aria-label={t["measure.ar.title"]}>
        <h2 className="intake-title">{t["measure.ar.title"]}</h2>
        <p className="intake-hint">{t["measure.ar.hint"]}</p>
        <div className="intake-scale-foot">
          <button
            type="button"
            className="btn-primary"
            onClick={handleStart}
            disabled={support === "checking" || starting}
          >
            {t["intake.capture.ar"]}
          </button>
          <button type="button" className="chip" onClick={onCancel}>
            {t["measure.ar.cancel"]}
          </button>
        </div>
        {starting && (
          <p className="intake-hint ar-start-step">
            {startStep ?? t["measure.ar.starting"]}
          </p>
        )}
        <p className="preliminary">{t["notice.preliminary"]}</p>
        </div>
      </>
    );
  }

  // Start rejected: show the REAL error, plus the B/C fallback actions.
  // The "unsupported" copy is reserved for isARSupported() === false.
  if (support === "failed") {
    return (
      <>
        {hudShell}
        <div className="ar-measure" role="dialog" aria-label={t["measure.ar.title"]}>
        <h2 className="intake-title">{t["measure.ar.title"]}</h2>
        <p className="intake-error" role="alert">
          {startError ?? t["measure.ar.fallback"]}
        </p>
        <p className="intake-hint">{t["measure.ar.fallback"]}</p>
        <div className="intake-scale-foot">
          <button type="button" className="btn-primary" onClick={handleStart}>
            {t["intake.capture.ar"]}
          </button>
          {onFallbackB && (
            <button type="button" className="chip" onClick={onFallbackB}>
              {t["intake.kind.plan"]}
            </button>
          )}
          {onFallbackC && (
            <button type="button" className="chip" onClick={onFallbackC}>
              {t["intake.kind.sketch"]}
            </button>
          )}
          <button type="button" className="chip" onClick={onCancel}>
            {t["measure.ar.cancel"]}
          </button>
        </div>
        <p className="preliminary">{t["notice.preliminary"]}</p>
        </div>
      </>
    );
  }

  if (support === "unsupported") {
    return (
      <div className="ar-measure" role="dialog" aria-label={t["measure.ar.unsupported"]}>
        <h2 className="intake-title">{t["measure.ar.unsupported"]}</h2>
        <p className="intake-hint">{t["measure.ar.fallback"]}</p>
        <div className="intake-scale-foot">
          {onFallbackB && (
            <button type="button" className="chip" onClick={onFallbackB}>
              {t["intake.kind.plan"]}
            </button>
          )}
          {onFallbackC && (
            <button type="button" className="chip" onClick={onFallbackC}>
              {t["intake.kind.sketch"]}
            </button>
          )}
          <button type="button" className="chip" onClick={onCancel}>
            {t["measure.ar.cancel"]}
          </button>
        </div>
        <p className="preliminary">{t["notice.preliminary"]}</p>
      </div>
    );
  }

  // Step copy follows the tracing mode. Wall keeps tap-first/tap-second
  // (+ close hint on empty-start); height shows its own tap prompt, the
  // captured value, or the re-tap error; door/window prompt for the two
  // opening edges, then the top edge (topFirst/topSecond), or the failure
  // reason the last taps were dropped (with topSecond re-tap guidance once
  // both edges are pending). After a successful 3-tap emit the
  // preview still shows the width (previewM), same as the old 2-tap flow.
  const stepLabel =
    traceMode === "height"
      ? (heightError ??
        (roomHeightM === null
          ? t["measure.ar.height.tap"]
          : `${t["measure.ar.height.done"]} ${formatMeasureM(locale, roomHeightM)}`))
      : traceMode === "wall"
        ? `${corners.length === 0 ? t["measure.ar.tapFirst"] : t["measure.ar.tapSecond"]}${
            isEmptyStart && corners.length > 0 ? ` · ${t["measure.ar.closeHint"]}` : ""
          }`
        : (corners.length === 2 && openingError !== null
          ? `${openingError} · ${t["measure.ar.topSecond"]}`
          : (openingError ??
            (corners.length === 0
              ? t["measure.ar.edgeFirst"]
              : corners.length === 1
                ? t["measure.ar.edgeSecond"]
                : t["measure.ar.topFirst"])));

  // Live session: ONLY the HUD renders (transparent root = domOverlay.root,
  // camera shows through). No sheet copy, no confirm footers, nothing else
  // from the app — opaque bottom-sheet backgrounds would cover the camera.
  // The XR canvas lives on document.body (the adapter moves it there) so it
  // stays OUTSIDE the overlay root. Same child order as the other branches
  // ({hudShell} first) so the HUD div keeps the DOM node captured at start().
  // The parent hides the sheet + 3D via onSessionChange and restores them
  // on end.
  // Door/Window taps produce openings, so there is nothing to Confirm:
  // markOpening is emitted on the third (top) tap; a Done with exactly 2
  // pending edge taps falls back to openingDefaults. Undo resets the mode.
  const openingPreview = traceMode !== "wall" && previewM !== null ? previewM : null;
  return (
    <ArHud
      locale={locale}
      hudRef={hudRef}
      overlayFrameRef={overlayFrameRef}
      overlayCorners={corners}
      previewM={traceMode === "wall" ? previewM : openingPreview}
      targetLengthM={target !== null ? wallDisplayLengthM(target) : null}
      stepLabel={stepLabel}
      surfaceFound={surfaceFound}
      debugFrames={debugFrames}
      canConfirm={traceMode === "wall" && previewM !== null}
      traceMode={traceMode}
      onTraceModeChange={handleTraceModeChange}
      onConfirm={handleConfirm}
      onReset={handleReset}
      onEnd={handleEnd}
      onCancel={handleSessionCancel}
    />
  );
}
