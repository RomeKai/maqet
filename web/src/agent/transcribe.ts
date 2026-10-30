import type { Locale } from "../i18n";
import { blobToWav } from "./toWav";

/** Server detail for a failed call ("transcribe 422" says nothing to the user). */
async function errorDetail(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null && typeof (body as { detail?: unknown }).detail === "string") {
      return (body as { detail: string }).detail;
    }
  } catch {
    // not JSON
  }
  return `transcribe failed (${res.status})`;
}

/** Recorded clip -> WAV -> POST /api/transcribe -> text. */
export async function transcribeClip(
  audio: Blob,
  locale: Locale,
  toWav: (b: Blob) => Promise<Blob> = blobToWav,
): Promise<string> {
  const wav = await toWav(audio);
  const form = new FormData();
  form.append("audio", new File([wav], "clip.wav", { type: "audio/wav" }));
  if (locale === "es-AR") form.append("language", "es");
  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!res.ok) throw new Error(await errorDetail(res));
  const body = (await res.json()) as { text?: string };
  return body.text ?? "";
}
