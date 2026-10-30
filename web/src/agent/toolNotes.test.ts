import { describe, expect, it } from "vitest";
import { parseTurnResponse } from "./agentApi";
import { withToolNotes } from "./toolNotes";

describe("tool notes", () => {
  it("returns the reply untouched when nothing failed", () => {
    expect(withToolNotes("Done", [], [])).toBe("Done");
  });
  it("appends errors and warnings once each", () => {
    const out = withToolNotes("Done", ["no wall matches 'x'"], ["door.no_free_span: none", "door.no_free_span: none"]);
    expect(out).toContain("• no wall matches 'x'");
    expect(out.match(/door.no_free_span/g)).toHaveLength(1);
  });
  it("parses tool_errors from the server turn", () => {
    const parsed = parseTurnResponse({
      reply: "ok",
      scene: { id: "s", walls: [], rooms: [], openings: [], units: "m", version: 0 },
      ops_applied: [],
      professional_flags: [],
      history: [],
      tool_errors: ["boom"],
    });
    expect(parsed.tool_errors).toEqual(["boom"]);
    expect(parsed.tool_warnings).toEqual([]);
  });
});
