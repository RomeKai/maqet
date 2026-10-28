import { describe, expect, it, vi } from "vitest";
import {
  hitTestPoseToCorner,
  isARSupported,
  isArDebugEnabled,
  NoopAdapter,
  requestArSession,
  WebXrHitTestAdapter,
  type XrHitTestAdapter,
  type XrStartProgress,
  type XrStartStep,
  type XrSessionConfigStep,
  type XrTapCallbacks,
} from "./xrAdapter";
import type { Vec3 } from "./cornerMath";

/** Fake adapter: injects tapped corners without a device. */
class FakeAdapter implements XrHitTestAdapter {
  started = false;
  ended = false;
  private callbacks: XrTapCallbacks | null = null;

  async start(callbacks: XrTapCallbacks): Promise<void> {
    this.started = true;
    this.callbacks = callbacks;
  }

  tap(corner: Vec3): void {
    this.callbacks?.onTapCorner(corner);
  }

  end(): void {
    this.ended = true;
    this.callbacks?.onEnd();
  }
}

describe("xrAdapter", () => {
  it("isARSupported returns false without navigator.xr", async () => {
    await expect(isARSupported()).resolves.toBe(false);
  });

  it("fake adapter delivers taps and end without a device", async () => {
    const adapter = new FakeAdapter();
    const taps: Vec3[] = [];
    let ended = false;
    await adapter.start({
      onTapCorner: (c) => taps.push(c),
      onEnd: () => {
        ended = true;
      },
    });
    expect(adapter.started).toBe(true);
    adapter.tap([0, 0, 0]);
    adapter.tap([3, 4, 0]);
    adapter.end();
    expect(taps).toHaveLength(2);
    expect(adapter.ended).toBe(true);
    expect(ended).toBe(true);
  });

  it("NoopAdapter starts and ends silently", async () => {
    const adapter = new NoopAdapter();
    const onTapCorner = vi.fn();
    const onEnd = vi.fn();
    await adapter.start({ onTapCorner, onEnd });
    adapter.end();
    expect(onTapCorner).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("onSurfaceChange is optional: fakes without it still satisfy the seam", async () => {
    // A caller may pass onSurfaceChange and an old fake may ignore it; the
    // seam stays non-breaking because the member is optional.
    const adapter = new FakeAdapter();
    const seen: boolean[] = [];
    await adapter.start({
      onTapCorner: () => undefined,
      onEnd: () => undefined,
      onSurfaceChange: (found) => seen.push(found),
    });
    adapter.end();
    expect(seen).toEqual([]);
  });
});

describe("isArDebugEnabled", () => {
  it("is true only for an exact ?arDebug=1 param", () => {
    expect(isArDebugEnabled("?arDebug=1")).toBe(true);
    expect(isArDebugEnabled("?foo=1&arDebug=1")).toBe(true);
    expect(isArDebugEnabled("?arDebug=1&foo=2")).toBe(true);
    expect(isArDebugEnabled("")).toBe(false);
    expect(isArDebugEnabled("?arDebug=0")).toBe(false);
    expect(isArDebugEnabled("?arDebug=1x")).toBe(false);
    expect(isArDebugEnabled("?xarDebug=1")).toBe(false);
  });
});

describe("onDebugFrame seam", () => {
  it("stays optional: a fake without it still satisfies XrHitTestAdapter", async () => {
    // Mirrors the onSurfaceChange optional-seam test above: callers may pass
    // onDebugFrame, old fakes may ignore it, and the seam never breaks.
    const adapter = new FakeAdapter();
    const seen: number[] = [];
    await adapter.start({
      onTapCorner: () => undefined,
      onEnd: () => undefined,
      onDebugFrame: (frames) => seen.push(frames),
    });
    adapter.end();
    expect(seen).toEqual([]);
  });
});

describe("hitTestPoseToCorner", () => {
  it("maps a valid hit-test pose position to Vec3 meters", () => {
    expect(
      hitTestPoseToCorner({ position: { x: 1.5, y: 0, z: -2.25 } }),
    ).toEqual([1.5, 0, -2.25]);
  });

  it("returns null when a component is NaN", () => {
    expect(hitTestPoseToCorner({ position: { x: NaN, y: 0, z: 1 } })).toBeNull();
  });

  it("returns null for non-finite components", () => {
    expect(
      hitTestPoseToCorner({ position: { x: 1, y: Infinity, z: 1 } }),
    ).toBeNull();
    expect(
      hitTestPoseToCorner({ position: { x: 1, y: 0, z: -Infinity } }),
    ).toBeNull();
  });

  it("returns null for a missing pose", () => {
    expect(hitTestPoseToCorner(null)).toBeNull();
    expect(hitTestPoseToCorner(undefined)).toBeNull();
  });
});

describe("WebXrHitTestAdapter", () => {
  it("start rejects cleanly without navigator.xr (caller falls back to B/C)", async () => {
    const adapter = new WebXrHitTestAdapter();
    await expect(
      adapter.start({ onTapCorner: () => undefined, onEnd: () => undefined }),
    ).rejects.toThrow();
    // Ending a never-started adapter is a safe no-op.
    adapter.end();
  });
});

describe("requestArSession", () => {
  const root = {} as HTMLElement;
  const session = {} as XRSession;

  function collectSteps() {
    const seen: Array<XrStartStep | XrSessionConfigStep> = [];
    const onStep: XrStartProgress = (step) => {
      seen.push(step);
    };
    return { seen, onStep };
  }

  it("records session-overlay when the first request succeeds", async () => {
    const xr = {
      requestSession: vi.fn(async () => session),
    } as unknown as XRSystem;
    const { seen, onStep } = collectSteps();
    await expect(requestArSession(xr, root, onStep)).resolves.toBe(session);
    expect(xr.requestSession).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["session-requested", "session-overlay"]);
  });

  it("retries without dom-overlay on NotSupportedError (Device 1)", async () => {
    const rejection = Object.assign(
      new Error("The specified session configuration is not supported"),
      { name: "NotSupportedError" },
    );
    const xr = {
      requestSession: vi
        .fn<(...args: unknown[]) => Promise<XRSession>>()
        .mockRejectedValueOnce(rejection)
        .mockResolvedValueOnce(session),
    } as unknown as XRSystem;
    const { seen, onStep } = collectSteps();
    await expect(requestArSession(xr, root, onStep)).resolves.toBe(session);
    expect(xr.requestSession).toHaveBeenCalledTimes(2);
    // Second call is plain hit-test: no dom-overlay anywhere in its options.
    const secondOptions = (xr.requestSession as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[1]?.[1] as Record<string, unknown>;
    expect(secondOptions).toEqual({ requiredFeatures: ["hit-test"] });
    expect(seen).toEqual(["session-requested", "session-no-overlay"]);
  });

  it("propagates non-NotSupportedError rejections without retrying", async () => {
    const rejection = Object.assign(new Error("need a user gesture"), {
      name: "NotAllowedError",
    });
    const xr = {
      requestSession: vi.fn(async () => {
        throw rejection;
      }),
    } as unknown as XRSystem;
    await expect(requestArSession(xr, root)).rejects.toBe(rejection);
    expect(xr.requestSession).toHaveBeenCalledTimes(1);
  });
});
