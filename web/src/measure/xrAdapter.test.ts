import { describe, expect, it, vi } from "vitest";
import { isARSupported, NoopAdapter, type XrHitTestAdapter, type XrTapCallbacks } from "./xrAdapter";
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
});
