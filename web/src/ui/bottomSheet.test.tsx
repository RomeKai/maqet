import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { BottomSheet } from "./BottomSheet";

describe("BottomSheet", () => {
  const html = renderToString(
    <BottomSheet open onClose={() => {}} title="T" closeLabel="x">body</BottomSheet>,
  );
  it("is a fixed viewport overlay with a backdrop", () => {
    expect(html).toContain("fixed inset-0");
    expect(html).toContain("bg-foreground/55");
  });
  it("is capped at 70dvh with its own scroll", () => {
    expect(html).toContain("max-h-[70dvh]");
    expect(html).toContain("overflow-y-auto");
  });
});
