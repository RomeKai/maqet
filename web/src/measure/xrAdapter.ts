import type { Vec3 } from "./cornerMath";
import { isValidCorner } from "./cornerMath";

/**
 * One DOM-overlay frame: the current hit-test reticle (null while tracking
 * nothing) plus the viewer matrices the overlay needs to project world
 * corners to screen pixels. Matrices are plain number[] copied once per
 * frame from the XRView Float32Arrays — the overlay must never hold the
 * live XR objects across frames.
 */
export interface OverlayFrame {
  /** Hit-test tap point in meters, null when the hit-test found nothing. */
  reticle: Vec3 | null;
  /** Viewer projection + inverse view, column-major 16-number arrays. */
  view: {
    projection: number[];
    viewInverse: number[];
  };
  /** Overlay viewport in CSS pixels (window size at frame time). */
  viewportW: number;
  viewportH: number;
}

/** Horizontal flag: true when the hit normal is mostly +Y (floor). */
export type HitSurfaceType = "horizontal" | "vertical" | "unknown";

export function isHorizontalHit(
  pose: { orientation?: [number, number, number, number]; normalY?: number } | null | undefined,
): boolean {
  if (!pose) return false;
  if (typeof pose.normalY === "number" && Number.isFinite(pose.normalY)) {
    return pose.normalY > 0.5;
  }
  const q = pose.orientation;
  if (q && q.length === 4 && q.every((v) => Number.isFinite(v))) {
    // Quaternion y-axis rotation: normalY = 1 - 2*(qx^2 + qz^2) for Y-up normal.
    // For a horizontal plane the hit normal is ~+Y.
    const qx = q[0] as number;
    const qz = q[2] as number;
    const normalY = 1 - 2 * (qx * qx + qz * qz);
    return normalY > 0.5;
  }
  return false;
}

export function hitPoseHorizontal(pose: HitTestPoseLike | null | undefined): boolean {
  if (!pose) return false;
  return isHorizontalHit(pose);
}

/**
 * Callbacks carried by the hit-test session. Length math stays in cornerMath.
 */
export interface XrTapCallbacks {
  /**
   * Fired on a session `select` (tap) that produced no hit-test pose — e.g.
   * aiming at the wall/ceiling junction where there is no plane to hit.
   * Optional: steps that need no hit (ceiling height from the camera ray)
   * confirm from this; other steps ignore it. Old fakes omit it.
   */
  onTapEmpty?: () => void;
  onTapCorner: (corner: Vec3, horizontal: boolean) => void;
  /** Per-frame hit payload: position + whether it is horizontal. */
  onHit?: (point: Vec3, horizontal: boolean) => void;
  onEnd: () => void;
  /**
   * Surface presence, reported only on found<->lost transitions (never every
   * frame) so the HUD re-renders once per surface event instead of 60x/s.
   * Optional: fakes and NoopAdapter omit it and the HUD stays on its
   * "searching" copy until the first report — never a breaking change to
   * the seam. Chosen over reusing the onStep progress channel because start
   * steps are one-shot diagnostics ("session requested … granted") while
   * surface presence flaps for the whole session; mixing them would corrupt
   * the stuck-at watchdog trace.
   */
  onSurfaceChange?: (found: boolean) => void;
  /**
   * Debug frame counter, reported ONLY when `isArDebugEnabled()` is true
   * (`?arDebug=1`): the adapter's session rAF loop calls it throttled
   * (~2/s, see AR_DEBUG_REPORT_INTERVAL_MS) so the HUD can prove the first
   * frame actually FLOWED. The start-step trace reports "render-loop-running"
   * at REGISTRATION time, so a dead loop looks healthy without this.
   * Optional: fakes omit it and the HUD shows no debug line.
   */
  onDebugFrame?: (frames: number) => void;
  /**
   * Per-frame overlay payload for the DOM/SVG feedback (Plan B): the
   * adapter projects nothing itself — it hands the reticle plus the viewer
   * matrices to ArOverlay, which draws the reticle ring, corner dots and the
   * rubber band without touching WebGL. Optional: old fakes ignore it and
   * still satisfy the interface, exactly like onSurfaceChange/onDebugFrame.
   */
  onOverlayFrame?: (frame: OverlayFrame) => void;
}

