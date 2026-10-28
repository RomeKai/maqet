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
  try {
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start();
  } catch {
    releaseMicrophone();
    return { status: "error" };
  }

  let finished: Promise<Blob> | null = null;
  const stop = (): Promise<Blob> => {
    finished ??= new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        releaseMicrophone();
        resolve(new Blob(chunks, { type: recorder.mimeType || FALLBACK_MIME }));
      };
      if (recorder.state === "inactive") recorder.onstop(new Event("stop"));
      else recorder.stop();
    });
    return finished;
  };

  return { status: "recording", stop };
}
