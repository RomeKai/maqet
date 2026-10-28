import type { Scene } from "../scene/types";
import type { SelectedRef, ToolErrorInfo, ToolEvent, TurnResponse } from "./agentTypes";
import { validateScene } from "./validateScene";

/**
 * Reform-agent API client (web). Base URL comes from `VITE_API_URL`, defaulting to the same-origin
 * `/api` proxy, same as the intake client.
 * Route contract (not served yet): POST /projects/{id}/turn { text, selected? } -> TurnResponse.
 */

/** A turn that has not answered after this long is abandoned so the chat never stays pending. */
export const TURN_TIMEOUT_MS = 60_000;

export class AgentApiError extends Error {
  readonly status: number | null;
  /** True when the request was aborted because the server did not answer in time. */
  readonly timedOut: boolean;

  constructor(message: string, status: number | null = null, timedOut = false) {
    super(message);
    this.name = "AgentApiError";
    this.status = status;
    this.timedOut = timedOut;
  }
}

export interface SendTurnOptions {
  timeoutMs?: number;
}

function apiBase(): string {
  const configured: unknown = import.meta.env.VITE_API_URL;
  return typeof configured === "string" && configured.length > 0 ? configured : "/api";
}

export function turnUrl(projectId: string): string {
  return `${apiBase()}/projects/${encodeURIComponent(projectId)}/turn`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseError(value: unknown): ToolErrorInfo | null {
  if (!isRecord(value) || typeof value.code !== "string") return null;
  return { code: value.code, message: typeof value.message === "string" ? value.message : value.code };
}

function parseToolEvent(value: unknown): ToolEvent {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.ok !== "boolean") {
    throw new AgentApiError("Malformed tool event in agent response");
  }
  const errors = Array.isArray(value.errors)
    ? value.errors.map(parseError).filter((e): e is ToolErrorInfo => e !== null)
    : [];
  return {
    name: value.name,
    arguments: isRecord(value.arguments) ? value.arguments : {},
    ok: value.ok,
    errors,
    warnings: stringList(value.warnings),
    flags: stringList(value.flags),
  };
}

/** Validates an untrusted turn payload at the boundary. */
export function parseTurnResponse(payload: unknown): TurnResponse {
  if (!isRecord(payload) || typeof payload.reply !== "string" || !isRecord(payload.scene)) {
    throw new AgentApiError("Malformed agent response");
  }
  if (!Array.isArray(payload.tool_events)) {
    throw new AgentApiError("Malformed agent response: tool_events");
  }
  let scene: Scene;
  try {
    scene = validateScene(payload.scene);
  } catch (err) {
    throw new AgentApiError(err instanceof Error ? err.message : "Malformed scene in agent response");
  }
  return {
    scene,
    reply: payload.reply,
    tool_events: payload.tool_events.map(parseToolEvent),
  };
}

export async function sendTurn(
  projectId: string,
  text: string,
  selected?: SelectedRef,
  { timeoutMs = TURN_TIMEOUT_MS }: SendTurnOptions = {},
): Promise<TurnResponse> {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new AgentApiError("Cannot send an empty message");

  const body = selected ? { text: trimmed, selected } : { text: trimmed };

  // One deadline covers connecting, waiting for the server and reading the body.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const timeoutError = (): AgentApiError => new AgentApiError("Agent request timed out", null, true);

  try {
    let response: Response;
    try {
      response = await fetch(turnUrl(projectId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) throw timeoutError();
      throw new AgentApiError(err instanceof Error && err.message ? err.message : "Network error");
    }

    if (!response.ok) throw new AgentApiError(`Agent request failed (${response.status})`, response.status);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (timedOut) throw timeoutError();
      throw new AgentApiError("Agent response was not JSON", response.status);
    }
    return parseTurnResponse(payload);
  } finally {
    clearTimeout(timer);
  }
}
