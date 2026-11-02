import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getAgentStrings, professionalFlagLabel, toolLabel } from "../agent/agent.i18n";
import { flagLabel, lineName, uniqueFlagCodes } from "./takeoffFormat";

const rules = readFileSync(new URL("../../../server/scene/rules.py", import.meta.url), "utf8");
const catalog = JSON.parse(
  readFileSync(new URL("../../../assets/catalog.json", import.meta.url), "utf8"),
) as { materials: Record<string, unknown>[]; furniture: Record<string, unknown>[] };

const ruleFlags = [...rules.matchAll(/^PRO_FLAG_\w+\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);

describe("professional flag labels", () => {
  it("finds the flag codes in rules.py", () => {
    expect(ruleFlags.length).toBeGreaterThanOrEqual(4);
  });
  it.each(ruleFlags)("%s has its own en and es-AR label, also on Deliver", (code) => {
    for (const locale of ["en", "es-AR"] as const) {
      expect(getAgentStrings(locale)).toHaveProperty(`flag.${code}`);
      expect(professionalFlagLabel(locale, code)).not.toBe(getAgentStrings(locale)["flag.generic"]);
      expect(flagLabel(code, locale)).toBe(professionalFlagLabel(locale, code));
    }
  });
  it("dedupes flags with trailing details", () => {
    const codes = uniqueFlagCodes([
      { code: "needs_professional:span_over_limit:w1" },
      { code: "needs_professional:span_over_limit:w2" },
      { code: "needs_professional:span_over_limit" },
    ]);
    expect(codes).toEqual(["needs_professional:span_over_limit"]);
  });
});

describe("catalog names", () => {
  it("every catalog item has en and es-AR names", () => {
    for (const item of [...catalog.materials, ...catalog.furniture]) {
      expect(item.name, String(item.id)).toBeTruthy();
      expect(item.name_es_AR, String(item.id)).toBeTruthy();
    }
  });
  it("shows the es-AR name in es-AR and falls back to English", () => {
    const line = { material_id: "sand-m3", name: "Coarse sand", name_es_AR: "Arena gruesa", quantity: 1, purchase_quantity: 1, unit: "m3", waste_factor: 1, recipe_source: "", estimated: false };
    expect(lineName(line, "es-AR")).toBe("Arena gruesa");
    expect(lineName(line, "en")).toBe("Coarse sand");
    expect(lineName({ ...line, name_es_AR: undefined }, "es-AR")).toBe("Coarse sand");
  });
});

describe("tool labels", () => {
  it("localizes tool names", () => {
    expect(toolLabel("es-AR", "add_room")).toBe("Agregar ambiente");
    expect(toolLabel("en", "add_room")).toBe("Add room");
    expect(toolLabel("es-AR", "mystery")).toBe("mystery");
  });
});
