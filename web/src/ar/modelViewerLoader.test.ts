import { describe, expect, it, vi } from "vitest";

describe("loadModelViewer", () => {
  it("resolves true when the model-viewer module imports", async () => {
    vi.resetModules();
    vi.doMock("@google/model-viewer", () => ({}));
    const { loadModelViewer } = await import("./modelViewerLoader");
    await expect(loadModelViewer()).resolves.toBe(true);
  });

  it("resolves false when the import throws", async () => {
    vi.resetModules();
    vi.doMock("@google/model-viewer", () => {
      throw new Error("boom");
    });
    const { loadModelViewer } = await import("./modelViewerLoader");
    await expect(loadModelViewer()).resolves.toBe(false);
  });
});
