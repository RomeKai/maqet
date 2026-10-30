import { describe, expect, it } from "vitest";
import { classifyArError, arErrorKey } from "./arErrors";

describe("classifyArError", () => {
  it("maps a denied permission", () => {
    expect(classifyArError("NotAllowedError: Permission denied")).toBe("denied");
    expect(classifyArError("SecurityError: blocked")).toBe("denied");
  });
  it("maps an unsupported device or missing hit-test", () => {
    expect(classifyArError("WebXR immersive-ar is not available on this device.")).toBe("unsupported");
    expect(classifyArError("NotSupportedError: nope")).toBe("unsupported");
    expect(classifyArError("This device offers AR but not hit-test.")).toBe("unsupported");
  });
  it("maps a non-HTTPS page", () => {
    expect(classifyArError("WebXR needs a secure context (HTTPS).")).toBe("insecure");
  });
  it("maps the stuck watchdog", () => {
    expect(classifyArError("AR stuck at: session-set")).toBe("stuck");
  });
  it("falls back to other", () => {
    expect(classifyArError("Error: boom")).toBe("other");
  });
  it("has a string key for every class", () => {
    for (const c of ["denied", "unsupported", "insecure", "stuck", "other"] as const) {
      expect(arErrorKey(c)).toMatch(/^measure\.ar\.err\./);
    }
  });
});
