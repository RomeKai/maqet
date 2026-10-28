import type { Scene } from "../scene/types";

/**
 * Local mirror of the server/agent turn contract (executor.ToolResult / ToolError, tools.SelectedRef).
 * Kept here until the API schema generates it.
 */

/** Tap selection sent as context ("this" / "esto" refers to it). */
export interface SelectedRef {
  kind: string;
  id: string;
}

export interface ToolErrorInfo {
  /** Machine-readable finding code, e.g. `door.width_below_minimum`. */
  code: string;
  message: string;
}

/** One validated tool call the agent made during a turn. */
export interface ToolEvent {
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  errors: ToolErrorInfo[];
  warnings: string[];
  /** Professional-required flags, e.g. `needs_professional:second_floor` (ADR-023). */
  flags: string[];
}

export interface TurnResponse {
  /** The Scene after the turn (source of truth, ADR-001). */
  scene: Scene;
  reply: string;
  tool_events: ToolEvent[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolEvents?: ToolEvent[];
}
