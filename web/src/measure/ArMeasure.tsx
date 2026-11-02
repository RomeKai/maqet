import { useCallback, useEffect, useRef, useState } from "react";
import { MeasureReview } from "./MeasureReview";
import type { Scene } from "../scene/types";
import type { CaptureError } from "./captureSession";
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
  type CaptureEvent,
  type CaptureResult,
  stepKey,
  openingStepKey,
  toHandoffOps,
  type CaptureState,
} from "./captureSession";
import {
  ceilingHeightFromCenterRay,
  centerRayFromViewInverse,
  resolveFloorTap,
  wallPointFromRay,
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
import { classifyArError, arErrorKey } from "./arErrors";
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
  /** Camera tracking lost: the pill tells the user to move slowly. */
  trackingLost?: boolean;
  /** Live ray height on the ceiling step (written via overlay frame, no setState/frame). */
  previewCeilM?: number | null;
  onCeilingConfirm?: (heightM: number) => void;
  /** Per-wall override: type a height for one wall (sloped/uneven ceilings). */
  onWallHeight?: (wallId: string, heightM: number) => void;
  /** Confirm the height currently under the crosshair (DOM button: always registers). */
  onCeilingRay?: () => void;
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
  trackingLost = false,
  onCeilingConfirm = noopArHudActionNumber,
  onWallHeight,
  onCeilingRay,
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
    const openingTool = capture.mode === "door" || capture.mode === "window";
    const stepLabelWalls = openingTool
      ? tMeasure(ml, `step.${openingStepKey(capture)}`, { kind: modeLabel(ml, capture.mode).toLowerCase() })
      : stepKeyLabel(ml, sk, wallN);
    const pill = trackingLost ? t["measure.ar.err.tracking"] : (pillError ?? stepLabelWalls);
    const canUndo = capture.past.length > 0;
    const canStartOver = capture.walls.length > 0 || capture.pendingStart !== null;
    const modeUnlocked = capture.walls.length > 0 || capture.closed || capture.finished;
    const isWalls = capture.mode === "walls";
    const ceilingStep = sk === "ceiling" && !openingTool;
    const lastWall = capture.walls[capture.walls.length - 1];
    const lang = ml === "en" ? "en" : "es-AR";
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
            openings={capture.openings}
            pendingOpening={capture.pendingOpening}
            openingTool={openingTool}
          />
        )}
        {(ceilingStep || openingTool) && <div className="ar-hud-crosshair" aria-hidden="true" />}
        <p className="ar-hud-pill" role="status">
          {pill}
          {ceilingStep && previewCeilM !== null ? ` · ${formatMeasureM(lang, previewCeilM)}` : ""}
        </p>
        {ceilingStep && (
          <div className="ar-hud-ceiling" data-xr-ui role="group" aria-label={tMeasure(ml, "ceiling.typeLabel")}>
            <button type="button" className="chip chip-primary ar-hud-setheight" onClick={() => onCeilingRay?.()}>
              {tMeasure(ml, "ceiling.setHere")}
            </button>
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
        {!ceilingStep && isWalls && !capture.done && !capture.finished && lastWall !== undefined && (
          <details className="ar-hud-wallheight" data-xr-ui>
            <summary className="chip">
              {tMeasure(ml, "wallHeight.summary", {
                n: capture.walls.length,
                h: formatMeasureM(lang, lastWall.heightM ?? 0),
              })}
            </summary>
            <form
              className="ar-hud-ceiling-form"
              onSubmit={(e) => {
                e.preventDefault();
                const input = (e.currentTarget.elements.namedItem("wallh") as HTMLInputElement | null)?.value ?? "";
                const n = parseTypedHeightM(input);
                if (n !== null) onWallHeight?.(lastWall.id, n);
              }}
            >
              <label className="ar-hud-ceiling-label" htmlFor="ar-wallh-input">
                {tMeasure(ml, "wallHeight.label", { n: capture.walls.length })}
              </label>
              <input id="ar-wallh-input" name="wallh" className="ar-hud-ceiling-input" inputMode="decimal" placeholder={tMeasure(ml, "ceiling.typePlaceholder")} />
              <button type="submit" className="chip chip-primary">{tMeasure(ml, "wallHeight.set")}</button>
            </form>
          </details>
        )}
        {debugFrames !== null && <p className="ar-hud-debug" role="status">{`frames: ${debugFrames}`}</p>}
        <div className="ar-hud-bar" data-xr-ui>
          <div className="ar-hud-row ar-hud-bar-modes" role="group" aria-label={t["measure.ar.title"]}>
            {(["walls", "door", "window"] as const).map((m) => {
              const disabled = (m === "door" || m === "window") && !modeUnlocked;
              const active = capture.mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  className={`chip${active ? " chip-active" : ""}`}
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => onModeChange?.(m)}
                >
                  {modeLabel(ml, m as never)}
                </button>
              );
            })}
          </div>
          <div className="ar-hud-row">
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
  // The XR callbacks are created once at session start, so they must read the
  // LATEST state through a ref (a closure over `capture` would freeze the
  // initial empty state and every tap would restart the flow).
  const [capture, setCapture] = useState<CaptureState>(() => initialCaptureState());
  const captureRef = useRef<CaptureState>(capture);
  const send = useCallback((event: CaptureEvent): CaptureResult => {
    const result = captureReducer(captureRef.current, event);
    captureRef.current = result.state;
    setCapture(result.state);
    return result;
  }, []);
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
  const [trackingLost, setTrackingLost] = useState(false);
  const [debugFrames, setDebugFrames] = useState<number | null>(null);
  const overlayFrameRef = useRef<OverlayFrame | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const onSessionChangeRef = useRef(onSessionChange);
  onSessionChangeRef.current = onSessionChange;
  const prodAdapterRef = useRef<XrHitTestAdapter | null>(null);
  const startGuardRef = useRef(createStartGuard());
  const sceneRef = useRef<Scene>(scene);
  const doneSceneRef = useRef<Scene | null>(null);
  sceneRef.current = scene;

  useEffect(() => {
    if (adapter) return;
    let cancelled = false;
    isARSupported().then((ok) => { if (!cancelled) setSupport(ok ? "ar-ready" : "unsupported"); });
    return () => { cancelled = true; };
  }, [adapter]);

  /** Map a rejected reducer event to the HUD pill (null clears it). */
  const pillFor = useCallback((error: CaptureError | null): string | null => {
    if (error === null) return null;
    if (error === "bad-height") return tMeasure(ml, "pill.badHeight");
    if (error === "mode-locked") return tMeasure(ml, "pill.modeLocked");
    if (error === "floor-first") return tMeasure(ml, "pill.floorFirst");
    if (error === "opening-no-wall") return tMeasure(ml, "pill.aimWall");
    if (error === "opening-outside") return tMeasure(ml, "pill.openingOutside");
    if (error === "opening-degenerate") return tMeasure(ml, "pill.openingDegenerate");
    if (error === "opening-too-narrow") return tMeasure(ml, "pill.openingNarrow");
    return tMeasure(ml, "pill.badTap");
  }, [ml]);

  /** Center-screen camera ray from the latest overlay frame (null before the first frame). */
  const currentRay = useCallback(
    () => centerRayFromViewInverse(overlayFrameRef.current?.view.viewInverse ?? null),
    [],
  );

  /** Ceiling height under the crosshair, from the camera ray against the pending wall plane. */
  const rayCeilingHeight = useCallback((): number | null => {
    const st = captureRef.current;
    return ceilingHeightFromCenterRay(st.pendingStart, st.pendingEnd, st.floorY, currentRay());
  }, [currentRay]);

  /** Confirm the height shown under the crosshair (the "Set height here" button and a world tap). */
  const confirmRayHeight = useCallback((): void => {
    const st = captureRef.current;
    if (stepKey(st) !== "ceiling") return;
    const h = rayCeilingHeight();
    if (h === null) {
      setHudError(tMeasure(ml, "pill.aimCeiling"));
      return;
    }
    const result = send({ type: "ceilingConfirm", heightM: h });
    setHudError(result.error === "bad-height" ? tMeasure(ml, "pill.aimCeiling") : pillFor(result.error));
  }, [rayCeilingHeight, send, pillFor, ml]);

  /**
   * One entry for every in-session tap, with or without a hit-test pose. The tap never depends on a
   * hit-test: the height uses the camera ray, openings use the ray against the captured walls, and
   * floor corners fall back to the ray's floor intersection when the pose is on a wall or ceiling.
   */
  // Chrome also fires an XR "select" for a finger on a DOM-overlay control. Cancelling
  // beforexrselect on the HUD controls keeps Undo / Done / typing from becoming a world tap.
  useEffect(() => {
    const onBeforeSelect = (event: Event): void => {
      const target = event.target as Element | null;
      if (target !== null && typeof target.closest === "function" && target.closest("[data-xr-ui]") !== null) {
        event.preventDefault();
      }
    };
    document.addEventListener("beforexrselect", onBeforeSelect);
    return () => document.removeEventListener("beforexrselect", onBeforeSelect);
  }, []);

  const handleWorldTap = useCallback((hit: Vec3 | null, horizontal: boolean) => {
    const st = captureRef.current;
    if (st.mode === "door" || st.mode === "window") {
      if (st.floorY === null) return;
      const onWall = wallPointFromRay(st.walls, st.floorY, currentRay());
      if (onWall === null) {
        setHudError(tMeasure(ml, "pill.aimWall"));
        return;
      }
      setHudError(pillFor(send({ type: "openingTap", point: onWall.point, defaults: true }).error));
      return;
    }
    if (st.floorY === null) {
      if (hit === null) return;
      const r1 = send({ type: "floorHit", point: hit, horizontal });
      if (stepKey(r1.state) === "floor") {
        setHudError(tMeasure(ml, "pill.floorFirst"));
        return;
      }
      // Treat the same tap as the first base once the floor datum exists.
      setHudError(pillFor(send({ type: "baseTap", point: hit }).error));
      return;
    }
    const sk = stepKey(st);
    if (sk === "base" || sk === "end") {
      const floorPoint = resolveFloorTap(hit, st.floorY, currentRay());
      if (floorPoint === null) {
        setHudError(tMeasure(ml, "pill.aimFloor"));
        return;
      }
      setHudError(pillFor(send({ type: "baseTap", point: floorPoint }).error));
    } else if (sk === "ceiling") {
      confirmRayHeight();
    }
  }, [send, pillFor, ml, currentRay, confirmRayHeight]);

  /** Per-wall override typed by the user. */
  const handleWallHeight = useCallback((wallId: string, heightM: number) => {
    setHudError(pillFor(send({ type: "setWallHeight", wallId, heightM }).error));
  }, [send, pillFor]);

  /** Single room-height confirm: ray tap, typed value or the 2.60 m default. */
  const handleCeilingConfirm = useCallback((heightM: number) => {
    if (stepKey(captureRef.current) !== "ceiling") return;
    setHudError(pillFor(send({ type: "ceilingConfirm", heightM }).error));
  }, [send, pillFor]);

  function handleStart(): void {
    if (!startGuardRef.current.tryStart()) return;
    const notify = onSessionChangeRef.current;
    const callbacks: XrTapCallbacks = {
      onTapCorner: (corner, horizontal) => handleWorldTap(corner, horizontal ?? false),
      // No hit-test pose (aiming at the wall/ceiling junction): the tap
      // confirms the ceiling from the camera ray instead of the hit pose.
      onTapEmpty: () => handleWorldTap(null, false),
      onHit: (point, horizontal) => {
        // Floor datum may come from continuous hits before the first tap.
        if (captureRef.current.floorY === null && horizontal) {
          send({ type: "floorHit", point, horizontal });
        }
      },
      onEnd: () => {
        notify?.(false);
        if (adapter === undefined) prodAdapterRef.current = null;
        startGuardRef.current.reset();
        setSurfaceFound(false);
        setTrackingLost(false);
        setSupport("ar-ready");
      },
      onSurfaceChange: (found) => setSurfaceFound(found),
      onTrackingChange: (ok) => setTrackingLost(!ok),
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
    send({ type: "undo" });
    setHudError(null);
  }
  function handleStartOver(): void {
    if (!showStartOverConfirm) { setShowStartOverConfirm(true); return; }
    send({ type: "startOver" });
    setShowStartOverConfirm(false);
    setHudError(null);
  }
  function handleModeChange(mode: "walls" | "door" | "window"): void {
    setHudError(pillFor(send({ type: "modeChange", mode }).error));
  }
  function handleDone(): void {
    const doneState = send({ type: "done" }).state;
    let next = sceneRef.current;
    for (const op of toHandoffOps(doneState)) {
      next = applySceneOp(next, op);
      onChange(next, op);
    }
    doneSceneRef.current = next;
    // End the XR session first, then show the review on a normal page.
    (adapter ?? prodAdapterRef.current)?.end();
    onSessionChangeRef.current?.(false);
    setReviewCapture(doneState);
    setShowReview(true);
  }

  /** Review finished (edits applied or skipped): hand the Scene to the editor. */
  function finishReview(ops: SceneOp[]): void {
    let next = doneSceneRef.current ?? sceneRef.current;
    for (const op of ops) {
      next = applySceneOp(next, op);
      onChange(next, op);
    }
    doneSceneRef.current = next;
    setShowReview(false);
    onDone(next);
  }

  useEffect(() => {
    return () => {
      if (adapter === undefined) { prodAdapterRef.current?.end(); prodAdapterRef.current = null; }
      onSessionChangeRef.current?.(false);
    };
  }, [adapter]);

  if (showReview && reviewCapture !== null) {
    return (
      <MeasureReview
        capture={reviewCapture}
        locale={ml}
        onApply={finishReview}
        onSkip={() => finishReview([])}
      />
    );
  }

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
          <p className="intake-error" role="alert">{t[arErrorKey(classifyArError(startError ?? ""))]}</p>
          {startError !== null && <p className="intake-hint ar-error-detail">{startError}</p>}
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
        trackingLost={trackingLost}
        onCeilingConfirm={handleCeilingConfirm}
        onCeilingRay={confirmRayHeight}
        onWallHeight={handleWallHeight}
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
          <button type="button" className="btn-primary" onClick={() => { send({ type: "startOver" }); setShowStartOverConfirm(false); setHudError(null); }}>
            {tMeasure(ml, "confirm.startOver.confirm")}
          </button>
          <button type="button" className="chip" onClick={() => setShowStartOverConfirm(false)}>{tMeasure(ml, "confirm.startOver.cancel")}</button>
        </div>
      )}
    </>
  );
}
