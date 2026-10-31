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

  it("keeps the dock at content size and honours the safe-area inset", () => {
    expect(rule(".stage-screen .agent-sheet")).toMatch(/flex:\s*1\s+1\s+auto/);
    expect(rule(".agent-sheet")).toMatch(/safe-area-inset-bottom/);
  });
});

describe("dock structure: only the message list scrolls (bug L)", () => {
  it("only the message list scrolls, capped so the hero 3D card keeps its height", () => {
    const r = rule(".stage-screen .agent-sheet .agent-messages");
    expect(r).toMatch(/overflow-y:\s*auto/);
    expect(r).toMatch(/max-height:\s*24dvh/);
  });
  it("keeps the composer, chips, bar un-shrinkable", () => {
    expect(rule(".agent-composer")).toMatch(/flex:\s*none/);
    expect(rule(".agent-bar")).toMatch(/flex:\s*none/);
  });
  it("caps the Design stage dock height", () => {
    expect(rule(".agent-stage")).toMatch(/max-height:\s*55dvh/);
  });
});
