import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { MeasureReview } from "./MeasureReview";
import type { Scene } from "../scene/types";
import {
  applySceneOp,
  type SceneOp,
} from "../scene/store";
import { getStrings, type Locale } from "../i18n";
import { formatMeasureM } from "../intake/ScaleTool";
import type { Vec3 } from "./cornerMath";
import {
  captureReducer,
  initialCaptureState,
  stepKey,
  toSceneOps,
  type CaptureState,
} from "./captureSession";
import {
  ceilingHeightFromCenterRay,
  centerRayFromViewInverse,
} from "./ceilingRay";
import { tMeasure, stepKeyLabel, modeLabel } from "./measure.i18n";
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

export function startErrorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export interface ArStartOutcome {
  onStarted: () => void;
  onFailed: (message: string) => void;
  onStep?: (step: ArTraceStep) => void;
  stuckMessage?: (step: ArTraceStep | null) => string;
}

function defaultStuckMessage(step: ArTraceStep | null): string {
  return `AR stuck at: ${step ?? "?"}`;
}

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
    reset: (): void => { started = false; },
  };
}

// Opening helpers preserved for non-walls missions (openings branch extends captureSession).
import type { OpeningFailure } from "./openingMath";
import { type StringKey } from "../i18n";

export function openingFailureKey(failure: OpeningFailure | null): StringKey {
  switch (failure) {
    case "door-narrow": return "measure.ar.opening.doorNarrow";
    case "degenerate": return "measure.ar.opening.degenerate";
    case "no-fit": return "measure.ar.opening.noFit";
    case "unknown-wall": return "measure.ar.opening.unknownWall";
    case "no-walls":
    case null: return "measure.ar.opening.noWalls";
  }
}

import { isValidCorner } from "./cornerMath";
import {
  buildOpening,
  nearestWallToTap,
  nextOpeningId,
  type OpeningDims,
} from "./openingMath";

export interface OpeningTapInput {
  scene: Scene;
  kind: "door" | "window";
  edges: [Vec3, Vec3];
  dims?: OpeningDims;
}
export interface OpeningTapResult {
  op: SceneOp | null;
  failure: OpeningFailure | null;
}
export function resolveOpeningTap(input: OpeningTapInput): OpeningTapResult {
  const walls = input.scene.walls ?? [];
  if (!isValidCorner(input.edges[0]) || !isValidCorner(input.edges[1])) {
    return { op: null, failure: "degenerate" };
  }
  const wallId = nearestWallToTap(walls, input.edges[0])?.id ?? null;
  if (wallId === null) {
    return { op: null, failure: walls.length === 0 ? "no-walls" : "unknown-wall" };
  }
  const id = nextOpeningId(input.scene.openings ?? []);
  const result = buildOpening(walls, id, input.kind, wallId, input.edges[0], input.edges[1], input.dims);
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
      started = active.start(callbacks, getContainer(), reportStep);
    } catch (error: unknown) {
      started = Promise.reject(error);
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      outcome.onFailed((outcome.stuckMessage ?? defaultStuckMessage)(lastStep));
    }, AR_START_WATCHDOG_MS);
    void started.then(
      () => { settled = true; clearTimeout(timer); outcome.onStarted(); },
      (error: unknown) => {
        settled = true; clearTimeout(timer);
        active.end();
        outcome.onFailed(startErrorMessage(error));
      },
    );
  };
}

interface ArMeasureProps {
  locale: Locale;
  scene: Scene;
  wallId?: string;
  adapter?: XrHitTestAdapter;
  onChange: (scene: Scene, op: SceneOp) => void;
  onDone: (scene: Scene) => void;
  onCancel: () => void;
  onSessionChange?: (active: boolean) => void;
  onFallbackB?: () => void;
  onFallbackC?: () => void;
}

/** Walls-flow HUD mode (F6 spec): Walls | Door | Window. Last two disabled until closed/finished. */
export type ArHudMode = "wall" | "height" | "door" | "window";

/** Fallback room height (m) offered on the ceiling step (ADR-023 2.60 m default). */
export const DEFAULT_CEILING_HEIGHT_M = 2.6;

/**
 * Live ceiling preview from the frame's viewer matrices: ray through the
 * pending wall's vertical plane, above floorY. No hit-test needed.
 */
