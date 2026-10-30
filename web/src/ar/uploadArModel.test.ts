import { describe, expect, it, vi } from "vitest";
import { absoluteModelUrl, uploadArModel } from "./uploadArModel";

describe("absoluteModelUrl", () => {
  it("joins the origin, the api base and the server path", () => {
    expect(absoluteModelUrl("https://x.example", "/api", "/ar/model/ab.glb")).toBe("https://x.example/api/ar/model/ab.glb");
  });
  it("keeps an absolute api base as is", () => {
    expect(absoluteModelUrl("https://x.example", "https://api.example", "/ar/model/ab.glb")).toBe(
      "https://api.example/ar/model/ab.glb",
    );
  });
});

describe("uploadArModel", () => {
  const ok = (path: string): typeof fetch =>
    vi.fn(async () => new Response(JSON.stringify({ id: "ab", kind: "glb", path }), { status: 200 })) as unknown as typeof fetch;

  it("posts multipart with the right mime and returns the absolute https URL", async () => {
    const fetchFn = ok("/ar/model/ab.glb");
    const url = await uploadArModel(new ArrayBuffer(8), "glb", { fetchFn, origin: "https://x.example", apiBase: "/api" });
    expect(url).toBe("https://x.example/api/ar/model/ab.glb");
    const [target, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(target).toBe("/api/ar/model");
    expect(init.method).toBe("POST");
    const file = (init.body as FormData).get("file") as File;
    expect(file.type).toBe("model/gltf-binary");
  });

  it("uses the USDZ mime for usdz", async () => {
    const fetchFn = ok("/ar/model/ab.usdz");
    await uploadArModel(new Uint8Array(4), "usdz", { fetchFn, origin: "https://x.example", apiBase: "/api" });
    const init = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(((init.body as FormData).get("file") as File).type).toBe("model/vnd.usdz+zip");
  });

  it("throws on a non-2xx response", async () => {
    const fetchFn = vi.fn(async () => new Response("no", { status: 413 })) as unknown as typeof fetch;
    await expect(uploadArModel(new ArrayBuffer(1), "glb", { fetchFn, origin: "o", apiBase: "/api" })).rejects.toThrow();
  });
});
