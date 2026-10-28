import { useEffect, useRef, useState } from "react";
import type { Opening, Scene, Wall } from "../scene/types";
import {
  allWallsMeasured,
  applySceneOp,
  wallDisplayLengthM,
  type SceneOp,
} from "../scene/store";
import { getStrings, type Locale } from "../i18n";
import { formatMeasureM } from "../intake/ScaleTool";
import {
  emptyCornerTrace,
  traceCornerTap,
  pairCornersToWallUpdate,
  type CornerTrace,
  type Vec3,
} from "./cornerMath";
import { openingDefaults, projectEdgesToOpening } from "./openingMath";
import {
  AR_START_WATCHDOG_MS,
  isARSupported,
  preloadThree,
  WebXrHitTestAdapter,
  type XrHitTestAdapter,
  type XrSessionConfigStep,
  type XrStartStep,
  type XrTapCallbacks,
} from "./xrAdapter";

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

/** Guided AR HUD tracing mode: walls (current behavior) or openings. */
export type ArHudMode = "wall" | "door" | "window";

interface ArHudProps {
  locale: Locale;
  /** Ref to the HUD root: the dedicated domOverlay.root while live. */
  hudRef: { current: HTMLDivElement | null };
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
  canConfirm?: boolean;
  /** Active tracing mode + setter for the Wall / Door / Window selector. */
  traceMode?: ArHudMode;
  onTraceModeChange?: (mode: ArHudMode) => void;
  /** Walls available as opening targets (door/window mode wall picker). */
  pickerWalls?: Wall[];
  /** Selected opening target wall id, or null until the tech picks one. */
  pickerWallId?: string | null;
  onPickerWallChange?: (wallId: string) => void;
  onConfirm?: () => void;
  onReset?: () => void;
  onEnd?: () => void;
  onCancel?: () => void;
}

/**
 * Dedicated AR HUD: the ONLY app content rendered while the XR session runs,
 * and the domOverlay.root passed to requestSession. Transparent full-screen
 * root (the camera shows through), centered crosshair + readout, mode
 * selector (Wall / Door / Window), an optional wall picker for openings, and
 * a small bottom bar with its own semi-opaque background holding Undo / Done /
 * Cancel (plus Confirm while a length is previewed — wall-target mode needs
 * it to emit the setWallLength op). Shell mode renders the empty element so
 * the overlay root exists (and keeps its DOM node) before the session
 * starts. Exported for tests.
 */