export function previewCeilingHeight(
  capture: CaptureState,
  viewInverse: readonly number[] | null,
): number | null {
  if (stepKey(capture) !== "ceiling") return null;
  if (viewInverse === null) return null;
  return ceilingHeightFromCenterRay(
    capture.pendingStart,
    capture.pendingEnd,
    capture.floorY,
    centerRayFromViewInverse(viewInverse),
  );
}

/**
 * Parse a typed height in meters: accepts "2.6", "2,6", "2.60 m".
 * Returns null for empty, non-numeric, or non-positive input.
 */
export function parseTypedHeightM(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/\s*m\s*$/i, "")
    .replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || !(n > 0)) return null;
  return n;
}

interface ArHudProps {
  locale: Locale;
  hudRef: { current: HTMLDivElement | null };
  overlayFrameRef?: OverlayFrameRef;
  overlayCorners?: Vec3[];
  shell?: boolean;
  // Walls-path props (used when capture state drives HUD)
  capture?: CaptureState;
  pillError?: string | null;
  measureLocale?: "en" | "es-AR";
  /** Live ray height on the ceiling step (written via overlay frame, no setState/frame). */
  previewCeilM?: number | null;
  onCeilingConfirm?: (heightM: number) => void;
  // Legacy props (kept for compat, ignored when capture provided)
  previewM?: number | null;
  targetLengthM?: number | null;
  stepLabel?: string;
  surfaceFound?: boolean;
  debugFrames?: number | null;
  canConfirm?: boolean;
  traceMode?: ArHudMode;
  onTraceModeChange?: (mode: ArHudMode) => void;
  onConfirm?: () => void;
  onReset?: () => void;
  onEnd?: () => void;
  onCancel?: () => void;
  // New F6 props
  onUndo?: () => void;
  onStartOver?: () => void;
  onDone?: () => void;
  onModeChange?: (mode: "walls" | "door" | "window") => void;
}

