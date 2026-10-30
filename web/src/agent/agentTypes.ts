import type { AppliedOpOut, OpRecordIn, Scene } from "../scene/types";

/** Tap selection sent as context ("this" / "esto" refers to it). */
export type { SelectedRef } from "../scene/types";

export interface ToolErrorInfo {
  code: string;
  message: string;
}

export interface ToolEvent {
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  errors: ToolErrorInfo[];
  warnings: string[];
  flags: string[];
}

export interface TurnResponse {
  scene: Scene;
  reply: string;
  ops_applied: AppliedOpOut[];
  professional_flags: string[];
  history: OpRecordIn[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** The model reply alone (no appended tool notes); what the conversation memory uses. */
  spoken?: string;
  toolEvents?: ToolEvent[];
}
