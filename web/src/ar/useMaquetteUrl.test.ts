import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The test environment is node (no DOM), so hooks are driven through a minimal fake of the two React
// primitives the hook uses. Real effect semantics (run on change, cleanup before re-run and on unmount)
// are reproduced by the harness below.
type Cleanup = void | (() => void);
interface Effect {
  run: () => Cleanup;
  deps: readonly unknown[] | undefined;
  cleanup: Cleanup;
}

const harness = vi.hoisted(() => ({
  state: undefined as unknown,
  effects: [] as Effect[],
  renders: 0,
}));

vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const resolved = typeof initial === "function" ? (initial as () => unknown)() : initial;
    if (harness.renders === 0) harness.state = resolved;
    return [
      harness.state,
      (next: unknown) => {
        harness.state = next;
      },
    ];
  },
  useEffect: (run: () => Cleanup, deps?: readonly unknown[]) => {
    const previous = harness.effects[harness.renders];
    const unchanged = previous && deps && previous.deps && deps.every((d, i) => Object.is(d, previous.deps?.[i]));
    if (unchanged) return;
    previous?.cleanup?.();
    harness.effects[harness.renders] = { run, deps, cleanup: undefined };
  },
}));

import { useMaquetteUrl } from "./useMaquetteUrl";

function render(buffer: ArrayBuffer | Uint8Array | null, mime?: string): string | null {
  harness.renders = 0;
  const url = useMaquetteUrl(buffer, mime);
  for (const effect of harness.effects) {
    if (effect.cleanup === undefined && effect.run) effect.cleanup = effect.run();
  }
  return url;
}

function unmount(): void {
  for (const effect of harness.effects) effect.cleanup?.();
  harness.effects = [];
}

describe("useMaquetteUrl", () => {
  const create = vi.fn();
  const revoke = vi.fn();

  beforeEach(() => {
    harness.state = undefined;
    harness.effects = [];
    harness.renders = 0;
    let n = 0;
    create.mockReset().mockImplementation(() => `blob:maquette-${++n}`);
    revoke.mockReset();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a GLB blob URL once the buffer is available", () => {
    render(new ArrayBuffer(8));
    expect(create).toHaveBeenCalledTimes(1);
    const blob = create.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("model/gltf-binary");
    expect(harness.state).toBe("blob:maquette-1");
  });

  it("creates a USDZ blob URL when given the USDZ mime type", () => {
    render(new Uint8Array(8), "model/vnd.usdz+zip");
    const blob = create.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("model/vnd.usdz+zip");
  });

  it("does nothing while there is no buffer", () => {
    render(null);
    expect(create).not.toHaveBeenCalled();
    expect(harness.state ?? null).toBeNull();
  });

  it("revokes the URL on unmount", () => {
    render(new ArrayBuffer(8));
    unmount();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:maquette-1");
  });

  it("revokes the previous URL when the buffer changes", () => {
    render(new ArrayBuffer(8));
    render(new ArrayBuffer(16));
    expect(revoke).toHaveBeenCalledWith("blob:maquette-1");
    expect(create).toHaveBeenCalledTimes(2);
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:maquette-2");
  });
});
