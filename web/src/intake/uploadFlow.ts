import type { DownscaledImage } from "./image";
import type { IntakeKind, IntakeResult } from "./api";
import { classifyUploadError, type UploadErrorKind } from "./uploadError";

export type UploadPhase = "idle" | "preparing" | "reading";

export interface UploadDeps {
  downscale: (file: File) => Promise<DownscaledImage>;
  post: (image: Blob, kind: IntakeKind) => Promise<IntakeResult>;
  onPhase: (phase: UploadPhase) => void;
  onPhoto: (width: number, height: number, blob: Blob) => void;
  onScene: (result: IntakeResult) => void;
  onFailure: (kind: UploadErrorKind, message: string, detail: string) => void;
}

/**
 * One upload, shared by the camera and gallery buttons: downscale, POST to
 * /intake, then hand the draft over. Every failure (including a replay 409)
 * is reported through onFailure; nothing is swallowed.
 */
export async function runUpload(file: File, kind: IntakeKind, deps: UploadDeps): Promise<void> {
  deps.onPhase("preparing");
  let stage: "process" | "send" = "process";
  try {
    const image = await deps.downscale(file);
    stage = "send";
    deps.onPhase("reading");
    const result = await deps.post(image.blob, kind);
    deps.onPhoto(image.width, image.height, image.blob);
    deps.onScene(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[upload] ${stage} failed: ${detail}`);
    // A decode/downscale failure is the phone's problem, never "server unreachable".
    deps.onFailure(stage === "process" ? "process" : classifyUploadError(message), message, detail);
  } finally {
    deps.onPhase("idle");
  }
}
