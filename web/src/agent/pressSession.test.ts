import { describe, expect, it, vi } from "vitest";
import { createPressSession } from "./pressSession";
import type { RecordingStart } from "./recorder";

interface Deferred {
  promise: Promise<RecordingStart>;
  resolve: (value: RecordingStart) => void;
}

function deferred(): Deferred {
  let resolve!: (value: RecordingStart) => void;
  const promise = new Promise<RecordingStart>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function recording(size = 5): { start: RecordingStart; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn(() => Promise.resolve(new Blob([new Uint8Array(size)])));
  return { start: { status: "recording", stop }, stop };
}

describe("pressSession", () => {
  it("delivers the clip on release", async () => {
    const rec = recording();
    const onAudio = vi.fn();
    const session = createPressSession({ startRecording: () => Promise.resolve(rec.start), onAudio, onState: vi.fn() });
    await session.begin();
    await session.end();
    expect(rec.stop).toHaveBeenCalledTimes(1);
    expect(onAudio).toHaveBeenCalledTimes(1);
  });

  it("skips onAudio for an empty clip", async () => {
    const rec = recording(0);
    const onAudio = vi.fn();
    const session = createPressSession({ startRecording: () => Promise.resolve(rec.start), onAudio, onState: vi.fn() });
    await session.begin();
    await session.end();
    expect(onAudio).not.toHaveBeenCalled();
  });

  it("stops every recording when presses overlap (no leaked microphone)", async () => {
    const first = deferred();
    const second = deferred();
    const queue = [first, second];
    const onAudio = vi.fn();
    const session = createPressSession({
      startRecording: () => (queue.shift() as Deferred).promise,
      onAudio,
      onState: vi.fn(),
    });

    const p1 = session.begin(); // press
    await session.end(); // release while getUserMedia is pending
    const p2 = session.begin(); // press again

    const rec1 = recording();
    const rec2 = recording();
    first.resolve(rec1.start);
    second.resolve(rec2.start);
    await Promise.all([p1, p2]);

    expect(rec1.stop).toHaveBeenCalledTimes(1); // stale recording discarded immediately
    expect(rec2.stop).not.toHaveBeenCalled(); // current press still live

    await session.end();
    expect(rec2.stop).toHaveBeenCalledTimes(1);
    expect(onAudio).toHaveBeenCalledTimes(1);
  });

  it("discards a recording released before the microphone was ready", async () => {
    const pending = deferred();
    const onAudio = vi.fn();
    const onState = vi.fn();
    const session = createPressSession({ startRecording: () => pending.promise, onAudio, onState });
    const p = session.begin();
    await session.end();
    const rec = recording();
    pending.resolve(rec.start);
    await p;
    expect(rec.stop).toHaveBeenCalledTimes(1);
    expect(onAudio).not.toHaveBeenCalled();
    expect(onState).toHaveBeenLastCalledWith("idle");
  });

  it("reports denied and allows a new press", async () => {
    const onState = vi.fn();
    const session = createPressSession({
      startRecording: () => Promise.resolve({ status: "denied" } as const),
      onAudio: vi.fn(),
      onState,
    });
    await session.begin();
    expect(onState).toHaveBeenLastCalledWith("denied");
    await session.begin();
    expect(onState).toHaveBeenCalledTimes(4);
  });

  it("dispose stops the live recording", async () => {
    const rec = recording();
    const session = createPressSession({ startRecording: () => Promise.resolve(rec.start), onAudio: vi.fn(), onState: vi.fn() });
    await session.begin();
    session.dispose();
    expect(rec.stop).toHaveBeenCalledTimes(1);
  });
});
