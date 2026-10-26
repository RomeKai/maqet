import type { Scene } from "../scene/types";

/**
 * Intake API client (web, P0 Capture).
 * POSTs the downscaled photo to `POST /intake` (multipart `file` + `kind`)
 * and returns the validated `{ proposal, scene }` draft.
 * Base URL comes from `VITE_API_URL`, defaulting to local FastAPI.
 * Server route contract: multipart { file: image, kind: plan|sketch }
 * -> { proposal: IntakeProposal, scene: Scene }.
 */

export type IntakeKind = "plan" | "sketch";

export type NormPoint = [number, number];

export interface IntakeProposalWall {
  a: NormPoint;
  b: NormPoint;
  kind: "exterior" | "interior" | null;
}

export interface IntakeProposalOpening {
  wall_index: number;
  t0: number;
  t1: number;
  kind: "door" | "window";
}

export interface IntakeProposalLabel {
  text: string;
  at: NormPoint;
}

export interface IntakeProposalDimension {
  text: string;
  a: NormPoint;
  b: NormPoint;
}

export interface IntakeProposal {
  input_kind: IntakeKind;
  walls: IntakeProposalWall[];
  openings: IntakeProposalOpening[];
  labels: IntakeProposalLabel[];
  dimensions: IntakeProposalDimension[];
}

export interface IntakeResult {
  proposal: IntakeProposal;
  scene: Scene;
  warnings: string[];
}

function apiBase(): string {
  const configured: unknown = import.meta.env.VITE_API_URL;
  return typeof configured === "string" && configured.length > 0
    ? configured
    : "http://localhost:8000";
}

export function intakeUrl(): string {
  return `${apiBase()}/intake`;
}

function messageOf(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "unknown error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProposal(value: unknown): value is IntakeProposal {
  if (!isRecord(value)) return false;
  if (value.input_kind !== "plan" && value.input_kind !== "sketch") return false;
  return (
    Array.isArray(value.walls) &&
    Array.isArray(value.openings) &&
    Array.isArray(value.labels) &&
    Array.isArray(value.dimensions)
  );
}

function isScene(value: unknown): value is Scene {
  return (
    isRecord(value) && typeof value.id === "string" && Array.isArray(value.walls)
  );
}

function isWarnings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((w) => typeof w === "string");
}

/** Server 400s carry human-correctable English detail; surface it. */
async function readErrorDetail(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed) && typeof parsed.detail === "string") {
        return parsed.detail;
      }
    } catch {
      // Not JSON: fall through to raw text.
    }
    return text.slice(0, 300);
  } catch {
    return null;
  }
}

/**
 * Upload a downscaled plan/sketch photo and get the Scene draft back.
 * Throws an Error with a human-readable message on network, HTTP or
 * payload failures; the caller decides what to show.
 */
export async function postIntake(image: Blob, kind: IntakeKind): Promise<IntakeResult> {
  const form = new FormData();
  form.append("file", image, kind === "sketch" ? "sketch.jpg" : "plan.jpg");
  form.append("kind", kind);

  let res: Response;
  try {
    res = await fetch(intakeUrl(), { method: "POST", body: form });
  } catch (err) {
    throw new Error(`Could not reach the server (${intakeUrl()}): ${messageOf(err)}`);
  }
  if (!res.ok) {
    const detail = await readErrorDetail(res);
    throw new Error(
      detail
        ? `Server returned ${res.status} on POST /intake: ${detail}`
        : `Server returned ${res.status} on POST /intake`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("Server returned a non-JSON response on POST /intake");
  }
  if (!isRecord(body) || !isProposal(body.proposal) || !isScene(body.scene)) {
    throw new Error("Server returned an invalid proposal on POST /intake");
  }
  return {
    proposal: body.proposal,
    scene: body.scene,
    warnings: isWarnings(body.warnings) ? body.warnings : [],
  };
}
