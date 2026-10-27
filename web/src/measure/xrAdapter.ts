import type { Vec3 } from "./cornerMath";

/** Callbacks carried by the hit-test session. Length math stays in cornerMath. */
export interface XrTapCallbacks {
  onTapCorner: (corner: Vec3) => void;
  onEnd: () => void;
}

/** Thin seam over WebXR hit-test: start a session, tap corners, end it. */
export interface XrHitTestAdapter {
  start: (callbacks: XrTapCallbacks) => Promise<void>;
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
