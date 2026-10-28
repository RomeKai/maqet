import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/takeoff.sample.json";
import { PRELIMINARY_NOTE, buildTakeoffCsv, formatQuantity, orderedStages, parseTakeoff } from "./takeoffFormat";
import { TAKEOFF_STAGES } from "./takeoffTypes";

const takeoff = parseTakeoff(fixture);

describe("orderedStages", () => {
  it("returns stages in construction order whatever the payload key order", () => {
    expect(Object.keys(fixture.stages)[0]).toBe("finishes"); // payload is deliberately scrambled
    expect(orderedStages(takeoff).map((s) => s.stage)).toEqual([...TAKEOFF_STAGES]);
    expect(TAKEOFF_STAGES).toEqual(["foundations", "walls", "bond_beams_roof", "openings", "finishes"]);
  });

  it("skips stages without lines", () => {
    const partial = { ...takeoff, stages: { walls: takeoff.stages.walls } };
    expect(orderedStages(partial).map((s) => s.stage)).toEqual(["walls"]);
  });
});

describe("formatQuantity", () => {
  it("uses a decimal point in en and a decimal comma in es-AR", () => {
    expect(formatQuantity(1234.5, "en")).toBe("1,234.5");
    expect(formatQuantity(1234.5, "es-AR")).toBe("1.234,5");
    expect(formatQuantity(0.75, "es-AR")).toBe("0,75");
  });

  it("caps decimals at two and drops trailing zeros", () => {
    expect(formatQuantity(1.8, "en")).toBe("1.8");
    expect(formatQuantity(2, "es-AR")).toBe("2");
    expect(formatQuantity(0.3333333, "en")).toBe("0.33");
  });
});

describe("parseTakeoff", () => {
  it("accepts the fixture", () => {
    expect(takeoff.preliminary).toBe(true);
    expect(takeoff.flags.map((f) => f.code)).toEqual(["second_floor", "span_over_limit"]);
  });

  it("rejects payloads that are not a takeoff", () => {
    expect(() => parseTakeoff(null)).toThrow(/takeoff/i);
    expect(() => parseTakeoff({ ...fixture, stages: { garden: [] } })).toThrow(/stage/i);
    expect(() =>
      parseTakeoff({ ...fixture, stages: { walls: [{ ...fixture.stages.walls[0], quantity: "lots" }] } }),
    ).toThrow(/quantity/i);
  });
});

describe("buildTakeoffCsv", () => {
  const csv = buildTakeoffCsv(takeoff);
  const rows = csv.trim().split("\r\n");

  it("starts with a header, then one row per line in stage order", () => {
    expect(rows[0]).toBe("stage,material_id,name,quantity,unit,waste_factor,estimated,recipe_source");
    const stages = rows.slice(1, -1).map((r) => r.split(",")[0]);
    expect(stages).toEqual([
      "foundations",
      "foundations",
      "walls",
      "walls",
      "bond_beams_roof",
      "openings",
      "finishes",
    ]);
  });

  it("writes machine-readable quantities (dot decimals) whatever the UI locale", () => {
    expect(csv).toContain(",1234.5,piece,1.05,true,");
    expect(csv).toContain(",0.75,m3,1.1,false,");
  });

  it("quotes cells that contain commas or quotes", () => {
    expect(csv).toContain('"Hollow ceramic brick 12x18x33, ""flat"", 0.18 m wall"');
  });

  it("neutralises spreadsheet formulas in text cells", () => {
    expect(csv).toContain("'=1:3 cement to sand by volume");
  });

  it("ends with the preliminary label and carries no price column", () => {
    expect(rows[rows.length - 1]).toBe(PRELIMINARY_NOTE);
    expect(PRELIMINARY_NOTE).toBe("Preliminary: not a structural certification");
    expect(rows[0].toLowerCase()).not.toContain("price");
  });
});