/**
 * One await boundary of WebXrHitTestAdapter.start(), in order. Reported
 * through the optional onStep progress callback so a stuck await is visible
 * on the phone (the AR start shows no camera and no error otherwise):
 *  1. session-requested — requestSession() invoked (synchronously, in the
 *     user gesture; NOTHING is awaited before it)
 *  2. session-granted — the requestSession promise resolved
 *  3. session-set — the session is held by the adapter (no renderer: AR
 *     feedback renders in the DOM overlay, see the WHY note on start())
 *  4. viewer-space — the viewer reference space resolved
 *  5. hit-test-source — the hit-test source resolved
 *  6. local-space — the local reference space resolved
 *  7. render-loop-running — the session rAF loop started (taps now emit)
 *
 * Which session config succeeded is recorded too, when a retry happens
 * (see XrSessionConfigStep): Device 1 rejects `dom-overlay` with
 * NotSupportedError while the plain hit-test config works, so start()
 * retries once without it.
 */
export const XR_START_STEPS = [
  "session-requested",
  "session-granted",
  "session-set",
  "viewer-space",
  "hit-test-source",
  "local-space",
  "render-loop-running",
] as const;

export type XrStartStep = (typeof XR_START_STEPS)[number];

/**
 * Session-config outcome reported in the trace when start() retries:
 * `session-overlay` = granted with dom-overlay on the first try,
 * `session-no-overlay` = the overlay config was rejected and the plain
 * hit-test retry succeeded. Only one of them is ever reported.
 */
export const XR_SESSION_CONFIG_STEPS = [
  "session-overlay",
  "session-no-overlay",
] as const;

export type XrSessionConfigStep = (typeof XR_SESSION_CONFIG_STEPS)[number];

/**
 * True only when the URL carries the AR debug flag (`?arDebug=1`): the
 * production adapter counts session rAF frames and ArMeasure surfaces the
 * count in the HUD. Pure helper (no window access when `search` is passed),
 * unit-tested.
 */
export function isArDebugEnabled(search?: string): boolean {
  const query =
    search ?? (typeof window !== "undefined" ? window.location.search : "");
  return /(?:^|[?&])arDebug=1(?:&|$)/.test(query);
}

/** Throttle for the debug frame counter: ~2 HUD updates/s, never 60/s. */
export const AR_DEBUG_REPORT_INTERVAL_MS = 500;

/** Progress callback for start(): each start step plus the session-config outcome, in order. */
export type XrStartProgress = (
  step: XrStartStep | XrSessionConfigStep,
) => void;

/**
 * Watchdog for AR session start: if start() neither resolves nor rejects
 * within this window, the caller surfaces "AR stuck at: <last-step>".
 * On the phone a wedged await shows no camera and no error otherwise.
 */
export const AR_START_WATCHDOG_MS = 10_000;

/**
 * Request the immersive-ar session, synchronously in the user gesture.
 * Device 1 rejects the dom-overlay config with NotSupportedError while the
 * official hit-test sample works there: retry once with plain hit-test
 * (requiredFeatures only) and report which config succeeded in the trace.
 * Other rejections propagate without a retry.
 * Exported for tests (the full start() needs a device).
 */
export async function requestArSession(
  xr: XRSystem,
  overlayRoot: HTMLElement,
  onStep?: XrStartProgress,
): Promise<XRSession> {
  onStep?.("session-requested");
  try {
    const session = await xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["dom-overlay"],
      domOverlay: { root: overlayRoot },
    });
    onStep?.("session-overlay");
    return session;
  } catch (error: unknown) {
    if (!(error instanceof Error) || error.name !== "NotSupportedError") {
      throw error;
    }
    const session = await xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
    });
    onStep?.("session-no-overlay");
    return session;
  }
}

/**
 * Thin seam over WebXR hit-test: start a session, tap corners, end it.
 * The optional container is the domOverlay.root (HUD div, production path).
 * The optional onStep reports each XR_START_STEPS entry in order (diagnostic
 * trace), and the optional onOverlayFrame carries per-frame DOM-overlay
 * payloads. Fakes used in tests keep a one-param start and still satisfy
 * this interface.
 */
