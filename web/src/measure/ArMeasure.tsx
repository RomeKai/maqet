import { useEffect, useRef, useState } from "react";
import type { Scene } from "../scene/types";
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
  /** Fallback actions: B = room photo + tapped lengths, C = sketch measures. */
  onFallbackB?: () => void;
  onFallbackC?: () => void;
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
  const cornersRef = useRef<Vec3[]>([]);
  cornersRef.current = corners;
  // Host for the XR canvas (production path): the device stream renders
  // behind the bottom sheet. Mounts only while a session is active so it
  // never swallows taps on the Start screen. Minimal positioning; stacking
  // is refined later.
  const xrHostRef = useRef<HTMLDivElement | null>(null);
  // Controls container: mounted on every measuring screen, passed as
  // domOverlay.root so End + the step trace stay visible and tappable
  // over the camera feed (dom-overlay needs a live element at start()).
  const controlsRef = useRef<HTMLDivElement | null>(null);
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
    const callbacks: XrTapCallbacks = {
      onTapCorner: (corner) => appendCorner(corner, target?.id ?? null),
      onEnd: () => undefined,
    };
    const active = adapter ?? new WebXrHitTestAdapter();
    if (adapter === undefined) prodAdapterRef.current = active;
    startStepRef.current = null;
    setStartStep(null);
    setSupport("starting");
    const onStarted = (): void => setSupport("session");
    const onFailed = (message: string): void => {
      // Surface the REAL reason (e.g. NotAllowedError when the gesture
      // chain is broken) or the watchdog's stuck step — never the
      // "unsupported" copy: detection already passed, so this device
      // supports AR and something else failed.
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
      // Prefer the live controls element as domOverlay.root (visible +
      // tappable over the camera); fall back to the XR host if mounted.
      () =>
        (controlsRef.current ?? xrHostRef.current ?? undefined) as
          | HTMLElement
          | undefined,
      { onStarted, onFailed, onStep, stuckMessage },
    )();
  }

  function appendCorner(corner: Vec3, targetId: string | null): void {
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
    (adapter ?? prodAdapterRef.current)?.end();
  }

  // Unmount cleanup: end any running session (production adapter only; the
  // injected fake belongs to the test, not to this component).
  useEffect(() => {
    return () => {
      if (adapter === undefined) {
        prodAdapterRef.current?.end();
        prodAdapterRef.current = null;
      }
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
  }

  // Production path: the XR host renders ONLY while a session is active.
  // An always-mounted fixed full-screen host would swallow every tap on the
  // Start screen (the button would look fine but requestSession never fires).
  // domOverlay.root is the visible controls container, not this empty host,
  // so End + the step trace stay tappable over the camera feed.
  const xrHost = support === "session" && (
    <div ref={xrHostRef} className="ar-xr-host" aria-hidden="true" />
  );

  // Start screen: detection passed (or a fake adapter was injected), but no
  // session is running yet. The Start AR tap IS the user gesture.
  if (
    support === "checking" ||
    support === "ar-ready" ||
    support === "starting"
  ) {
    const starting = support === "starting";
    return (
      <div className="ar-measure" role="dialog" aria-label={t["measure.ar.title"]}>
        {xrHost}
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
    );
  }

  // Start rejected: show the REAL error, plus the B/C fallback actions.
  // The "unsupported" copy is reserved for isARSupported() === false.
  if (support === "failed") {
    return (
      <div className="ar-measure" role="dialog" aria-label={t["measure.ar.title"]}>
        {xrHost}
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

  const stepLabel =
    corners.length === 0 ? t["measure.ar.tapFirst"] : t["measure.ar.tapSecond"];

  return (
    <div
      ref={controlsRef}
      className="ar-measure"
      role="dialog"
      aria-label={t["measure.ar.title"]}
    >
      {xrHost}
      <h2 className="intake-title">{t["measure.ar.title"]}</h2>
      <p className="intake-hint">{t["measure.ar.hint"]}</p>
      <p className="intake-hint">{stepLabel}</p>

      <span className="wall-row-measure">
        {previewM !== null
          ? formatMeasureM(locale, previewM)
          : target !== null
            ? formatMeasureM(locale, wallDisplayLengthM(target))
            : formatMeasureM(locale, 0)}
      </span>
      {previewM === null && (
        <span className="wall-row-flag wall-row-flag-estimated">
          {t["intake.scale.estimated"]}
        </span>
      )}

      <div className="intake-scale-foot">
        <button type="button" className="chip" onClick={handleEnd}>
          {t["measure.ar.done"]}
        </button>
        <button type="button" className="chip" onClick={onCancel}>
          {t["measure.ar.cancel"]}
        </button>
      </div>

      {previewM !== null && (
        <div className="intake-scale-foot">
          <button type="button" className="btn-primary" onClick={handleConfirm}>
            {t["measure.ar.confirm"]}
          </button>
          <button type="button" className="chip" onClick={handleReset}>
            {t["intake.undo"]}
          </button>
        </div>
      )}

      <p className="preliminary">{t["notice.preliminary"]}</p>
    </div>
  );
}
