import { describe, expect, it } from "vitest";
import { shouldToggleOnClick } from "./MaquetteSheet";

describe("shouldToggleOnClick", () => {
  it("ignores a ghost touch/mouse click that had no pointer gesture on the handle", () => {
    expect(shouldToggleOnClick(1, false)).toBe(false);
  });
  it("ignores the click that follows a handled pointer gesture", () => {
    expect(shouldToggleOnClick(1, true)).toBe(false);
    expect(shouldToggleOnClick(0, true)).toBe(false);
  });
  it("still lets keyboard activation toggle", () => {
    expect(shouldToggleOnClick(0, false)).toBe(true);
  });
});
