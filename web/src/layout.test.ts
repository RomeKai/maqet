import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// jsdom has no layout engine: pin the CSS contract that keeps the preliminary
// footer in normal flow so it never covers the chat input on any stage.
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.[\]"=-]/g, "\$&");
  const match = new RegExp(String.raw`(?:^|[\s}])${escaped}\s*\{([^}]*)\}`).exec(css);
  expect(match, `missing rule ${selector}`).not.toBeNull();
  return match![1];
}

describe("preliminary footer layout", () => {
  it("keeps the app shell on dvh so the keyboard does not hide the input", () => {
    expect(rule(".app")).toMatch(/height:\s*100dvh/);
    expect(rule(".app")).not.toMatch(/\d\s*vh\b(?!.*dvh)/);
  });
  it("keeps the footer in normal flow, never fixed, never shrunk over content", () => {
    const sheet = rule(".sheet");
    expect(sheet).toMatch(/flex:\s*none/);
    expect(sheet).not.toMatch(/position:\s*(fixed|absolute|sticky)/);
    expect(sheet).toMatch(/safe-area-inset-bottom/);
  });
});
