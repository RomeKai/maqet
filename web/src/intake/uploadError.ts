export type UploadErrorKind = "server" | "photo" | "replay";

/** Bucket a raw upload failure into one of the three user-facing messages. */
export function classifyUploadError(message: string): UploadErrorKind {
  if (/failed to fetch|networkerror|load failed|network request failed|econn/i.test(message)) return "server";
  if (/\b409\b/.test(message)) return "replay";
  return "photo";
}
