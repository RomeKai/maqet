import { afterEach, describe, expect, it, vi } from "vitest";
import { postIntake, postSampleIntake } from "./api";
import { classifyUploadError } from "./uploadError";

function stubFetch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("intake endpoints", () => {
  it("a real photo posts the file and never a sample name", async () => {
    const f = stubFetch();
    await postIntake(new Blob(["x"]), "plan").catch(() => {});
    const body = f.mock.calls[0]![1].body as FormData;
    expect(body.get("file")).toBeInstanceOf(Blob);
    expect(body.has("sample")).toBe(false);
  });
  it("the sample button posts a sample name and no file", async () => {
    const f = stubFetch();
    await postSampleIntake("sketch", "croquis_3x8_door_window").catch(() => {});
    const body = f.mock.calls[0]![1].body as FormData;
    expect(body.get("sample")).toBe("croquis_3x8_door_window");
    expect(body.has("file")).toBe(false);
  });
});

describe("offline replay server and a real photo", () => {
  it("is not reported as a missing sample", () => {
    const msg =
      "Server returned 409 on POST /intake: no recorded vision response for this upload (x): pick a recorded sample or record it in live mode";
    expect(classifyUploadError(msg)).toBe("offline");
  });
  it("a missing sample is still replay", () => {
    expect(classifyUploadError("Server returned 409 on POST /intake: sample 'zz' not found")).toBe("replay");
  });
});
