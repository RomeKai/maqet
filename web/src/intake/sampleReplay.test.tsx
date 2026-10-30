import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { getStrings } from "../i18n";
import { postSampleIntake } from "./api";
import { UploadStep } from "./UploadStep";
import type { IntakeResult } from "./api";
import type { Scene } from "../scene/types";

const draftScene: Scene = {
  id: "intake",
  version: 1,
  units: "m",
  scale_confirmed: false,
  ceiling_height_m: 2.6,
  walls: [{ id: "w1", a: [0, 0], b: [6, 0], thickness_m: 0.2, kind: "exterior" }],
  openings: [],
  rooms: [],
};

const result: IntakeResult = {
  proposal: {
    input_kind: "sketch",
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
});

describe("I16 try-a-sample replay", () => {
  it("posts kind + sample without a file and returns the Scene draft", async () => {
    const seen: { url: string; body: FormData | null } = { url: "", body: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: FormData }) => {
        seen.url = url;
        seen.body = init.body;
        return new Response(JSON.stringify(result), { status: 200 });
      }),
    );

    const out = await postSampleIntake("sketch", "croquis_nonproportional");

    expect(seen.url).toBe("/api/intake");
    expect(seen.body?.get("sample")).toBe("croquis_nonproportional");
    expect(seen.body?.get("kind")).toBe("sketch");
    expect(seen.body?.get("file")).toBeNull();
    expect(out.scene).toEqual(draftScene);
  });

  it("surfaces the 409 hint when the sample is unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: "unknown sample 'x': pick one of: a" }), {
            status: 409,
          }),
      ),
    );
    await expect(postSampleIntake("sketch", "x")).rejects.toThrow(/pick one of/);
  });

  it("both locales define the sample button keys", () => {
    for (const locale of ["en", "es-AR"] as const) {
      const t = getStrings(locale);
      expect(t["intake.sample.try"].length).toBeGreaterThan(0);
      expect(t["intake.sample.label"].length).toBeGreaterThan(0);
    }
    expect(getStrings("en")["intake.sample.try"]).not.toBe(
      getStrings("es-AR")["intake.sample.try"],
    );
  });

  it("UploadStep renders a Try-a-sample button next to the upload CTA", () => {
    for (const locale of ["en", "es-AR"] as const) {
      const html = renderToString(
        <UploadStep locale={locale} onPhoto={() => {}} onError={() => {}} />,
      );
      expect(html).toContain(getStrings(locale)["intake.sample.try"]);
    }
  });

  it("the preliminary notice is only in the app footer, not inline", () => {
    const html = renderToString(
      <UploadStep locale="en" onPhoto={() => {}} onError={() => {}} />,
    );
    expect(html).not.toContain(getStrings("en")["notice.preliminary"]);
  });
});

import { SAMPLE_NAME } from "./UploadStep";
import demoProposal from "../../../samples/plans/croquis_3x8_door_window.proposal.json";

describe("sample button fixture", () => {
  it("replays the demo sketch that has a door and a window", () => {
    expect(SAMPLE_NAME).toBe("croquis_3x8_door_window");
    const p = (demoProposal as { proposal: { openings: { kind: string }[] } }).proposal;
    expect(p.openings.map((o) => o.kind).sort()).toEqual(["door", "window"]);
  });
});
