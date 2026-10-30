import type { AgentKey } from "./agent.i18n";

export type SuggestionStage = "reform" | "design";

export interface Suggestion {
  key: AgentKey;
  /** The one tool of that stage's toolset (server/agent/stages.py) this chip exercises. */
  tool: string;
}

/**
 * Quick requests per stage. Every chip maps 1:1 to a real tool of the stage and
 * is phrased concretely so the model can act without guessing. A test keeps the
 * tool names in sync with stages.py.
 */
export const SUGGESTIONS: Record<SuggestionStage, readonly Suggestion[]> = {
  reform: [
    { key: "suggest.reform.bedroom", tool: "add_room" },
    { key: "suggest.reform.window", tool: "add_opening" },
    { key: "suggest.reform.door", tool: "set_opening_size" },
    { key: "suggest.reform.split", tool: "split_room" },
  ],
  design: [
    { key: "suggest.design.bed", tool: "place_furniture" },
    { key: "suggest.design.fits", tool: "list_catalog" },
    { key: "suggest.design.remove", tool: "remove_item" },
  ],
};
