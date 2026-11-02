import { describe, expect, it } from "vitest";
import { dropFailedSnapshot, withSvgNamespace } from "./snapshotState";

describe("dropFailedSnapshot", () => {
  it("clears the card when the URL that failed is the one on screen", () => {
    expect(dropFailedSnapshot("blob:a", "blob:a")).toBeNull();
  });

  it("keeps a newer snapshot when a stale <img> reports an error late (E2E-010 race)", () => {
    expect(dropFailedSnapshot("blob:b", "blob:a")).toBe("blob:b");
  });

  it("stays empty when nothing is shown", () => {
    expect(dropFailedSnapshot(null, "blob:a")).toBeNull();
  });
});

describe("withSvgNamespace", () => {
  it("adds the SVG namespace the server omits so the document loads in an <img> (E2E-010 root cause)", () => {
    const out = withSvgNamespace('<svg data-px-per-m="100" viewBox="0 0 1 1"><g/></svg>');
    expect(out).toBe('<svg xmlns="http://www.w3.org/2000/svg" data-px-per-m="100" viewBox="0 0 1 1"><g/></svg>');
  });

  it("leaves a document that already has the namespace untouched", () => {
    const doc = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';
    expect(withSvgNamespace(doc)).toBe(doc);
  });

  it("does not touch text that is not an svg document", () => {
    expect(withSvgNamespace("not found")).toBe("not found");
  });
});
