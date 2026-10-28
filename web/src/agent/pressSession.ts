import type { PushToTalkState } from "./PushToTalk";
import type { RecordingStart } from "./recorder";

export interface PressSessionDeps {
  startRecording: () => Promise<RecordingStart>;
  /** Receives a non-empty clip when the press is released. */
  onAudio: (audio: Blob) => void;
  onState: (state: PushToTalkState) => void;
}

export interface PressSession {
  begin: () => Promise<void>;
  end: () => Promise<void>;
  /** Release the microphone and ignore any press still waiting for it. */
  dispose: () => void;
}

/**
 * Sequences press/release around an async microphone start. Each press gets a token so that a
 * recording that resolves after its press was released (or replaced by a newer press) is stopped
 * at once instead of leaking a live stream.
 */
export function createPressSession({ startRecording, onAudio, onState }: PressSessionDeps): PressSession {
  let held = false;
  let pressId = 0;
  let stopCurrent: (() => Promise<Blob>) | null = null;

  async function begin(): Promise<void> {
    if (held) return;
    held = true;
    const id = ++pressId;
    onState("recording");

    const result = await startRecording();
    const current = id === pressId;
    if (result.status !== "recording") {
      if (current && held) {
        held = false;
        onState(result.status);
      }
      return;
    }
    if (!current || !held) {
      // Released (or superseded) before the microphone was ready: too short to be speech.
      await result.stop();
      if (current) onState("idle");
      return;
    }
    stopCurrent = result.stop;
  }

  async function end(): Promise<void> {
    if (!held) return;
    held = false;
    const stop = stopCurrent;
    stopCurrent = null;
    if (!stop) return; // begin() is still waiting for the microphone and will discard.
    onState("idle");
    try {
      const blob = await stop();
      if (blob.size > 0) onAudio(blob);
    } catch {
      onState("error");
    }
  }

  function dispose(): void {
    held = false;
    pressId += 1;
    const stop = stopCurrent;
    stopCurrent = null;
    if (stop) void stop().catch(() => undefined);
  }

  return { begin, end, dispose };
}
