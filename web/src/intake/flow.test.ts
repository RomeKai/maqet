import { afterEach, describe, expect, it, vi } from "vitest";
import { postIntake, type IntakeResult } from "./api";
import type { Scene } from "../scene/types";

const draftScene: Scene = {
  id: "intake",
  version: 1,
  units: "m",
  scale_confirmed: false,
  ceiling_height_m: 2.6,
  walls: [
    { id: "w1", a: [0, 0], b: [3, 0], thickness_m: 0.2, kind: "exterior" },
  ],
  openings: [],
  rooms: [],
};

const result: IntakeResult = {
  proposal: {
    input_kind: "plan",
    walls: [{ a: [0, 0], b: [1, 0], kind: "exterior" }],
    openings: [],
    labels: [],
    dimensions: [],
  },
  scene: draftScene,
  warnings: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("postIntake upload -> Scene flow", () => {
  it("posts multipart file + kind and returns the Scene draft", async () => {
    const seen: { url: string; body: FormData | null } = { url: "", body: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: FormData }) => {
        seen.url = url;
        seen.body = init.body;
        return new Response(JSON.stringify(result), { status: 200 });
      }),
    );

    const out = await postIntake(new Blob(["img"]), "plan");

    expect(seen.url).toBe("http://localhost:8000/intake");
    expect(seen.body?.get("kind")).toBe("plan");
    expect(seen.body?.get("file")).toBeInstanceOf(File);
    expect(out.scene).toEqual(draftScene);
    expect(out.proposal.input_kind).toBe("plan");
  });

  it("honors VITE_API_URL as the base", async () => {
    vi.stubEnv("VITE_API_URL", "http://192.168.1.50:8000");
    let seenUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seenUrl = url;
        return new Response(JSON.stringify(result), { status: 200 });
      }),
    );

    await postIntake(new Blob(["img"]), "sketch");
    expect(seenUrl).toBe("http://192.168.1.50:8000/intake");
  });

  it("throws a readable error on HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 422 })));
    await expect(postIntake(new Blob(["img"]), "plan")).rejects.toThrow(/422/);
  });

  it("throws a readable error on an invalid payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 })),
    );
    await expect(postIntake(new Blob(["img"]), "plan")).rejects.toThrow(/invalid/);
  });
});