function noopArHudAction(): void {}
function noopArHudActionNumber(_heightM: number): void {}
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
  capture,
  pillError,
  measureLocale,
  previewCeilM = null,
  onCeilingConfirm = noopArHudActionNumber,
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
  onUndo,
  onStartOver,
  onDone,
  onModeChange,
}: ArHudProps): React.JSX.Element {
  const t = getStrings(locale);
  if (shell) {
    return <div ref={hudRef} className="ar-hud" aria-hidden="true" />;
  }

  // F6 walls path: derive HUD from capture state when provided.
  if (capture !== undefined) {
    const ml = (measureLocale ?? locale) as "en" | "es-AR";
    const sk = stepKey(capture);
    const wallN = capture.walls.length + 1;
    const stepLabelWalls = stepKeyLabel(ml, sk, wallN);
    const pill = pillError ?? stepLabelWalls;
    const canUndo = capture.past.length > 0;
    const canStartOver = capture.walls.length > 0 || capture.pendingStart !== null;
    const modeUnlocked = capture.closed || capture.finished;
    const isWalls = capture.mode === "walls";
    const ceilingStep = sk === "ceiling";
    return (
      <div ref={hudRef} className="ar-hud" role="dialog" aria-label={t["measure.ar.title"]}>
        {overlayFrameRef !== undefined && overlayCorners !== undefined && (
          <ArOverlay
            frameRef={overlayFrameRef}
            corners={overlayCorners}
            locale={locale}
            walls={capture.walls}
            pendingStart={capture.pendingStart}
            pendingEnd={capture.pendingEnd}
            floorY={capture.floorY}
          />
        )}
        <p className="ar-hud-pill" role="status">
          {pill}
          {ceilingStep && previewCeilM !== null ? ` · ${formatMeasureM(ml === "en" ? "en" : "es-AR", previewCeilM)}` : ""}
        </p>
        {ceilingStep && (
          <div className="ar-hud-ceiling" role="group" aria-label={tMeasure(ml, "ceiling.typeLabel")}>
            <form
              className="ar-hud-ceiling-form"
              onSubmit={(e) => {
                e.preventDefault();
                const input = (e.currentTarget.elements.namedItem("ceil") as HTMLInputElement | null)?.value ?? "";
                const n = parseTypedHeightM(input);
                if (n !== null) onCeilingConfirm(n);
              }}
            >
              <label className="ar-hud-ceiling-label" htmlFor="ar-ceil-input">
                {tMeasure(ml, "ceiling.typeLabel")}
              </label>
              <input
                id="ar-ceil-input"
                name="ceil"
                className="ar-hud-ceiling-input"
                inputMode="decimal"
                placeholder={tMeasure(ml, "ceiling.typePlaceholder")}
              />
              <button type="submit" className="chip chip-primary">
                {tMeasure(ml, "ceiling.confirm")}
              </button>
            </form>
            <button type="button" className="chip" onClick={() => onCeilingConfirm(DEFAULT_CEILING_HEIGHT_M)}>
              {tMeasure(ml, "ceiling.useDefault")}
            </button>
          </div>
        )}
        {debugFrames !== null && <p className="ar-hud-debug" role="status">{`frames: ${debugFrames}`}</p>}
        <div className="ar-hud-bar">
          <span className="ar-hud-bar-modes" role="group" aria-label={t["measure.ar.title"]}>
            {(["walls", "door", "window"] as const).map((m) => {
              const disabled = (m === "door" || m === "window") && !modeUnlocked;
              const active = (m === "walls" && isWalls) || capture.mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  className={`chip${active ? " chip-active" : ""}`}
                  disabled={disabled}
                  onClick={() => onModeChange?.(m)}
                >
                  {modeLabel(ml, m as never)}
                </button>
              );
            })}
          </span>
          <button type="button" className="chip" onClick={() => onUndo?.()} disabled={!canUndo}>
            {tMeasure(ml, "action.undo")}
          </button>
          <button type="button" className="chip" onClick={() => onStartOver?.()} disabled={!canStartOver}>
            {tMeasure(ml, "action.startOver")}
          </button>
          <button type="button" className="chip chip-primary" onClick={() => onDone?.()}>
            {tMeasure(ml, "action.done")}
          </button>
          <button type="button" className="chip" onClick={onCancel}>{t["measure.ar.cancel"]}</button>
        </div>
      </div>
    );
  }

  const _shownM = previewM ?? targetLengthM ?? 0;
  const _shownLabel = formatMeasureM(locale, _shownM);
  const legacyPill = surfaceFound ? `${stepLabel} · ${_shownLabel}` : `${t["measure.ar.surface.searching"]} · ${stepLabel} · ${_shownLabel}`;
  return (
    <div ref={hudRef} className="ar-hud" role="dialog" aria-label={t["measure.ar.title"]}>
      {overlayFrameRef !== undefined && overlayCorners !== undefined && (
        <ArOverlay frameRef={overlayFrameRef} corners={overlayCorners} locale={locale} />
      )}
      <p className="ar-hud-pill" role="status">{legacyPill}</p>
      {debugFrames !== null && <p className="ar-hud-debug" role="status">{`frames: ${debugFrames}`}</p>}
      <div className="ar-hud-bar">
        <span className="ar-hud-bar-modes" role="group" aria-label={t["measure.ar.title"]}>
          {HUD_MODES.map((mode) => (
            <button key={mode} type="button" className={`chip${traceMode === mode ? " chip-active" : ""}`} onClick={() => onTraceModeChange(mode)}>
              {t[hudModeKey(mode)]}
            </button>
          ))}
        </span>
        {canConfirm && <button type="button" className="btn-primary" onClick={onConfirm}>{t["measure.ar.confirm"]}</button>}
        <button type="button" className="chip" onClick={onReset}>{t["intake.undo"]}</button>
        <button type="button" className="chip" onClick={onEnd}>{t["measure.ar.done"]}</button>
        <button type="button" className="chip" onClick={onCancel}>{t["measure.ar.cancel"]}</button>
      </div>
    </div>
  );
}

