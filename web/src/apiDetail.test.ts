import { describe, expect, it } from "vitest";
import { apiErrorText } from "./apiDetail";

describe("apiErrorText", () => {
  it("unwraps a FastAPI {detail} string so the user never sees raw JSON", () => {
    expect(apiErrorText('{"detail":"no recorded render in replay mode"}', "render 409")).toBe("no recorded render in replay mode");
  });
  it("keeps plain text and truncates it", () => {
    expect(apiErrorText("boom", "x")).toBe("boom");
    expect(apiErrorText("a".repeat(500), "x")).toHaveLength(300);
  });
  it("falls back on empty text and on a non-string detail", () => {
    expect(apiErrorText("", "render 500")).toBe("render 500");
    expect(apiErrorText('{"detail":[{"msg":"bad"}]}', "render 422")).toBe('{"detail":[{"msg":"bad"}]}'.slice(0, 300));
  });
});
