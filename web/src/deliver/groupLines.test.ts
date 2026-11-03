import { describe, expect, it } from "vitest";
import { groupLines } from "./takeoffFormat";
import type { TakeoffLine } from "./takeoffTypes";

function line(over: Partial<TakeoffLine> = {}): TakeoffLine {
  return {
    material_id: "m",
    name: "Surface with no material chosen (area only)",
    quantity: 1.5,
    purchase_quantity: 1.5,
    unit: "m2",
    waste_factor: 1,
    recipe_source: "r",
    estimated: false,
    ...over,
  };
}

describe("groupLines", () => {
  it("sums rows with the same label, unit and estimated state and rounds the total once", () => {
    const grouped = groupLines([line({ quantity: 1.501 }), line({ quantity: 2.501 }), line({ quantity: 0.001 })], "en");
    expect(grouped).toHaveLength(1);
    expect(grouped[0].quantity).toBeCloseTo(4.003);
    expect(grouped[0].purchase_quantity).toBe(4.01);
  });

  it("keeps estimated and non-estimated rows apart, and different units", () => {
    const grouped = groupLines([line(), line({ estimated: true }), line({ unit: "m" })], "en");
    expect(grouped).toHaveLength(3);
  });

  it("keeps the first-seen order and leaves different labels alone", () => {
    const grouped = groupLines([line({ name: "A" }), line({ name: "B" }), line({ name: "A" })], "en");
    expect(grouped.map((g) => g.name)).toEqual(["A", "B"]);
  });

  it("does not merge made-to-size rows with different notes", () => {
    const grouped = groupLines([line({ note: "No catalog door of 1.50 m" }), line({ note: "No catalog door of 2.00 m" })], "en");
    expect(grouped).toHaveLength(2);
  });
});
