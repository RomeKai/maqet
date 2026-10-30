import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// jsdom has no layout engine: pin the CSS contract that keeps the Reform chat
// dock fully visible above the preliminary footer at ~360 css px.
const css = readFileSync(new URL("./agent.css", import.meta.url), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.[\]"=-]/g, "\\$&");
  const match = new RegExp(String.raw`(?:^|[\s}])${escaped}\s*\{([^}]*)\}`).exec(css);
  expect(match, `missing rule ${selector}`).not.toBeNull();
  return match![1];
}

describe("agent chat dock layout (phone width)", () => {
  it("gives the hint its own full-width row so it is never cut", () => {
    expect(rule(".agent-bar-hint")).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    expect(rule(".agent-bar-left")).toMatch(/display:\s*contents/);
  });

  it("keeps the controls un-shrinkable and the bubbles scrollable", () => {
    expect(rule(".agent-bar")).toMatch(/flex:\s*none/);
    expect(rule(".agent-suggestions")).toMatch(/flex:\s*none/);
    expect(css).toMatch(/\.agent-messages[^{]*\{[^}]*overflow-y:\s*auto/);
  });

  it("clips the sheet inside its flex slot and honours the safe-area inset", () => {
    expect(rule('[data-testid="reform-screen"] .agent-sheet')).toMatch(/overflow:\s*hidden/);
    expect(rule(".agent-sheet")).toMatch(/safe-area-inset-bottom/);
  });
});
