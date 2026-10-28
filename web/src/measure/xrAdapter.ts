import type * as THREE from "three";
import type { Vec3 } from "./cornerMath";
import { isValidCorner } from "./cornerMath";

/**
 * Callbacks carried by the hit-test session. Length math stays in cornerMath.
 */
export interface XrTapCallbacks {
  onTapCorner: (corner: Vec3) => void;
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
}

/**
 * One await boundary of WebXrHitTestAdapter.start(), in order. Reported
 * through the optional onStep progress callback so a stuck await is visible
 * on the phone (the AR start shows no camera and no error otherwise):
 *  1. session-requested — requestSession() invoked (synchronously, in the
 *     user gesture; NOTHING is awaited before it)
 *  2. three-loaded — the lazy three.js import resolved
 *  3. session-granted — the requestSession promise resolved
 *  4. session-set — the session is set on the three.js renderer
 *  5. viewer-space — the viewer reference space resolved
 *  6. hit-test-source — the hit-test source resolved
 *  7. local-space — the local reference space resolved
 *  8. render-loop-running — the animation loop started (taps now emit)
 *
 * Which session config succeeded is recorded too, when a retry happens
 * (see XrSessionConfigStep): Device 1 rejects `dom-overlay` with
 * NotSupportedError while the plain hit-test config works, so start()
 * retries once without it.
 */
