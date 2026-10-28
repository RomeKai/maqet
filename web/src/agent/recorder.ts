/**
 * Press-and-hold voice capture on top of MediaRecorder. No network: it only returns the recorded Blob;
 * transcription is the caller's concern.
 */

export type RecordingStart =
  | { status: "recording"; stop: () => Promise<Blob> }
  | { status: "denied" | "unsupported" | "error" };

const DENIED_ERRORS = new Set(["NotAllowedError", "SecurityError", "PermissionDeniedError"]);
const FALLBACK_MIME = "audio/webm";

export function isRecordingSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "";
}

export async function startRecording(): Promise<RecordingStart> {
  if (!isRecordingSupported()) return { status: "unsupported" };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    return { status: DENIED_ERRORS.has(errorName(err)) ? "denied" : "error" };
  }

  const releaseMicrophone = (): void => stream.getTracks().forEach((track) => track.stop());

  let recorder: MediaRecorder;
  const chunks: Blob[] = [];
  let finish: () => void = () => undefined;
  let settled = false;
  // Settles exactly once, whether the recorder stopped, errored or the track ended.
  const finished = new Promise<Blob>((resolve) => {
    finish = () => {
      if (settled) return;
      settled = true;
      releaseMicrophone();
      resolve(new Blob(chunks, { type: recorder?.mimeType || FALLBACK_MIME }));
    };
  });

  try {
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = finish;
    recorder.onerror = finish;
    stream.getTracks().forEach((track) => {
      track.onended = finish;
    });
    recorder.start();
  } catch {
    releaseMicrophone();
    return { status: "error" };
  }

  const stop = (): Promise<Blob> => {
    if (recorder.state === "inactive") finish();
    else {
      try {
        recorder.stop();
      } catch {
        finish();
      }
    }
    return finished;
  };

  return { status: "recording", stop };
}
