import type { AgentTurnIn, AgentTurnOut, AppliedOpOut, OpRecordIn, Scene, SelectedRef } from "../scene/types";
import { validateScene } from "./validateScene";

/**
 * Reform-agent API client (web). Base URL comes from `VITE_API_URL`, defaulting to the same-origin
 * `/api` proxy, same as the intake client.
 * Route contract: POST /agent/turn { scene, message, stage, history?, selected? } -> AgentTurnOut
 * Variants: GET /variants, POST /variants/fork, POST /variants/{label}/choose, POST /variants/undo
 * Snapshot: GET/POST /scene/snapshot.svg
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

/** Stage scoped to the current sheet (Capture has no agent tools). */
export type AgentStage = AgentTurnIn["stage"];

function apiBase(): string {
  const configured: unknown = import.meta.env.VITE_API_URL;
  return typeof configured === "string" && configured.length > 0 ? configured : "/api";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function turnUrl(): string {
  return `${apiBase()}/agent/turn`;
}

export function editUrl(): string {
  return `${apiBase()}/agent/edit`;
}

export function variantsUrl(): string {
  return `${apiBase()}/variants`;
}

export function variantForkUrl(): string {
  return `${apiBase()}/variants/fork`;
}

export function variantChooseUrl(label: string): string {
  return `${apiBase()}/variants/${encodeURIComponent(label)}/choose`;
}

export function variantUndoUrl(): string {
  return `${apiBase()}/variants/undo`;
}

export function snapshotUrl(locale: string = "en"): string {
  return `${apiBase()}/scene/snapshot.svg?locale=${encodeURIComponent(locale)}`;
}

function parseAppliedOp(value: unknown): AppliedOpOut {
  if (!isRecord(value) || typeof value.name !== "string") {
    throw new AgentApiError("Malformed applied op in agent response");
  }
  return {
    name: value.name,
    arguments: isRecord(value.arguments) ? value.arguments : {},
    flags: Array.isArray(value.flags) ? stringList(value.flags) : [],
  };
}

/** Validates an untrusted turn payload at the boundary. */
export function parseTurnResponse(payload: unknown): AgentTurnOut {
  if (!isRecord(payload) || typeof payload.reply !== "string" || !isRecord(payload.scene)) {
    throw new AgentApiError("Malformed agent response");
  }
  if (!Array.isArray(payload.ops_applied)) {
    throw new AgentApiError("Malformed agent response: ops_applied");
  }
  if (!Array.isArray(payload.professional_flags)) {
    throw new AgentApiError("Malformed agent response: professional_flags");
  }
  if (!Array.isArray(payload.history)) {
    throw new AgentApiError("Malformed agent response: history");
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
    ops_applied: payload.ops_applied.map(parseAppliedOp),
    professional_flags: stringList(payload.professional_flags),
    history: payload.history as OpRecordIn[],
  };
}

async function readErrorDetail(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed) && typeof parsed.detail === "string") return parsed.detail;
    } catch {
      /* not JSON */
    }
    return text.slice(0, 300);
  } catch {
    return null;
  }
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const timeoutError = (): AgentApiError => new AgentApiError("Request timed out", null, true);

  try {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (timedOut) throw timeoutError();
      throw new AgentApiError(err instanceof Error && err.message ? err.message : "Network error");
    }
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new AgentApiError(
        detail ? `Request failed (${response.status}): ${detail}` : `Request failed (${response.status})`,
        response.status,
      );
    }
    try {
      return await response.json();
    } catch {
      if (timedOut) throw timeoutError();
      throw new AgentApiError("Response was not JSON", response.status);
    }
  } finally {
    clearTimeout(timer);
  }
}

export interface SendTurnParams {
  scene: Scene;
  message: string;
  stage: AgentStage;
  history?: OpRecordIn[];
  selected?: SelectedRef | null;
}

export async function sendTurn(
  params: SendTurnParams,
  { timeoutMs = TURN_TIMEOUT_MS }: SendTurnOptions = {},
): Promise<AgentTurnOut> {
  const message = params.message.trim();
  if (message.length === 0) throw new AgentApiError("Cannot send an empty message");

  const body: AgentTurnIn = {
    scene: params.scene,
    message,
    stage: params.stage,
    history: params.history ?? [],
    selected: params.selected ?? null,
  };

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
      response = await fetch(turnUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) throw timeoutError();
      throw new AgentApiError(err instanceof Error && err.message ? err.message : "Network error");
    }

    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new AgentApiError(
        detail ? `Agent request failed (${response.status}): ${detail}` : `Agent request failed (${response.status})`,
        response.status,
      );
    }

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

export interface SendEditParams {
  scene: Scene;
  tool: string;
  args: Record<string, unknown>;
  history?: OpRecordIn[];
}

/** One deterministic edit (no model): same scene/history contract as a turn; tool "undo" reverts it. */
export async function sendEdit(
  params: SendEditParams,
  timeoutMs: number = TURN_TIMEOUT_MS,
): Promise<AgentTurnOut> {
  const payload = await fetchJson(
    editUrl(),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...params, history: params.history ?? [] }),
    },
    timeoutMs,
  );
  return parseTurnResponse(payload);
}

// Variants helpers — thin wrappers that validate the shape minimally
export async function fetchVariants(timeoutMs: number = TURN_TIMEOUT_MS): Promise<unknown> {
  return fetchJson(variantsUrl(), { method: "GET" }, timeoutMs);
}

export async function forkVariant(
  label: string,
  fromBranch: string = "A",
  timeoutMs: number = TURN_TIMEOUT_MS,
): Promise<unknown> {
  return fetchJson(
    variantForkUrl(),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, from_branch: fromBranch }),
    },
    timeoutMs,
  );
}

export async function chooseVariant(label: string, timeoutMs: number = TURN_TIMEOUT_MS): Promise<unknown> {
  return fetchJson(variantChooseUrl(label), { method: "POST" }, timeoutMs);
}

export async function undoVariant(label: string | null = null, timeoutMs: number = TURN_TIMEOUT_MS): Promise<unknown> {
  return fetchJson(
    variantUndoUrl(),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(label ? { label } : {}),
    },
    timeoutMs,
  );
}
