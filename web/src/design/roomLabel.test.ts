import { describe, expect, it } from "vitest";
import { roomLabel } from "./roomLabel";

describe("roomLabel", () => {
  it("keeps human names", () => expect(roomLabel({ id: "r1", name: "Nursery" }, 0, "en")).toBe("Nursery"));
  it("never shows ids", () => {
    expect(roomLabel({ id: "room-1", name: "room-1" }, 0, "en")).toBe("Room 1");
    expect(roomLabel({ id: "r2", name: "r2" }, 1, "es-AR")).toBe("Ambiente 2");
  });
  it("falls back to the function", () => expect(roomLabel({ id: "r1", name: "room-1", function: "bedroom" }, 0, "en")).toBe("Bedroom"));
});