export function ArMeasure({
  locale,
  scene,
  adapter,
  onChange,
  onDone,
  onCancel,
  onSessionChange,
  onFallbackB,
  onFallbackC,
}: ArMeasureProps) {
  const t = getStrings(locale);
  const ml = locale as "en" | "es-AR";

  // --- Capture state: single source of truth for Mode A walls flow.
  // React's reducer must return CaptureState; the pure reducer returns
  // {state, error} so we unwrap here and check errors via direct calls.
  const [capture, dispatch] = useReducer(
    (s: CaptureState, e: import("./captureSession").CaptureEvent): CaptureState =>
      captureReducer(s, e).state,
    null as unknown as CaptureState,
    () => initialCaptureState(),
  );
  const [hudError, setHudError] = useState<string | null>(null);
  const [showStartOverConfirm, setShowStartOverConfirm] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [reviewCapture, setReviewCapture] = useState<CaptureState | null>(null);

  // Adapter/session plumbing (same UX as before: Start AR button gesture).
  const [support, setSupport] = useState<"checking" | "ar-ready" | "starting" | "session" | "failed" | "unsupported">(
    adapter ? "ar-ready" : "checking",
  );
  const [startError, setStartError] = useState<string | null>(null);
  const [startStep, setStartStep] = useState<ArTraceStep | null>(null);
  const startStepRef = useRef<ArTraceStep | null>(null);
  const [surfaceFound, setSurfaceFound] = useState(false);
  const [debugFrames, setDebugFrames] = useState<number | null>(null);
  const overlayFrameRef = useRef<OverlayFrame | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const onSessionChangeRef = useRef(onSessionChange);
  onSessionChangeRef.current = onSessionChange;
  const prodAdapterRef = useRef<XrHitTestAdapter | null>(null);
  const startGuardRef = useRef(createStartGuard());
  const sceneRef = useRef<Scene>(scene);
  sceneRef.current = scene;

  useEffect(() => {
    if (adapter) return;
    let cancelled = false;
    isARSupported().then((ok) => { if (!cancelled) setSupport(ok ? "ar-ready" : "unsupported"); });
    return () => { cancelled = true; };
  }, [adapter]);

  const handleTapAtomic = useCallback((point: Vec3, horizontal: boolean) => {
    const st = capture;
    // Openings mode: route to openingTap
    if (st.mode === "door" || st.mode === "window") {
      const r = captureReducer(st, { type: "openingTap", point });
      dispatch({ type: "openingTap", point });
      if (r.error) setHudError(tMeasure(ml, `pill.${r.error}`));
      else setHudError(null);
      return;
    }
    if (st.floorY === null) {
      const r1 = captureReducer(st, { type: "floorHit", point, horizontal });
      dispatch({ type: "floorHit", point, horizontal });
      const skAfterFloor = stepKey(r1.state);
      if (skAfterFloor === "floor") {
        setHudError(tMeasure(ml, "pill.floorFirst"));
        return;
      }
      // Treat same tap as base if routing now expects a base/end.
      if (skAfterFloor === "base" || skAfterFloor === "end") {
        const r2 = captureReducer(r1.state, { type: "baseTap", point });
        dispatch({ type: "baseTap", point });
        if (r2.error) setHudError(r2.error === "bad-tap" ? tMeasure(ml, "pill.badTap") : null);
        else setHudError(null);
        return;
      }
      return;
    }
    const sk = stepKey(st);
    if (sk === "base" || sk === "end") {
      const r = captureReducer(st, { type: "baseTap", point });
      dispatch({ type: "baseTap", point });
      setHudError(r.error === "bad-tap" ? tMeasure(ml, "pill.badTap") : null);
    } else if (sk === "ceiling") {
      // No hit-test needed: tap confirms the ray height live-previewed on the quad.
      const h = ceilingHeightFromCenterRay(
        st.pendingStart,
        st.pendingEnd,
        st.floorY,
        centerRayFromViewInverse(overlayFrameRef.current?.view.viewInverse ?? null),
      );
      if (h === null) {
        setHudError(tMeasure(ml, "pill.badTap"));
        return;
      }
      const r = captureReducer(st, { type: "ceilingConfirm", heightM: h });
      dispatch({ type: "ceilingConfirm", heightM: h });
      if (r.error) setHudError(tMeasure(ml, "pill.badTap"));
      else if (r.state.walls[r.state.walls.length - 1]?.flaggedHeight) setHudError(tMeasure(ml, "pill.checkHeight"));
      else setHudError(null);
    }
  }, [capture, dispatch, ml]);

  /** Shared confirm path for the ceiling pill buttons + input (fix 2). */
  const handleCeilingConfirm = useCallback((heightM: number) => {
    const st = capture;
    if (stepKey(st) !== "ceiling") return;
    const r = captureReducer(st, { type: "ceilingConfirm", heightM });
    dispatch({ type: "ceilingConfirm", heightM });
    if (r.error) setHudError(tMeasure(ml, "pill.badTap"));
    else if (r.state.walls[r.state.walls.length - 1]?.flaggedHeight) setHudError(tMeasure(ml, "pill.checkHeight"));
    else setHudError(null);
  }, [capture, dispatch, ml]);

  function handleStart(): void {
    if (!startGuardRef.current.tryStart()) return;
    const notify = onSessionChangeRef.current;
    const callbacks: XrTapCallbacks = {
      onTapCorner: (corner, horizontal) => handleTapAtomic(corner, horizontal ?? false),
      // No hit-test pose (aiming at the wall/ceiling junction): the tap
      // confirms the ceiling from the camera ray instead of the hit pose.
      onTapEmpty: () => {
        const st = capture;
        if (stepKey(st) !== "ceiling" || st.mode !== "walls") return;
        handleCeilingConfirm(
          ceilingHeightFromCenterRay(
            st.pendingStart,
            st.pendingEnd,
            st.floorY,
            centerRayFromViewInverse(overlayFrameRef.current?.view.viewInverse ?? null),
          ) ?? NaN,
        );
      },
      onHit: (point, horizontal) => {
        // Floor datum may come from continuous hits before the first tap.
        if (capture.floorY === null && horizontal) {
          dispatch({ type: "floorHit", point, horizontal });
        }
      },
      onEnd: () => {
        notify?.(false);
        if (adapter === undefined) prodAdapterRef.current = null;
        startGuardRef.current.reset();
        setSurfaceFound(false);
        setSupport("ar-ready");
      },
      onSurfaceChange: (found) => setSurfaceFound(found),
      onDebugFrame: isArDebugEnabled() ? setDebugFrames : undefined,
      onOverlayFrame: (frame) => { overlayFrameRef.current = frame; },
    };
    const active = adapter ?? new WebXrHitTestAdapter();
    if (adapter === undefined) prodAdapterRef.current = active;
    startStepRef.current = null;
    setStartStep(null);
    setSurfaceFound(false);
    setDebugFrames(null);
    setSupport("starting");
    const onStarted = (): void => { notify?.(true); setSupport("session"); };
    const onFailed = (message: string): void => {
      notify?.(false);
      if (adapter === undefined) prodAdapterRef.current = null;
      startGuardRef.current.reset();
      setStartError(message);
      setSupport("failed");
    };
    const onStep = (step: ArTraceStep): void => { startStepRef.current = step; setStartStep(step); };
    const stuckMessage = (): string => `${t["measure.ar.stuck"]} ${startStepRef.current ?? "?"}`;
    createArStartHandler(active, callbacks, () => (hudRef.current ?? undefined) as HTMLElement | undefined, { onStarted, onFailed, onStep, stuckMessage })();
  }

  function handleUndo(): void {
    dispatch({ type: "undo" });
    setHudError(null);
  }
  function handleStartOver(): void {
    if (!showStartOverConfirm) { setShowStartOverConfirm(true); return; }
    dispatch({ type: "startOver" });
    setShowStartOverConfirm(false);
    setHudError(null);
  }
  function handleModeChange(mode: "walls" | "door" | "window"): void {
    dispatch({ type: "modeChange", mode });
    const r = captureReducer(capture, { type: "modeChange", mode });
    if (r.error === "mode-locked") setHudError(tMeasure(ml, "pill.modeLocked"));
    else setHudError(null);
  }
  function handleDone(): void {
    dispatch({ type: "done" });
    const doneState = captureReducer(capture, { type: "done" }).state;
    const { ops } = toSceneOps(doneState);
    let next = sceneRef.current;
    for (const op of ops) {
      next = applySceneOp(next, op);
      onChange(next, op);
    }
    setReviewCapture(doneState);
    setShowReview(true);
    onDone(next);
    (adapter ?? prodAdapterRef.current)?.end();
    onSessionChangeRef.current?.(false);
  }

  useEffect(() => {
    return () => {
      if (adapter === undefined) { prodAdapterRef.current?.end(); prodAdapterRef.current = null; }
      onSessionChangeRef.current?.(false);
    };
  }, [adapter]);

  const hudShell = <ArHud locale={locale} hudRef={hudRef} shell />;

  if (support === "checking" || support === "ar-ready" || support === "starting") {
    const starting = support === "starting";
    return (
      <>
        {hudShell}
        <div className="ar-measure" role="dialog" aria-label={t["measure.ar.title"]}>
          <h2 className="intake-title">{t["measure.ar.title"]}</h2>
          <p className="intake-hint">{t["measure.ar.hint"]}</p>
          <div className="intake-scale-foot">
            <button type="button" className="btn-primary" onClick={handleStart} disabled={support === "checking" || starting}>
              {t["intake.capture.ar"]}
            </button>
            <button type="button" className="chip" onClick={onCancel}>{t["measure.ar.cancel"]}</button>
          </div>
          {starting && <p className="intake-hint ar-start-step">{startStep ?? t["measure.ar.starting"]}</p>}
          <p className="preliminary">{t["notice.preliminary"]}</p>
        </div>
      </>
    );
  }

  if (support === "failed") {
    return (
      <>
        {hudShell}
        <div className="ar-measure" role="dialog" aria-label={t["measure.ar.title"]}>
          <h2 className="intake-title">{t["measure.ar.title"]}</h2>
          <p className="intake-error" role="alert">{startError ?? t["measure.ar.fallback"]}</p>
          <p className="intake-hint">{t["measure.ar.fallback"]}</p>
          <div className="intake-scale-foot">
            <button type="button" className="btn-primary" onClick={handleStart}>{t["intake.capture.ar"]}</button>
            {onFallbackB && <button type="button" className="chip" onClick={onFallbackB}>{t["intake.kind.plan"]}</button>}
            {onFallbackC && <button type="button" className="chip" onClick={onFallbackC}>{t["intake.kind.sketch"]}</button>}
            <button type="button" className="chip" onClick={onCancel}>{t["measure.ar.cancel"]}</button>
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
          {onFallbackB && <button type="button" className="chip" onClick={onFallbackB}>{t["intake.kind.plan"]}</button>}
          {onFallbackC && <button type="button" className="chip" onClick={onFallbackC}>{t["intake.kind.sketch"]}</button>}
          <button type="button" className="chip" onClick={onCancel}>{t["measure.ar.cancel"]}</button>
        </div>
        <p className="preliminary">{t["notice.preliminary"]}</p>
      </div>
    );
  }

  // Live session: HUD driven by capture state. Corners for overlay derived from capture.
  const overlayCorners: Vec3[] = (() => {
    const out: Vec3[] = [];
    const fy = capture.floorY ?? 0;
    for (const w of capture.walls) {
      if (out.length === 0) out.push([w.start.x, fy, w.start.z]);
      out.push([w.end.x, fy, w.end.z]);
    }
    if (capture.pendingStart) {
      if (out.length === 0) out.push([capture.pendingStart.x, fy, capture.pendingStart.z]);
      else if (capture.walls.length === 0) { /* already */ }
    }
    if (capture.pendingEnd) out.push([capture.pendingEnd.x, fy, capture.pendingEnd.z]);
    return out;
  })();

  // Live ceiling preview (fix 2): ray height from the latest overlay frame.
  // Read during render only — no state, so no 60/s re-renders.
  const previewCeilM = stepKey(capture) === "ceiling"
    ? previewCeilingHeight(capture, overlayFrameRef.current?.view.viewInverse ?? null)
    : null;

  return (
    <>
      <ArHud
        locale={locale}
        hudRef={hudRef}
        overlayFrameRef={overlayFrameRef}
        overlayCorners={overlayCorners}
        capture={capture}
        pillError={hudError}
        measureLocale={ml}
        previewCeilM={previewCeilM}
        onCeilingConfirm={handleCeilingConfirm}
        surfaceFound={surfaceFound}
        debugFrames={debugFrames}
        onUndo={handleUndo}
        onStartOver={handleStartOver}
        onDone={handleDone}
        onModeChange={handleModeChange}
        onCancel={() => { (adapter ?? prodAdapterRef.current)?.end(); onSessionChangeRef.current?.(false); onCancel(); }}
      />
      {showStartOverConfirm && (
        <div className="ar-confirm" role="dialog" aria-label={tMeasure(ml, "confirm.startOver.title")}>
          <p>{tMeasure(ml, "confirm.startOver.title")}</p>
          <p>{tMeasure(ml, "confirm.startOver.body")}</p>
          <button type="button" className="btn-primary" onClick={() => { dispatch({ type: "startOver" }); setShowStartOverConfirm(false); setHudError(null); }}>
            {tMeasure(ml, "confirm.startOver.confirm")}
          </button>
          <button type="button" className="chip" onClick={() => setShowStartOverConfirm(false)}>{tMeasure(ml, "confirm.startOver.cancel")}</button>
        </div>
      )}
      {showReview && reviewCapture && (
        <MeasureReview capture={reviewCapture} locale={ml} onApply={(ops) => { let s = sceneRef.current; for (const op of ops) { s = applySceneOp(s, op); onChange(s, op); } setShowReview(false); }} />
      )}
      {reviewCapture && !showReview && (
        <button type="button" className="chip" onClick={() => setShowReview(true)}>{tMeasure(ml, "review.title")}</button>
      )}
    </>
  );
}
