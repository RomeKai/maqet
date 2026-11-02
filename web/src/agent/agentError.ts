import type { Locale } from "../i18n";
import { AgentApiError } from "./agentApi";
import { getAgentStrings } from "./agent.i18n";

/** What the chat shows after a failed turn: one friendly sentence, raw text behind Details, a way to retry. */
export interface AgentErrorInfo {
  kind: "server" | "timeout" | "info";
  message: string;
  /** Technical line (status, server detail) shown only inside the Details disclosure. */
  details: string | null;
  /** The message the user sent; present when Retry can resend it. */
  retryText: string | null;
}

export function describeAgentError(err: unknown, locale: Locale, retryText: string | null): AgentErrorInfo {
  const t = getAgentStrings(locale);
  const raw = err instanceof Error ? err.message : String(err);
  if (err instanceof AgentApiError && err.timedOut) {
    return { kind: "timeout", message: t["chat.error.timeout"], details: raw, retryText };
  }
  return { kind: "server", message: t["chat.error.server"], details: raw, retryText };
}

/** A message that is already user-facing (no technical detail, nothing to retry). */
export function plainAgentError(message: string): AgentErrorInfo {
  return { kind: "info", message, details: null, retryText: null };
}