export interface XrHitTestAdapter {
  start: (
    callbacks: XrTapCallbacks,
    container?: HTMLElement,
    onStep?: XrStartProgress,
  ) => Promise<void>;
  end: () => void;
}

/**
 * True when the browser can run immersive AR (WebXR hit-test on HTTPS).
 * False on iPhone Safari and non-secure contexts: the caller renders the
 * measure.fallback UI with the B/C capture modes instead.
 */
export async function isARSupported(): Promise<boolean> {
  try {
    const nav = globalThis.navigator as Navigator & {
      xr?: { isSessionSupported: (mode: string) => Promise<boolean> };
    };
    if (typeof nav === "undefined" || !nav.xr?.isSessionSupported) return false;
    if (!globalThis.isSecureContext) return false;
    return await nav.xr.isSessionSupported("immersive-ar");
  } catch {
    return false;
  }
}

/** Fallback adapter for unsupported devices: starts and ends immediately. */
export class NoopAdapter implements XrHitTestAdapter {
  async start(_callbacks: XrTapCallbacks): Promise<void> {
    return;
  }

  end(): void {
    return;
  }
}

/**
 * Minimal structural view of a WebXR hit-test pose: the 3D tap point in
 * meters. A full XRPose also carries orientation; Mode A only needs the
 * floor position. `orientation` is the hit-plane normal (quaternion-derived
 * +Y for horizontal surfaces) when available.
 */
export interface HitTestPoseLike {
  position: { x: number; y: number; z: number };
  /** Hit-plane normal Y component in world space: ~+1 for horizontal (floor). */
  normalY?: number;
  /** Raw quaternion [x,y,z,w] when the device exposes hit orientation. */
  orientation?: [number, number, number, number];
}

/**
 * Map a hit-test pose to a Scene corner in meters.
 * Returns null for a missing pose or any non-finite component (the caller
 * keeps tracking and asks for another tap).
 */
export function hitTestPoseToCorner(
  pose: HitTestPoseLike | null | undefined,
): Vec3 | null {
  if (pose === null || pose === undefined) return null;
  if (pose.position === null || pose.position === undefined) {
    throw new Error("Hit-test pose has no position.");
  }
  const corner: Vec3 = [pose.position.x, pose.position.y, pose.position.z];
  return isValidCorner(corner) ? corner : null;
}

/**
 * Production WebXR hit-test adapter (Mode A, ADR-025): opens an
 * `immersive-ar` session with hit-test and emits `onTapCorner` on every
 * device `select` event. `start` rejects with a normal Error when WebXR is
 * unavailable so the caller falls back to the B/C capture modes. Verified
 * on the phone: the session itself is not mockable in vitest.
 *
 * WHY the transparent baseLayer (Plan B): an immersive session with no
 * renderState.baseLayer never runs its requestAnimationFrame callbacks — no
 * frames, no hit-test, no overlay. three r186 would pick XRProjectionLayer
 * when the device exposes createProjectionLayer, and on the test
 * Android/Chrome the compositor never presents it (verified: a raw-WebGL
 * hit-test sample renders, three's official webxr_ar_hittest shows camera
 * only). So the adapter mirrors the proven immersive-web sample instead:
 * its own canvas, `webgl` context with xrCompatible, and
 * session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) })
 * BEFORE the first rAF. Each frame binds the layer framebuffer and clears
 * transparent (nothing is ever drawn — the SVG overlay does the visuals).
 * three.js stays for the 3D view outside AR only. web/xr-test.html is kept
 * as the dev AR diagnostic.
 */
export class WebXrHitTestAdapter implements XrHitTestAdapter {
  private session: XRSession | null = null;
  private hitTestSource: XRHitTestSource | null = null;
  private refSpace: XRReferenceSpace | null = null;
  private rafHandle = 0;
  private live = false;
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;

