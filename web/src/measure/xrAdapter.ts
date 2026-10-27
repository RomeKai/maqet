import type * as THREE from "three";
import type { Vec3 } from "./cornerMath";
import { isValidCorner } from "./cornerMath";

/**
 * Callbacks carried by the hit-test session. Length math stays in cornerMath.
 */
export interface XrTapCallbacks {
  onTapCorner: (corner: Vec3) => void;
  onEnd: () => void;
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
 *  7. local-floor-space — the local-floor reference space resolved
 *  8. render-loop-running — the animation loop started (taps now emit)
 */
export const XR_START_STEPS = [
  "session-requested",
  "three-loaded",
  "session-granted",
  "session-set",
  "viewer-space",
  "hit-test-source",
  "local-floor-space",
  "render-loop-running",
] as const;

export type XrStartStep = (typeof XR_START_STEPS)[number];

/** Progress callback for start(): receives each XrStartStep in order. */
export type XrStartProgress = (step: XrStartStep) => void;

/**
 * Watchdog for AR session start: if start() neither resolves nor rejects
 * within this window, the caller surfaces "AR stuck at: <last-step>".
 * On the phone a wedged await shows no camera and no error otherwise.
 */
export const AR_START_WATCHDOG_MS = 10_000;

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
    const xr = nav.xr as XRSystem;
    const overlayRoot = (container ?? host) as HTMLElement;
    const sessionPromise = xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["dom-overlay"],
      domOverlay: { root: overlayRoot },
    });
    onStep?.("session-requested");
    // three.js stays out of the test bundle: only the phone path loads it.
    const THREE = await import("three");
    onStep?.("three-loaded");
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType("local-floor");
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
      this.refSpace = await session.requestReferenceSpace("local-floor");
      onStep?.("local-floor-space");

      const scene = new THREE.Scene();
      const reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.06, 0.075, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x2f5d62 }),
      );
      reticle.matrixAutoUpdate = false;
      reticle.visible = false;
      scene.add(reticle);

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
          if (hit === null) {
            reticle.visible = false;
          } else {
            reticle.visible = true;
            reticle.matrix.fromArray(hit.transform.matrix);
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
