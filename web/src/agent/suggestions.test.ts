import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getAgentStrings } from "./agent.i18n";
import { SUGGESTIONS } from "./suggestions";

const stagesPy = readFileSync(new URL("../../../server/agent/stages.py", import.meta.url), "utf8");

/** Tool names per stage, parsed from the STAGES table in stages.py (single source of truth). */
function stageTools(stage: string): string[] {
  const block = new RegExp(String.raw`"${stage}":\s*\(([^)]*)\)`).exec(stagesPy);
  expect(block, `stage ${stage} in stages.py`).not.toBeNull();
  return [...block![1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
}

describe("quick-request chips", () => {
  for (const stage of Object.keys(SUGGESTIONS) as (keyof typeof SUGGESTIONS)[]) {
    it(`every ${stage} chip maps to a tool that exists in that stage`, () => {
      const tools = stageTools(stage);
      expect(SUGGESTIONS[stage].length).toBeGreaterThan(0);
      for (const { tool } of SUGGESTIONS[stage]) expect(tools, tool).toContain(tool);
    });
    it(`each ${stage} chip has its own tool and en + es-AR text`, () => {
      const used = SUGGESTIONS[stage].map((s) => s.tool);
      expect(new Set(used).size).toBe(used.length);
      for (const { key } of SUGGESTIONS[stage]) {
        expect(getAgentStrings("en")[key].length).toBeGreaterThan(0);
        expect(getAgentStrings("es-AR")[key]).not.toBe(getAgentStrings("en")[key]);
      }
    });
  }
  it("has no chip without a tool behind it (no brighter / cheapest floor)", () => {
    const en = getAgentStrings("en");
    expect(Object.keys(en).filter((k) => /^suggest\.(brighter|floor|door|bedroom)$/.test(k))).toEqual([]);
  });
});