export const XR_START_STEPS = [
  "session-requested",
  "three-loaded",
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
 * Other rejections propagate without a retry. Corner distances are pure
 * hit-test poses, so nothing downstream depends on the overlay.
 * Exported for tests (the full start() needs DOM + WebGL).
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
 * The optional container hosts the XR canvas (production path); the optional
 * onStep reports each XR_START_STEPS entry in order (diagnostic trace).
 * Fakes used in tests keep a one-param start and still satisfy this
 * interface.
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
 * False on iPhone Safari and non-HTTPS contexts: the caller renders the
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
 * Warm the three.js module cache (call when the AR screen mounts, alongside
 * detection): the dynamic import inside start() then resolves fast instead
 * of eating into Chrome's transient-activation window on a cold LAN load.
 * Safe to call anywhere (tests, unsupported devices): a failed preload is
 * swallowed, start() imports three lazily as before.
 */
export function preloadThree(): void {
  void import("three").catch(() => undefined);
}

/**
 * Minimal structural view of a WebXR hit-test pose: the 3D tap point in
 * meters. A full XRPose also carries orientation; Mode A only needs the
 * floor position.
 */
export interface HitTestPoseLike {
  position: { x: number; y: number; z: number };
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
 * `immersive-ar` session with hit-test, holds a reticle at each frame's
 * hit-test pose, and emits `onTapCorner` on every device `select` event.
 * `start` rejects with a normal Error when WebXR is unavailable so the
 * caller falls back to the B/C capture modes. Verified on the phone: the
 * session itself is not mockable in vitest.
 */
export class WebXrHitTestAdapter implements XrHitTestAdapter {
  private session: XRSession | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private hitTestSource: XRHitTestSource | null = null;
  private refSpace: XRReferenceSpace | null = null;

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
    const host =
      container ?? (typeof document !== "undefined" ? document.body : null);
    if (host === null) {
      throw new Error("WebXR needs a DOM container for the XR canvas.");
    }
    // requestSession FIRST, synchronously in the gesture handler: NOTHING is
    // awaited before it (not even the three.js import) so Chrome's transient
    // activation (~5 s, shorter on a cold LAN load) is still alive.
    // three.js should already be warm via preloadThree() at screen mount.
    // The xr guard above narrowed nav.xr to a defined XRSystem.
    // The caller passes the visible AR controls element as `container`
    // (domOverlay.root): End + the step trace stay visible and tappable
    // over the camera feed. The DOM lib types requestSession's options
    // loosely, so the root is cast to the HTMLElement three expects.
    // Device 1 rejects the overlay config with NotSupportedError: the
    // helper retries once with plain hit-test (see requestArSession).
    const xr = nav.xr as XRSystem;
    const overlayRoot = (container ?? host) as HTMLElement;
    const sessionPromise = requestArSession(xr, overlayRoot, onStep);
    // three.js stays out of the test bundle: only the phone path loads it.
    const THREE = await import("three");
    onStep?.("three-loaded");
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.xr.enabled = true;
    // Device 2 has no local-floor (requestReferenceSpace rejects): use
    // local everywhere, like the official immersive-web hit-test sample.
    // Corner distances are pure hit-test poses, floor height is irrelevant.
    renderer.xr.setReferenceSpaceType("local");
    host.appendChild(renderer.domElement);
    this.renderer = renderer;
    try {
      const session = await sessionPromise;
      onStep?.("session-granted");
      await renderer.xr.setSession(session);
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
      this.refSpace = await session.requestReferenceSpace("local");
      onStep?.("local-space");

      const scene = new THREE.Scene();
      // Ring + center dot, sized and colored to read on a live camera feed:
      // larger ring (0.10/0.13, 48 segments), bright amber, semi-transparent,
      // depth test off and top render order so real-world geometry and the
      // transparent dom-overlay never swallow it. Hit logic below untouched.
      const reticleMaterial = new THREE.MeshBasicMaterial({
        color: 0xffc83d,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      });
      const reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 0.13, 48).rotateX(-Math.PI / 2),
        reticleMaterial,
      );
      reticle.matrixAutoUpdate = false;
      reticle.visible = false;
      reticle.renderOrder = 999;
      scene.add(reticle);
      const reticleDot = new THREE.Mesh(
        new THREE.CircleGeometry(0.015, 24).rotateX(-Math.PI / 2),
        reticleMaterial,
      );
      reticleDot.matrixAutoUpdate = false;
      reticleDot.visible = false;
      reticleDot.renderOrder = 999;
      scene.add(reticleDot);
      // Transition-only mirror of the frame loop's hit state: the HUD must
      // show surface feedback even when the 3D ring is invisible (compositor
      // covered it, material culled, opaque overlay on top). Updated on
      // found<->lost edges only so React state changes once per event, not
      // once per XR frame.
      let surfaceFound = false;

      const camera = new THREE.PerspectiveCamera();
      this.session = session;
      session.addEventListener("select", (event: Event) => {
        const frame = (event as XRInputSourceEvent).frame;
        if (!frame) return;
        const corner = this.cornerFromFrame(frame);
        if (corner !== null) callbacks.onTapCorner(corner);
      });
      session.addEventListener("end", () => {
        callbacks.onEnd();
        this.teardown();
      });
      renderer.setAnimationLoop((_, frame) => {
        if (frame) {
          const hit = this.hitFromFrame(frame);
          const found = hit !== null;
          if (hit === null) {
            reticle.visible = false;
            reticleDot.visible = false;
          } else {
            reticle.visible = true;
            reticleDot.visible = true;
            reticle.matrix.fromArray(hit.transform.matrix);
            reticleDot.matrix.fromArray(hit.transform.matrix);
          }
          if (found !== surfaceFound) {
            surfaceFound = found;
            callbacks.onSurfaceChange?.(found);
          }
        }
        renderer.render(scene, camera);
      });
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

  private cornerFromFrame(frame: XRFrame): Vec3 | null {
    const raw = this.hitFromFrame(frame)?.transform.position;
    if (!raw) return null;
    return hitTestPoseToCorner({
      position: { x: raw.x, y: raw.y, z: raw.z },
    });
  }

  private teardown(): void {
    const renderer = this.renderer;
    this.renderer = null;
    this.session = null;
    this.hitTestSource = null;
    this.refSpace = null;
    if (renderer !== null) {
      renderer.setAnimationLoop(null);
      renderer.domElement.remove();
      renderer.dispose();
    }
  }
}
