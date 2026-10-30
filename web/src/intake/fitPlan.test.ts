import { describe, expect, it } from "vitest";
import { fitPlan, planToCanvas, canvasToPlan } from "./fitPlan";

const walls = [
  { a: [0, 0], b: [3, 0] },
  { a: [3, 0], b: [3, 8] },
  { a: [3, 8], b: [0, 8] },
  { a: [0, 8], b: [0, 0] },
] as { a: [number, number]; b: [number, number] }[];

describe("fitPlan (no photo)", () => {
  it("fits a 3x8 m plan inside the canvas with a margin on every side", () => {
    const fit = fitPlan(walls);
    for (const w of walls) {
      for (const p of [w.a, w.b]) {
        const c = planToCanvas(fit, p[0], p[1]);
        expect(c.x).toBeGreaterThanOrEqual(fit.canvasW * 0.05);
        expect(c.x).toBeLessThanOrEqual(fit.canvasW * 0.95);
        expect(c.y).toBeGreaterThanOrEqual(fit.canvasH * 0.05);
        expect(c.y).toBeLessThanOrEqual(fit.canvasH * 0.95);
      }
    }
  });
  it("keeps the aspect ratio of the plan (3:8 stays tall)", () => {
    const fit = fitPlan(walls);
    expect(fit.canvasH / fit.canvasW).toBeGreaterThan(1.8);
    expect(fit.canvasH / fit.canvasW).toBeLessThan(3.2);
  });
  it("round-trips canvas <-> plan", () => {
    const fit = fitPlan(walls);
    const c = planToCanvas(fit, 1.5, 4);
    const p = canvasToPlan(fit, c.x, c.y);
    expect(p.x).toBeCloseTo(1.5, 9);
    expect(p.y).toBeCloseTo(4, 9);
  });
  it("is stable for a single point or empty plan", () => {
    expect(fitPlan([]).canvasW).toBeGreaterThan(0);
    expect(fitPlan([{ a: [1, 1], b: [1, 1] }]).scale).toBeGreaterThan(0);
  });
});
