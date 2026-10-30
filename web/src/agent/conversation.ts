import type { ChatMessage } from "./agentTypes";

/** How many recent chat messages the agent gets as memory (the server is stateless). */
export const CONVERSATION_LIMIT = 12;

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
}

/** Chat key: each variant keeps its own conversation; Design has one of its own. */
export function chatKey(stage: string, variant: string | null): string {
  return stage === "stage.reform" ? `reform:${variant ?? "now"}` : stage;
}

/**
 * The last N spoken messages of one chat, oldest first. Tool-note chips and
 * errors are not part of it: assistant messages use their `spoken` text
 * (the model's reply without the appended notes).
 */
export function toConversation(messages: readonly ChatMessage[], limit: number = CONVERSATION_LIMIT): ConversationTurn[] {
  return messages
    .map((m) => ({ role: m.role, text: (m.spoken ?? m.text).trim() }))
    .filter((turn) => turn.text.length > 0)
    .slice(-limit);
}