  async start(
    callbacks: XrTapCallbacks,
    container?: HTMLElement,
    onStep?: XrStartProgress,
  ): Promise<void> {
    const nav = globalThis.navigator as
      | (Navigator & { xr?: XRSystem })
      | undefined;
    if (
      typeof nav === "undefined" ||
      typeof nav.xr === "undefined" ||
      typeof nav.xr.requestSession !== "function"
    ) {
      throw new Error("WebXR immersive-ar is not available on this device.");
    }
    if (globalThis.isSecureContext === false) {
      throw new Error("WebXR needs a secure context (HTTPS).");
    }
    if (typeof document === "undefined") {
      throw new Error("WebXR needs a DOM container for the XR session.");
    }
    // requestSession FIRST, synchronously in the gesture handler: NOTHING is
    // awaited before it so Chrome's transient activation (~5 s) is still
    // alive. requestArSession is invoked but NOT awaited yet: the promise
    // settles below while the awaits stay inside the try (teardown on any
    // later failure). The xr guard above narrowed nav.xr to XRSystem.
    // The caller passes the HUD div as `container`: it becomes the
    // domOverlay.root (End + the step trace stay visible and tappable over
    // the camera feed). Device 1 rejects the overlay config with
    // NotSupportedError: the helper retries once with plain hit-test (see
    // requestArSession). Corner distances are pure hit-test poses, so
    // nothing downstream depends on the overlay.
    const xr = nav.xr as XRSystem;
    const overlayRoot = (container ?? document.body) as HTMLElement;
    const sessionPromise = requestArSession(xr, overlayRoot, onStep);
    try {
      const session = await sessionPromise;
      onStep?.("session-granted");
      // The session is held by the adapter; no renderer takes it over.
      this.session = session;
      this.live = true;
      onStep?.("session-set");
      const viewerSpace = await session.requestReferenceSpace("viewer");
      onStep?.("viewer-space");
      // The DOM lib types requestHitTestSource as optional: a device that
      // offers immersive-ar without hit-test fails loudly here so the
      // caller falls back to B/C instead of tapping into the void.
      if (typeof session.requestHitTestSource !== "function") {
        throw new Error("This device offers AR but not hit-test.");
      }
      this.hitTestSource =
        (await session.requestHitTestSource({ space: viewerSpace })) ?? null;
      onStep?.("hit-test-source");
      const refSpace = await session.requestReferenceSpace("local");
      this.refSpace = refSpace;
      onStep?.("local-space");

      // Transparent baseLayer BEFORE the first rAF: without it the session
      // never runs frame callbacks (no hit-test, no overlay). Mirrors the
      // immersive-web hit-test sample. The canvas is never appended to the
      // DOM — this context only feeds the compositor.
      this.canvas = document.createElement("canvas");
      const gl = this.canvas.getContext("webgl", {
        alpha: true,
        xrCompatible: true,
      }) as WebGLRenderingContext | null;
      if (gl === null) {
        this.canvas = null;
        throw new Error("WebGL context is not available for the AR session.");
      }
      const baseLayer = new XRWebGLLayer(session, gl);
      session.updateRenderState({ baseLayer });
      this.gl = gl;

      // Transition-only mirror of the frame loop's hit state: the HUD must
      // show surface feedback even though there is no 3D ring anymore.
      // Updated on found<->lost edges only so React state changes once per
      // event, not once per XR frame.
      let surfaceFound = false;
      // Frame counter behind `onDebugFrame` (arDebug only, throttled to
      // ~2 reports/s): proves the first frame FLOWED, not just that the
      // loop was registered. Same reporting shape as onSurfaceChange
      // (throttled callback, never 60 setStates/s).
      const debugEnabled = isArDebugEnabled();
      let frames = 0;
      let lastDebugReport = 0;

      session.addEventListener("select", (event: Event) => {
        const frame = (event as XRInputSourceEvent).frame;
        if (!frame) return;
        const hit = this.hitFromFrame(frame);
        if (hit === null) {
          // No hit-test pose (e.g. aiming at the wall/ceiling junction):
          // the tap still confirms steps that need no hit, like ceiling.
          callbacks.onTapEmpty?.();
          return;
        }
        const corner = this.cornerFromVec(hit.transform.position);
        if (corner === null) return;
        const horizontal = this.isHorizontalPose(hit);
        callbacks.onTapCorner(corner, horizontal);
      });
      session.addEventListener("end", () => {
        callbacks.onEnd();
        this.teardown();
      });
      // The loop runs on the session itself: no renderer, no canvas. Each
      // frame reports hit presence (transition-only), the debug count, and
      // the overlay payload (reticle + viewer matrices copied to plain
      // number[]). A missing viewer pose skips the overlay callback but
      // keeps hit-test going — taps never depend on the matrices.
      const tick = (time: number, frame: XRFrame): void => {
        if (!this.live) return;
        const sessionNow = this.session;
        const glNow = this.gl;
        if (sessionNow === null || glNow === null) return;
        // Present a transparent frame: the compositor needs a bound
        // framebuffer with cleared alpha, or nothing shows. Nothing is drawn.
        const layer = sessionNow.renderState.baseLayer;
        if (layer !== null && layer !== undefined) {
          glNow.bindFramebuffer(
            glNow.FRAMEBUFFER,
            layer.framebuffer as WebGLFramebuffer,
          );
          glNow.clearColor(0, 0, 0, 0);
          glNow.clear(glNow.COLOR_BUFFER_BIT);
        }
        const hit = this.hitFromFrame(frame);
        // Emit per-frame hit with horizontal flag (F1): floorHit only fires on horizontal.
        if (hit !== null) {
          const p = hit.transform.position;
          const pt = hitTestPoseToCorner({ position: { x: p.x, y: p.y, z: p.z } });
          if (pt !== null) callbacks.onHit?.(pt, this.isHorizontalPose(hit));
        }
        const found = hit !== null;
        if (found !== surfaceFound) {
          surfaceFound = found;
          callbacks.onSurfaceChange?.(found);
        }
        if (debugEnabled) {
          frames += 1;
          if (time - lastDebugReport >= AR_DEBUG_REPORT_INTERVAL_MS) {
            lastDebugReport = time;
            callbacks.onDebugFrame?.(frames);
          }
        }
        const view = frame.getViewerPose(refSpace)?.views[0];
        if (view !== undefined) {
          const raw = hit?.transform.position;
          callbacks.onOverlayFrame?.({
            reticle:
              raw === undefined || raw === null
                ? null
                : hitTestPoseToCorner({
                    position: { x: raw.x, y: raw.y, z: raw.z },
                  }),
            view: {
              projection: Array.from(view.projectionMatrix),
              viewInverse: Array.from(view.transform.inverse.matrix),
            },
            viewportW: window.innerWidth,
            viewportH: window.innerHeight,
          });
        }
        if (this.live) {
          this.rafHandle = session.requestAnimationFrame(tick);
        }
      };
      this.rafHandle = session.requestAnimationFrame(tick);
      onStep?.("render-loop-running");
    } catch (error) {
      this.teardown();
      throw error;
    }
  }

