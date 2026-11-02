import { describe, expect, it, vi } from "vitest";
import { renderRealLifeViews } from "./realLifeViews";

describe("renderRealLifeViews", () => {
  it("requests one image per guide, in order", async () => {
    const post = vi.fn(async (guide: string | null) => `img-${guide}`);
    const out = await renderRealLifeViews(["a", "b", "c"], post);
    expect(post).toHaveBeenCalledTimes(3);
    expect(out).toEqual({ images: ["img-a", "img-b", "img-c"], failed: 0, firstError: null });
  });
  it("keeps the views that worked when one fails", async () => {
    const post = async (guide: string | null): Promise<string> => {
      if (guide === "b") throw new Error("boom");
      return `img-${guide}`;
    };
    expect(await renderRealLifeViews(["a", "b", "c"], post)).toEqual({ images: ["img-a", "img-c"], failed: 1, firstError: "boom" });
  });
  it("skips views whose capture failed instead of paying for look-alike images", async () => {
    const post = vi.fn(async (guide: string | null) => `img-${guide}`);
    const out = await renderRealLifeViews(["a", null, "c"], post);
    expect(post).toHaveBeenCalledTimes(2);
    expect(out.images).toEqual(["img-a", "img-c"]);
    expect(out.failed).toBe(0);
  });
  it("falls back to one text-only image when no capture worked", async () => {
    const post = vi.fn(async (guide: string | null) => `img-${guide}`);
    const out = await renderRealLifeViews([null, null, null], post);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(null);
    expect(out.images).toEqual(["img-null"]);
  });
  it("reports the error when every view fails", async () => {
    const out = await renderRealLifeViews(["a", "b"], async () => {
      throw new Error("no recorded render");
    });
    expect(out).toEqual({ images: [], failed: 2, firstError: "no recorded render" });
  });
});
