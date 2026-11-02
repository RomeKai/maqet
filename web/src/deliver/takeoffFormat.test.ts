import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/takeoff.sample.json";
import { PRELIMINARY_NOTE, buildTakeoffCsv, downloadCsv, flagLabel, formatQuantity, lineNote, orderedStages, parseTakeoff } from "./takeoffFormat";
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

  it("keeps an unknown professional flag code instead of failing", () => {
    const parsed = parseTakeoff({ ...fixture, flags: [{ code: "second_floor" }, { code: "asbestos" }] });
    expect(parsed.flags.map((f) => f.code)).toEqual(["second_floor", "asbestos"]);
    expect(flagLabel("asbestos", "en")).toBe("Another flagged condition");
  });

  it("still rejects a flag without a string code", () => {
    expect(() => parseTakeoff({ ...fixture, flags: [{}] })).toThrow(/flag/i);
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
    const stages = rows.slice(1, -3).map((r) => r.split(",")[0]);
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

  it("appends one flag row per licensed-professional flag after the preliminary note", () => {
    expect(rows.slice(-2)).toEqual(["flag,second_floor,A second floor", "flag,span_over_limit,A span over the limit"]);
  });

  it("writes an unknown flag with the generic text", () => {
    const out = buildTakeoffCsv({ ...takeoff, flags: [{ code: "asbestos" }] });
    expect(out).toContain("flag,asbestos,Another flagged condition");
  });

  it("ends with the preliminary label and carries no price column", () => {
    expect(rows[rows.length - 3]).toBe(PRELIMINARY_NOTE);
    expect(PRELIMINARY_NOTE).toBe("Preliminary: not a structural certification");
    expect(rows[0].toLowerCase()).not.toContain("price");
  });
});

describe("downloadCsv", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("attaches the anchor to the body, clicks it, removes it and revokes the URL later", () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const link = {
      href: "",
      download: "",
      click: () => calls.push("click"),
      remove: () => calls.push("remove"),
    };
    const body = { appendChild: vi.fn((node: unknown) => calls.push(node === link ? "append" : "?")) };
    vi.stubGlobal("document", { createElement: () => link, body });
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: revoke });

    downloadCsv("a,b", "takeoff.csv");

    expect(calls).toEqual(["append", "click", "remove"]);
    expect(link.href).toBe("blob:x");
    expect(link.download).toBe("takeoff.csv");
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });
});

describe("made-to-size openings keep their real width and flag", () => {
  const raw = {
    preliminary: true,
    flags: [],
    stages: [{
      name: "openings",
      items: [{
        material_id: "door-150", unit: "piece", quantity: 1, waste_factor: 1, recipe_source: "provisional", estimated: true,
        name: "Door 1.50 m (made to size)", name_es_AR: "Puerta de 1,50 m (a medida)", width_m: 1.5,
        note: "No catalog door of 1.50 m: ordered to size, not the standard 0.90 m piece.", note_es_AR: "No hay puerta de catálogo de 1,50 m.",
      }],
    }],
  };
  it("parses width and note and picks the locale", () => {
    const line = parseTakeoff(raw).stages.openings![0]!;
    expect(line.width_m).toBe(1.5);
    expect(lineNote(line, "en")).toContain("No catalog door");
    expect(lineNote(line, "es-AR")).toContain("No hay puerta");
  });
});
