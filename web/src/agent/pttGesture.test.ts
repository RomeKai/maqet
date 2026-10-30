import { describe, expect, it } from "vitest";
import { onPttPress, onPttRelease, TAP_MAX_MS } from "./pttGesture";

describe("push-to-talk gesture (hold = talk, tap = toggle)", () => {
  it("a press while idle starts recording", () => {
    expect(onPttPress(false)).toBe("begin");
  });
  it("a press while latched (tapped on) stops and sends", () => {
    expect(onPttPress(true)).toBe("end");
  });
  it("a long hold sends on release", () => {
    expect(onPttRelease(TAP_MAX_MS + 1)).toBe("end");
  });
  it("a quick tap latches recording on", () => {
    expect(onPttRelease(120)).toBe("latch");
  });
});
