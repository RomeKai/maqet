import { describe, expect, it } from "vitest";
import { parseMeters, roomEditCall, wallEditCall } from "./editCall";
import { editUrl } from "./agentApi";

describe("edit calls", () => {
  it("parses comma and dot decimals, rejects junk and non-positive", () => {
    expect(parseMeters("3,5")).toBe(3.5);
    expect(parseMeters(" 4 ")).toBe(4);
    expect(parseMeters("0")).toBeNull();
    expect(parseMeters("-2")).toBeNull();
    expect(parseMeters("abc")).toBeNull();
  });

  it("builds a set_wall_length call", () => {
    expect(wallEditCall("w3", "6,2")).toEqual({ tool: "set_wall_length", args: { wall: "w3", length_m: 6.2 } });
    expect(wallEditCall("w3", "")).toBeNull();
  });

  it("builds a resize_room call and needs both measures", () => {
    expect(roomEditCall("r2", "3.5", "4")).toEqual({
      tool: "resize_room",
      args: { room: "r2", width_m: 3.5, depth_m: 4 },
    });
    expect(roomEditCall("r2", "3.5", "x")).toBeNull();
  });

  it("targets POST /agent/edit", () => {
    expect(editUrl()).toMatch(/\/agent\/edit$/);
  });
});
