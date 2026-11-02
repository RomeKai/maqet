/** The readable part of a failed API response: FastAPI's `{"detail": "..."}` string, else the text (cut), else the fallback. */
export function apiErrorText(text: string, fallback: string): string {
  if (text.length === 0) return fallback;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as { detail?: unknown }).detail === "string") {
      return (parsed as { detail: string }).detail;
    }
  } catch {
    // Not JSON: use the raw text.
  }
  return text.slice(0, 300);
}
