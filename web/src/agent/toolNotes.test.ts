import { describe, expect, it } from "vitest";
import { parseTurnResponse } from "./agentApi";
import { splitToolNotes, withToolNotes } from "./toolNotes";

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
  it("keeps the reply plain and moves raw errors to details", () => {
    const raw = "opening o2 overflows wall w3: offset 0.00 + width 1.20 m > length 0.73 m";
    const out = splitToolNotes("That wall is too short for a 1.2 m window.", [raw], [raw, "w"], "fallback");
    expect(out.text).toBe("That wall is too short for a 1.2 m window.");
    expect(out.details).toEqual([raw, "w"]);
  });
  it("uses a plain fallback sentence when the model said nothing after an error", () => {
    expect(splitToolNotes(" ", ["boom"], [], "Try another wall?").text).toBe("Try another wall?");
    expect(splitToolNotes("", [], [], "x").text).toBe("");
  });
});
