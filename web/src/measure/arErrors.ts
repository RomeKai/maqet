import type { StringKey } from "../i18n";

export type ArErrorClass = "denied" | "unsupported" | "insecure" | "stuck" | "other";

/** Classify a raw AR start error so the UI can say something a person understands. */
export function classifyArError(message: string): ArErrorClass {
  if (/NotAllowedError|SecurityError|permission/i.test(message)) return "denied";
  if (/secure context|HTTPS/i.test(message)) return "insecure";
  if (/stuck/i.test(message)) return "stuck";
  if (/NotSupportedError|not available|not hit-test|unsupported/i.test(message)) return "unsupported";
  return "other";
}

export function arErrorKey(c: ArErrorClass): StringKey {
  return `measure.ar.err.${c}` as StringKey;
}