  end(): void {
    const session = this.session;
    this.session = null;
    if (session !== null) {
      // The session "end" event finishes teardown via onEnd.
      session.end().catch(() => undefined);
    } else {
      this.teardown();
    }
  }

  private hitFromFrame(frame: XRFrame): XRPose | null {
    const source = this.hitTestSource;
    const refSpace = this.refSpace;
    if (source === null || refSpace === null) return null;
    const results = frame.getHitTestResults(source);
    if (results.length === 0) return null;
    return results[0]?.getPose(refSpace) ?? null;
  }

  private cornerFromVec(raw: { x: number; y: number; z: number } | undefined | null): Vec3 | null {
    if (!raw) return null;
    return hitTestPoseToCorner({ position: { x: raw.x, y: raw.y, z: raw.z } });
  }

  private isHorizontalPose(hit: XRPose | null): boolean {
    if (!hit) return false;
    const o = hit.transform.orientation as unknown as { x: number; y: number; z: number; w: number } | undefined;
    if (o && Number.isFinite(o.x) && Number.isFinite(o.z) && Number.isFinite(o.w)) {
      return isHorizontalHit({ orientation: [o.x, o.y, o.z, o.w] });
    }
    return false;
  }

  private teardown(): void {
    this.live = false;
    const session = this.session;
    const rafHandle = this.rafHandle;
    this.rafHandle = 0;
    this.session = null;
    this.hitTestSource = null;
    this.refSpace = null;
    this.canvas = null;
    this.gl = null;
    if (session !== null && rafHandle !== 0) {
      // The session may already be ended (device End button, "end" event
      // path): cancelling then throws, which is harmless here.
      try {
        session.cancelAnimationFrame(rafHandle);
      } catch {
        // Session already ended; nothing to cancel.
      }
    }
  }
}
