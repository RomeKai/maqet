/**
 * Pure helpers behind the Present AR card: how to read <model-viewer>'s
 * `ar-status` events and which AR modes are safe to offer.
 */

export type ArStatus = "session-started" | "object-placed" | "failed" | "not-presenting";

const KNOWN: readonly string[] = ["session-started", "object-placed", "failed", "not-presenting"];

export interface ArAttempt {
  /** A session started (or an object was placed) since the last not-presenting. */
  presenting: boolean;
  /** The last launch ended without ever presenting, or model-viewer said "failed". */
  failed: boolean;
}

export function initialAttempt(): ArAttempt {
  return { presenting: false, failed: false };
}

/**
 * "not-presenting" after a session is normal. "not-presenting" with no session
 * before it means the AR app never showed the model (Scene Viewer could not
 * fetch the GLB, typically an untrusted HTTPS certificate or a blob: URL).
 */
export function nextAttempt(attempt: ArAttempt, status: string): ArAttempt {
  if (!KNOWN.includes(status)) return attempt;
  switch (status as ArStatus) {
    case "session-started":
    case "object-placed":
      return { presenting: true, failed: false };
    case "failed":
      return { presenting: false, failed: true };
    case "not-presenting":
      return { presenting: false, failed: !attempt.presenting };
  }
}

const ALL_MODES = "webxr scene-viewer quick-look";

/**
 * Scene Viewer and Quick Look are separate apps: they only work with a hosted
 * https copy of the model. Without it (or after a failed attempt) offer WebXR,
 * which runs inside the page and reads the blob URL.
 */
export function arModesFor({ hostedReady, webxrOnly }: { hostedReady: boolean; webxrOnly: boolean }): string {
  return hostedReady && !webxrOnly ? ALL_MODES : "webxr";
}

/**
 * True when an AR app that fetches the model by itself will probably reject
 * this origin: plain http, or the hosts a self-signed dev certificate is
 * issued for (IP literals, localhost, *.local).
 */
export function likelyUntrustedHost(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return true;
  }
  if (url.protocol !== "https:") return true;
  const host = url.hostname;
  return host === "localhost" || host.endsWith(".local") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
}
