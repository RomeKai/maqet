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

  it("sizes the sheet by content (screen scrolls) and honours the safe-area inset", () => {
    expect(css).toMatch(/\[data-testid="reform-screen"\] \.agent-sheet,\s*\.agent-stage \.agent-sheet\s*\{[^}]*flex:\s*1\s+1\s+0[^}]*min-height:\s*0[^}]*overflow:\s*hidden/);
    expect(rule(".agent-sheet")).toMatch(/safe-area-inset-bottom/);
  });

  it("never collapses the conversation to zero height (bug E)", () => {
    const messages = css.match(/(?:^|[\s}])\.agent-sheet \.agent-messages\s*\{([^}]*)\}/);
    expect(messages, "missing .agent-sheet .agent-messages").not.toBeNull();
    expect(messages![1]).toMatch(/min-height:\s*(?:[6-9]|\d{2,})(?:\.\d+)?rem/);
  });
});

describe("dock structure: only the message list scrolls (bug L)", () => {
  it("scrolls the message list inside a min-h-0 dock", () => {
    expect(css).toMatch(
      /\[data-testid="reform-screen"\] \.agent-sheet \.agent-messages,\s*\.agent-stage \.agent-sheet \.agent-messages\s*\{[^}]*flex:\s*1\s+1\s+0[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/,
    );
  });
  it("keeps the composer, chips, bar un-shrinkable", () => {
    expect(rule(".agent-composer")).toMatch(/flex:\s*none/);
    expect(rule(".agent-bar")).toMatch(/flex:\s*none/);
  });
  it("caps the Design stage dock height", () => {
    expect(rule(".agent-stage")).toMatch(/max-height:\s*55dvh/);
  });
});
