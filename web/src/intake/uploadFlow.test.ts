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
    expect(d.onFailure).toHaveBeenCalledWith("replay", expect.stringContaining("409"));
    expect(d.onPhoto).not.toHaveBeenCalled();
    expect(d.onPhase).toHaveBeenLastCalledWith("idle");
  });

  it("reports an unreadable photo when downscale throws", async () => {
    const d = deps(async () => result);
    d.downscale.mockRejectedValueOnce(new Error("No se pudo leer la imagen"));
    await runUpload(file, "plan", d);
    expect(d.onFailure).toHaveBeenCalledWith("photo", expect.any(String));
  });
});
