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

import { backdropShouldClose } from "./BottomSheet";

describe("backdrop click-through (sheet opened by a pointerup)", () => {
  it("ignores the trailing click of the tap that opened the sheet", () => {
    // pointerdown happened on the canvas, before the sheet existed.
    expect(backdropShouldClose(false)).toBe(false);
  });
  it("closes on a real tap that started on the backdrop", () => {
    expect(backdropShouldClose(true)).toBe(true);
  });
});
