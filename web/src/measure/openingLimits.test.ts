import { describe, expect, it } from "vitest";
import { captureReducer, initialCaptureState, roomSanity, round2, type CaptureEvent } from "./captureSession";
import { parseDecimalInput, showDecimal } from "./MeasureReview";

function run(events: CaptureEvent[]) {
  let s = initialCaptureState();
  let error: string | null = null;
  for (const e of events) {
    const r = captureReducer(s, e);
    s = r.state;
    error = r.error;
  }
  return { state: s, error };
}

const oneWall: CaptureEvent[] = [
  { type: "floorHit", point: [0, 0, 0], horizontal: true },
  { type: "baseTap", point: [0, 0, 0] },
  { type: "baseTap", point: [3, 0, 0] },
  { type: "ceilingConfirm", heightM: 2.6 },
];

describe("opening limits", () => {
  it("refuses a door narrower than 0.60 m and keeps the first point", () => {
    const r = run([...oneWall, { type: "modeChange", mode: "door" },
      { type: "openingTap", point: [1, 1, 0], defaults: true },
      { type: "openingTap", point: [1.22, 1, 0], defaults: true }]);
    expect(r.error).toBe("opening-too-narrow");
    expect(r.state.openings).toHaveLength(0);
    expect(r.state.pendingOpening).not.toBeNull();
  });
  it("refuses a window narrower than 0.40 m but accepts 0.45 m", () => {
    const base: CaptureEvent[] = [...oneWall, { type: "modeChange", mode: "window" }, { type: "openingTap", point: [1, 1, 0], defaults: true }];
    expect(run([...base, { type: "openingTap", point: [1.3, 1, 0], defaults: true }]).error).toBe("opening-too-narrow");
    expect(run([...base, { type: "openingTap", point: [1.45, 1, 0], defaults: true }]).state.openings).toHaveLength(1);
  });
  it("snaps a small overshoot to the wall end and refuses a big one", () => {
    const base: CaptureEvent[] = [...oneWall, { type: "modeChange", mode: "door" }, { type: "openingTap", point: [2, 1, 0], defaults: true }];
    const snapped = run([...base, { type: "openingTap", point: [3.05, 1, 0], defaults: true }]).state.openings[0]!;
    expect(snapped.offset_m + snapped.width_m).toBeCloseTo(3, 6);
    expect(run([...base, { type: "openingTap", point: [3.5, 1, 0], defaults: true }]).error).toBe("opening-outside");
  });
  it("rounds typed heights to 0.01", () => {
    const r = run([...oneWall.slice(0, 3), { type: "ceilingConfirm", heightM: 2.085859112 }]);
    expect(r.state.walls[0]?.heightM).toBe(2.09);
  });
});

describe("room sanity and number display", () => {
  const sq = (n: number) => [
    { id: "wall-1", start: { x: 0, z: 0 }, end: { x: n, z: 0 }, heightM: 2.6 },
    { id: "wall-2", start: { x: n, z: 0 }, end: { x: n, z: n }, heightM: 2.6 },
    { id: "wall-3", start: { x: n, z: n }, end: { x: 0, z: n }, heightM: 2.6 },
    { id: "wall-4", start: { x: 0, z: n }, end: { x: 0, z: 0 }, heightM: 2.6 },
  ] as never;
  it("warns on a tiny room and stays quiet on a normal one", () => {
    expect(roomSanity(sq(0.9)).tooSmall).toBe(true);
    expect(roomSanity(sq(3)).tooSmall).toBe(false);
  });
  it("shows 2 decimals with locale separator and parses comma or dot", () => {
    expect(showDecimal(2.085859112, "en")).toBe("2.09");
    expect(showDecimal(2.085859112, "es-AR")).toBe("2,09");
    expect(parseDecimalInput("2,4")).toBe(2.4);
    expect(parseDecimalInput("2.4")).toBe(2.4);
    expect(parseDecimalInput("")).toBeNull();
    expect(round2(0.2217)).toBe(0.22);
  });
});
