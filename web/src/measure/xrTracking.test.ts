import { afterEach, describe, expect, it, vi } from "vitest";
import { WebXrHitTestAdapter, type XrTapCallbacks } from "./xrAdapter";

type Tick = (time: number, frame: unknown) => void;

function stub() {
  let tick: Tick | null = null;
  const session = {
    renderState: { baseLayer: null },
    requestReferenceSpace: vi.fn(async () => ({})),
    requestHitTestSource: vi.fn(async () => ({})),
    updateRenderState: vi.fn(),
    requestAnimationFrame: vi.fn((cb: Tick) => {
      tick = cb;
      return 1;
    }),
    cancelAnimationFrame: vi.fn(),
    addEventListener: vi.fn(),
    end: vi.fn(async () => undefined),
  };
  vi.stubGlobal("navigator", { xr: { requestSession: vi.fn(async () => session) } });
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({}) }) });
  vi.stubGlobal("XRWebGLLayer", class {});
  return { runFrame: (frame: unknown) => tick?.(0, frame), session };
}

const view = {
  projectionMatrix: new Float32Array(16),
  transform: { inverse: { matrix: new Float32Array(16) } },
};

afterEach(() => vi.unstubAllGlobals());

describe("tracking state (viewer pose) reaches the HUD", () => {
  it("reports lost and recovered on transitions only", async () => {
    const { runFrame } = stub();
    const onTrackingChange = vi.fn();
    const callbacks: XrTapCallbacks = {
      onTapCorner: () => undefined,
      onEnd: () => undefined,
      onTrackingChange,
    };
    const adapter = new WebXrHitTestAdapter();
    await adapter.start(callbacks, {} as HTMLElement);
    const lost = { getHitTestResults: () => [], getViewerPose: () => null };
    const ok = { getHitTestResults: () => [], getViewerPose: () => ({ views: [view] }) };
    runFrame(ok);
    runFrame(ok);
    runFrame(lost);
    runFrame(lost);
    runFrame(ok);
    expect(onTrackingChange.mock.calls.map((c) => c[0])).toEqual([false, true]);
    adapter.end();
  });
});
