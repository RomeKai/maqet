import { describe, expect, it, vi } from "vitest";
import { runUpload } from "./uploadFlow";
import type { IntakeResult } from "./api";

const result = { proposal: { walls: [] }, scene: { id: "s" }, warnings: [] } as unknown as IntakeResult;
const image = { blob: new Blob(["x"]), width: 10, height: 20 };
const file = new File(["x"], "p.jpg", { type: "image/jpeg" });

function deps(post: () => Promise<IntakeResult>) {
  return {
    downscale: vi.fn(async () => image),
    post: vi.fn(post),
    onPhase: vi.fn(),
    onPhoto: vi.fn(),
    onScene: vi.fn(),
    onFailure: vi.fn(),
  };
}

describe("runUpload (camera and gallery share it)", () => {
  it("downscales, posts to intake and seeds the scene", async () => {
    const d = deps(async () => result);
    await runUpload(file, "sketch", d);
    expect(d.post).toHaveBeenCalledWith(image.blob, "sketch");
    expect(d.onPhoto).toHaveBeenCalledWith(10, 20, image.blob);
    expect(d.onScene).toHaveBeenCalledWith(result);
    expect(d.onFailure).not.toHaveBeenCalled();
    expect(d.onPhase).toHaveBeenLastCalledWith("idle");
  });

  it("reports a replay 409 instead of doing nothing", async () => {
    const d = deps(async () => {
      throw new Error("Server returned 409 on POST /intake: no recorded vision response");
    });
    await runUpload(file, "plan", d);
    expect(d.onFailure).toHaveBeenCalledWith("offline", expect.stringContaining("409"), expect.any(String));
    expect(d.onPhoto).not.toHaveBeenCalled();
    expect(d.onPhase).toHaveBeenLastCalledWith("idle");
  });

  it("reports an unreadable photo when downscale throws", async () => {
    const d = deps(async () => result);
    d.downscale.mockRejectedValueOnce(new Error("No se pudo leer la imagen"));
    await runUpload(file, "plan", d);
    expect(d.onFailure).toHaveBeenCalledWith("process", expect.any(String), expect.any(String));
  });
});

describe("camera and gallery reach the same upload with a downscaled file", () => {
  it("posts the downscaled blob, not the raw file, for either source", async () => {
    for (const name of ["camera.jpg", "gallery.heic"]) {
      const d = deps(async () => result);
      await runUpload(new File(["raw-big"], name), "sketch", d);
      expect(d.downscale).toHaveBeenCalledTimes(1);
      expect(d.post).toHaveBeenCalledWith(image.blob, "sketch");
    }
  });

  it("a decode failure says the photo could not be processed, never server unreachable", async () => {
    const d = deps(async () => result);
    d.downscale.mockRejectedValue(new TypeError("Failed to fetch image bitmap"));
    await runUpload(file, "plan", d);
    expect(d.post).not.toHaveBeenCalled();
    expect(d.onFailure).toHaveBeenCalledWith("process", expect.any(String), expect.stringContaining("TypeError"));
  });

  it("a network failure carries name and message as detail", async () => {
    const d = deps(async () => { throw new TypeError("Failed to fetch"); });
    await runUpload(file, "plan", d);
    expect(d.onFailure).toHaveBeenCalledWith("server", expect.any(String), "TypeError: Failed to fetch");
  });
});
