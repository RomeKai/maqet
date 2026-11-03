import { describe, expect, it } from "vitest";

async function loadCss(): Promise<string> {
  // @ts-ignore node types not in web tsconfig; vitest runs on node and has them
  const { readFile } = await import("node:fs/promises");
  return readFile(new URL("./agent.css", import.meta.url), "utf8");
}

/** Every rule block (selector list + body) that sits inside a max-height media query. */
function shortScreenRules(css: string): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  const media = /@media\s*\(max-height:[^{]*\{((?:[^{}]*\{[^}]*\})*)\s*\}/g;
  for (const m of css.matchAll(media)) {
    for (const r of m[1].matchAll(/([^{}]+)\{([^}]*)\}/g)) rules.push({ selector: r[1].trim(), body: r[2] });
  }
  return rules;
}

describe("compact chat Next button on short phones", () => {
  it("is never hidden by a max-height media query (the suggestion chips may be)", async () => {
    const hiding = shortScreenRules(await loadCss()).filter(
      (r) => /display:\s*none/.test(r.body) && /agent-suggestions/.test(r.selector) && !/:not\(\.agent-next\)|\.agent-suggestion\b(?!s)/.test(r.selector),
    );
    expect(hiding).toEqual([]);
  });

  it("has a touch target of at least 48px", async () => {
    const css = await loadCss();
    const body = /\.agent-next\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const min = Number(/min-height:\s*(\d+)px/.exec(body)?.[1] ?? 0);
    expect(min).toBeGreaterThanOrEqual(48);
  });
});

describe("Reform/Design stage keeps the dock on screen", () => {
  it("never lets the stage scroll or the dock refuse to shrink (composer and Next would slip under the footer)", async () => {
    const css = await loadCss();
    const rules = [...css.matchAll(/([^{}@]+)\{([^}]*)\}/g)].map((r) => ({ selector: r[1].trim(), body: r[2] }));
    const stageScroll = rules.filter((r) => /(^|,)\s*(\.app:has\([^)]*\)\s+)?\.stage-screen\s*$/.test(r.selector) && /overflow-y:\s*auto/.test(r.body));
    expect(stageScroll).toEqual([]);
    const rigid = rules.filter((r) => /\.stage-screen \.agent-sheet\s*$/.test(r.selector) && /min-height:\s*min-content/.test(r.body));
    expect(rigid).toEqual([]);
  });

  it("lets the 3D hero shrink to a floor instead of a fixed share of the viewport", async () => {
    const css = await loadCss();
    expect(/\.stage-screen \.agent-card\s*\{[^}]*min-height:/.test(css)).toBe(true);
  });
});