function noopArHudAction(): void {}
function noopArHudModeChange(_mode: ArHudMode): void {}
function noopArHudWallChange(_wallId: string): void {}
const HUD_MODES: ArHudMode[] = ["wall", "door", "window"];
function hudModeKey(mode: ArHudMode): `measure.ar.mode.${ArHudMode}` {
  return `measure.ar.mode.${mode}`;
}
export function ArHud({
  locale,
  hudRef,
  shell = false,
  previewM = null,
  targetLengthM = null,
  stepLabel = "",
  surfaceFound = false,
  canConfirm = false,
  traceMode = "wall",
  onTraceModeChange = noopArHudModeChange,
  pickerWalls = [],
  pickerWallId = null,
  onPickerWallChange = noopArHudWallChange,
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
  return (
    <div ref={hudRef} className="ar-hud" role="dialog" aria-label={t["measure.ar.title"]}>
      <div className="ar-hud-crosshair" aria-hidden="true" />
      <p
        className={`ar-hud-surface${surfaceFound ? " ar-hud-surface-found" : ""}`}
        role="status"
      >
        {surfaceFound
          ? t["measure.ar.surface.found"]
          : t["measure.ar.surface.searching"]}
      </p>
      <p className="ar-hud-hint">{t["measure.ar.hint"]}</p>
      <div className="ar-hud-modes" role="group" aria-label={t["measure.ar.title"]}>
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
      </div>
      {traceMode !== "wall" && pickerWalls.length > 0 && (
        <div className="ar-hud-walls" role="group" aria-label={t["measure.ar.pickWall"]}>
          {pickerWalls.map((wall, index) => (
            <button
              key={wall.id}
              type="button"
              className={`chip${pickerWallId === wall.id ? " chip-active" : ""}`}
              onClick={() => onPickerWallChange(wall.id)}
            >
              {`W${index + 1}`}
            </button>
          ))}
        </div>
      )}
      <p className="ar-hud-step">{stepLabel}</p>
      <p className="ar-hud-readout">{formatMeasureM(locale, shownM)}</p>
      <div className="ar-hud-bar">
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
  // Guided HUD tracing mode: walls (corner trace, current behavior) or
  // openings (pick a measured wall, tap its two edges, emit markOpening).
  // Stays across rooms/confirmations: the tech traces several openings in a
  // row without re-selecting Door/Window. Resets only on explicit Undo.
  const [traceMode, setTraceMode] = useState<ArHudMode>("wall");
  // Opening target wall for door/window mode. Defaults to the wall under
  // measure (wallId prop, else the first estimated wall, else the first
  // wall) — the same rule that picks the wall-target flow's `target`.
  const [openingWallId, setOpeningWallId] = useState<string | null>(
    target?.id ?? null,
  );
  const traceModeRef = useRef<ArHudMode>("wall");
  traceModeRef.current = traceMode;
  const openingWallIdRef = useRef<string | null>(null);
  openingWallIdRef.current = openingWallId;
  // Surface presence from the adapter's onSurfaceChange (transition-only:
  // false = searching, the initial state until the first report). Passed to
  // ArHud as a prop so renderToString tests cover the wiring without WebXR.
  const [surfaceFound, setSurfaceFound] = useState(false);
  const cornersRef = useRef<Vec3[]>([]);
  cornersRef.current = corners;
  // Host for the XR canvas (production path): the device stream renders
  // behind the bottom sheet. Mounts only while a session is active so it
  // never swallows taps on the Start screen. Minimal positioning; stacking
  // is refined later.
  const xrHostRef = useRef<HTMLDivElement | null>(null);
  // HUD root: the dedicated domOverlay.root while a session runs (see the
  // session branch below). Rendered as an empty transparent shell on the
  // Start/starting/failed screens so the element exists when start() reads
  // it in the gesture handler.
  const hudRef = useRef<HTMLDivElement | null>(null);
  // Latest onSessionChange (parent hides the sheet + 3D while active).
  const onSessionChangeRef = useRef(onSessionChange);
  onSessionChangeRef.current = onSessionChange;
  // Production adapter owned by this component when no test fake is injected.
  const prodAdapterRef = useRef<XrHitTestAdapter | null>(null);
  // Adapter taps arrive through the start() subscription: keep a ref to
  // the latest scene so each tap emits its addWall onto current walls.
  const sceneRef = useRef<Scene>(scene);
  sceneRef.current = scene;

  // Empty scene (no photo yet, ADR-025 Mode A entry): trace walls corner by
  // corner with stable incremental ids (wall-1, wall-2, ...). Each new tap
  // emits the wall ending at it from the previous corner immediately via
  // onChange + applySceneOp addWall; a tap within CLOSE_ROOM_M of the
  // first corner closes the loop.
  const isEmptyStart = target === null;
  const traceRef = useRef<CornerTrace>(emptyCornerTrace());

  // Detection on mount: decides only whether the Start AR button shows.
  // Never starts a session here — no user gesture exists yet. Also warms
  // the three.js module cache so requestSession-first start() doesn't pay
  // a cold import inside the transient-activation window.
  useEffect(() => {
    if (adapter) return;
    preloadThree();
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
    const notify = onSessionChangeRef.current;
    const callbacks: XrTapCallbacks = {
      onTapCorner: (corner) => appendCorner(corner, target?.id ?? null),
      // Device End (or adapter teardown): leave the session state, restore
      // app chrome via the notify, back to the Start screen for re-tap.
      onEnd: () => {
        notify?.(false);
        if (adapter === undefined) prodAdapterRef.current = null;
        setSurfaceFound(false);
        setSupport("ar-ready");
      },
      // Transition-only from the adapter: one setState per surface event,
      // never per XR frame. Reset on every start so a re-tap begins searching.
      onSurfaceChange: (found) => {
        setSurfaceFound(found);
      },
    };
    const active = adapter ?? new WebXrHitTestAdapter();
    if (adapter === undefined) prodAdapterRef.current = active;
    startStepRef.current = null;
    setStartStep(null);
    setSurfaceFound(false);
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
      // The dedicated HUD root (transparent, camera shows through); it is
      // mounted as an empty shell on the Start/starting screens so the
      // element exists when start() reads it in the gesture handler.
      () =>
        (hudRef.current ?? xrHostRef.current ?? undefined) as
          | HTMLElement
          | undefined,
      { onStarted, onFailed, onStep, stuckMessage },
    )();
  }

  function handleTraceModeChange(mode: ArHudMode): void {
    setTraceMode(mode);
    // Pending corner taps belong to the old mode: drop them so a wall
    // trace never leaks into an opening (and vice versa).
    traceRef.current = emptyCornerTrace();
    setCorners([]);
    setPreviewM(null);
  }

  function handleOpeningWallChange(wallId: string): void {
    setOpeningWallId(wallId);
    // A new target wall invalidates pending edge taps from the old wall.
    setCorners([]);
    setPreviewM(null);
  }

  /**
   * Build the markOpening op for two edge taps on a measured wall. Pure
   * geometry lives in openingMath (floor-plane projection); defaults by
   * kind come from openingDefaults. Ids are stable within the scene
   * (`opening-<n>` over the current opening count), mirroring the wall
   * trace's `wall-<n>` scheme.
   */
  function buildOpeningOp(
    current: Scene,
    kind: "door" | "window",
    wallId: string,
    edges: [Vec3, Vec3],
  ): SceneOp | null {
    const wall = (current.walls ?? []).find((w) => w.id === wallId);
    if (wall === undefined) return null;
    const projection = projectEdgesToOpening(wall, edges[0], edges[1]);
    if (projection === null) return null;
    const defaults = openingDefaults(kind);
    const opening: Opening = {
      id: `opening-${(current.openings ?? []).length + 1}`,
      wall_id: wallId,
      kind,
      offset_m: projection.offset_m,
      width_m: projection.width_m,
      height_m: defaults.height_m,
      sill_m: defaults.sill_m,
    };
    return { type: "markOpening", opening };
  }

  function appendCorner(corner: Vec3, targetId: string | null): void {
    // Door/Window mode: the first edge tap selects the pending opening;
    // the second tap resolves it through the real openingMath path and
    // emits markOpening immediately. Taps stay pending on the same wall so
    // the tech can trace openings back to back.
    if (traceModeRef.current !== "wall") {
      const wallId = openingWallIdRef.current ?? targetId;
      if (wallId === null) return;
      const next = [...cornersRef.current, corner];
      setCorners(next);
      if (next.length === 2) {
        const op = buildOpeningOp(
          sceneRef.current,
          traceModeRef.current,
          wallId,
          [next[0] as Vec3, next[1] as Vec3],
        );
        if (op !== null && op.type === "markOpening") {
          setPreviewM(op.opening.width_m);
          onChange(applySceneOp(sceneRef.current, op), op);
          setCorners([]);
        } else {
          // Degenerate pair (coincident taps): keep the first edge so the
          // tech only re-taps the second one.
          setCorners(next.slice(0, 1));
          setPreviewM(null);
        }
      }
      return;
    }
    if (targetId === null && !isEmptyStart) return;
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
      setCorners([]);
      setPreviewM(null);
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
    setCorners([]);
    setPreviewM(null);
    // Undo also returns to Wall mode so the next session starts from the
    // default; the mode selector is one tap away.
    setTraceMode("wall");
  }

  // Production path: the XR host renders ONLY while a session is active.
  // An always-mounted fixed full-screen host would swallow every tap on the
  // Start screen (the button would look fine but requestSession never fires).
  const xrHost = support === "session" && (
    <div ref={xrHostRef} className="ar-xr-host" aria-hidden="true" />
  );

  // HUD: the same ArHud element in shell mode on the Start/starting/
  // failed screens and full mode in the session, at the same tree position
  // in every branch ({xrHost}{hud}{sheet}). Same component + position =
  // same DOM node across the ar-ready -> starting -> session transitions,
  // which the captured domOverlay.root depends on.
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
        {xrHost}
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
        {xrHost}
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

  // Step copy follows the tracing mode. Wall mode keeps the current
  // tap-first/tap-second flow; empty-start adds the close-room hint while
  // tracing so the tech learns the gesture without a manual. Door/Window
  // mode prompts for the wall first, then the two opening edges.
  const stepLabel =
    traceMode === "wall"
      ? `${corners.length === 0 ? t["measure.ar.tapFirst"] : t["measure.ar.tapSecond"]}${
          isEmptyStart && corners.length > 0 ? ` · ${t["measure.ar.closeHint"]}` : ""
        }`
      : openingWallId === null
        ? t["measure.ar.pickWall"]
        : corners.length === 0
          ? t["measure.ar.edgeFirst"]
          : t["measure.ar.edgeSecond"];

  // Live session: ONLY the HUD renders (transparent root = domOverlay.root,
  // camera shows through). No sheet copy, no confirm footers, nothing else
  // from the app — opaque bottom-sheet backgrounds would cover the camera.
  // Same child order as the other branches so the HUD div keeps the DOM
  // node captured at start(). The parent hides the sheet + 3D via
  // onSessionChange and restores them on end.
  // Door/Window taps produce openings, so there is nothing to Confirm:
  // markOpening is emitted on the second edge tap. Undo resets the mode.
  const openingPreview = traceMode !== "wall" && previewM !== null ? previewM : null;
  return (
    <>
      {xrHost}
      <ArHud
        locale={locale}
        hudRef={hudRef}
        previewM={traceMode === "wall" ? previewM : openingPreview}
        targetLengthM={target !== null ? wallDisplayLengthM(target) : null}
        stepLabel={stepLabel}
        surfaceFound={surfaceFound}
        canConfirm={traceMode === "wall" && previewM !== null}
        traceMode={traceMode}
        onTraceModeChange={handleTraceModeChange}
        pickerWalls={traceMode === "wall" ? [] : walls}
        pickerWallId={openingWallId}
        onPickerWallChange={handleOpeningWallChange}
        onConfirm={handleConfirm}
        onReset={handleReset}
        onEnd={handleEnd}
        onCancel={handleSessionCancel}
      />
    </>
  );
}
