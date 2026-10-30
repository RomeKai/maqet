import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeWavPcm16, resampledLength, downmix, TARGET_RATE } from "./toWav";
import { transcribeClip } from "./transcribe";

describe("encodeWavPcm16", () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const view = new DataView(encodeWavPcm16(samples, 16000));
  const str = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(o + i)));
  it("writes a RIFF/WAVE PCM mono 16 kHz 16-bit header", () => {
    expect(str(0)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2);
    expect(str(8)).toBe("WAVE");
    expect(str(12)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(32000); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16);
    expect(str(36)).toBe("data");
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });
  it("clamps and scales samples to int16", () => {
    expect(view.getInt16(44 + 2, true)).toBe(16384);
    expect(view.getInt16(44 + 6, true)).toBe(32767);
    expect(view.getInt16(44 + 8, true)).toBe(-32768);
  });
});

describe("resample and downmix", () => {
  it("resampled length follows the rate ratio", () => {
    expect(TARGET_RATE).toBe(16000);
    expect(resampledLength(48000, 48000)).toBe(16000);
    expect(resampledLength(22050, 44100)).toBe(8000);
  });
  it("downmixes channels by averaging", () => {
    expect(Array.from(downmix([new Float32Array([1, 0]), new Float32Array([0, 0])]))).toEqual([0.5, 0]);
  });
});

describe("transcribeClip", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("posts clip.wav as audio/wav with language=es for es-AR", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "hola", duration_ms: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const text = await transcribeClip(new Blob(["x"]), "es-AR", async () => new Blob(["wav"], { type: "audio/wav" }));
    expect(text).toBe("hola");
    const body = f.mock.calls[0]![1].body as FormData;
    const file = body.get("audio") as File;
    expect(file.name).toBe("clip.wav");
    expect(file.type).toBe("audio/wav");
    expect(body.get("language")).toBe("es");
  });
  it("surfaces the server 422 detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "upload mono 16-bit WAV" }), { status: 422 })));
    await expect(transcribeClip(new Blob(["x"]), "en", async () => new Blob(["w"]))).rejects.toThrow("upload mono 16-bit WAV");
  });
});
