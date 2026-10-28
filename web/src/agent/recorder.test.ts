import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRecordingSupported, startRecording } from "./recorder";

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  /** When true, stop() never fires onstop (a broken recorder). */
  static stuck = false;
  mimeType = "audio/webm";
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly stream: unknown) {
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    if (FakeMediaRecorder.stuck) return;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function fakeStream() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }] }, stop };
}

function stubMicrophone(getUserMedia: () => Promise<unknown>): void {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
}

describe("recorder", () => {
  beforeEach(() => {
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.stuck = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports unsupported without MediaRecorder or getUserMedia", async () => {
    vi.stubGlobal("navigator", {});
    expect(isRecordingSupported()).toBe(false);
    expect(await startRecording()).toEqual({ status: "unsupported" });
  });

  it("reports supported when both APIs exist", () => {
    stubMicrophone(() => Promise.resolve(fakeStream().stream));
    expect(isRecordingSupported()).toBe(true);
  });

  it("maps a refused microphone permission to denied", async () => {
    stubMicrophone(() => Promise.reject(new DOMException("blocked", "NotAllowedError")));
    expect(await startRecording()).toEqual({ status: "denied" });
  });

  it("maps any other capture failure to error", async () => {
    stubMicrophone(() => Promise.reject(new DOMException("no mic", "NotFoundError")));
    expect(await startRecording()).toEqual({ status: "error" });
  });

  it("starts recording and resolves the captured Blob on stop, releasing the microphone", async () => {
    const { stream, stop } = fakeStream();
    stubMicrophone(() => Promise.resolve(stream));

    const result = await startRecording();
    expect(result.status).toBe("recording");
    if (result.status !== "recording") return;
    expect(FakeMediaRecorder.instances[0]?.state).toBe("recording");

    const blob = await result.stop();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe("audio/webm");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("stop is idempotent", async () => {
    const { stream } = fakeStream();
    stubMicrophone(() => Promise.resolve(stream));
    const result = await startRecording();
    if (result.status !== "recording") throw new Error("expected recording");
    const first = await result.stop();
    const second = await result.stop();
    expect(second).toBe(first);
  });

  it("settles stop and releases the microphone when the recorder errors", async () => {
    const { stream, stop } = fakeStream();
    stubMicrophone(() => Promise.resolve(stream));
    FakeMediaRecorder.stuck = true;
    const result = await startRecording();
    if (result.status !== "recording") throw new Error("expected recording");

    const recorder = FakeMediaRecorder.instances[0];
    recorder.ondataavailable?.({ data: new Blob(["partial"]) });
    recorder.onerror?.();

    const blob = await result.stop();
    expect(blob.size).toBeGreaterThan(0);
    expect(stop).toHaveBeenCalled();
  });

  it("settles stop and releases the microphone when the track ends", async () => {
    const stop = vi.fn();
    const track: { stop: () => void; onended: (() => void) | null } = { stop, onended: null };
    stubMicrophone(() => Promise.resolve({ getTracks: () => [track] }));
    FakeMediaRecorder.stuck = true;
    const result = await startRecording();
    if (result.status !== "recording") throw new Error("expected recording");

    track.onended?.();

    const blob = await result.stop();
    expect(blob).toBeInstanceOf(Blob);
    expect(stop).toHaveBeenCalled();
  });
});
