export type UploadErrorKind = "server" | "photo" | "replay";

/**
 * Bucket a raw upload failure into one of the three user-facing messages.
 * A server answer (409 replay miss, any 4xx/5xx) is never "unreachable",
 * whatever words its detail text contains.
 */
export function classifyUploadError(message: string): UploadErrorKind {
  if (/Server returned 409\b/.test(message)) return "replay";
  if (/Server returned \d{3}\b/.test(message)) return "photo";
  if (/^Could not reach the server|failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return "server";
  }
  return /\b409\b/.test(message) ? "replay" : "photo";
}
