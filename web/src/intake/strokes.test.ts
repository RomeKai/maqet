import { beforeAll, describe, expect, it } from "vitest";

interface FsLike {
  readFileSync: (url: URL, enc: string) => string;
}

let css = "";

beforeAll(async () => {
  // Vitest stubs CSS imports (even ?raw), so read the stylesheet from disk.
  const specifier = "node:fs";
  const fs = (await import(/* @vite-ignore */ specifier)) as FsLike;
  css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
});

function widthOf(selector: string): string | null {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return null;
  const body = css.slice(start, css.indexOf("}", start));
  const w = /stroke-width:\s*([\d.]+px)/.exec(body);
  return w === null ? null : (w[1] ?? null);
}

describe("sketch stroke widths (screen px)", () => {
  it("walls 5px, openings 7px, selected wall 7px with a halo", () => {
    expect(widthOf(".intake-svg .wall")).toBe("5px");
    expect(widthOf(".intake-svg .opening-door")).toBe("7px");
    expect(widthOf(".intake-svg .opening-window")).toBe("7px");
    expect(widthOf(".intake-svg .wall-selected")).toBe("7px");
    expect(css.slice(css.indexOf(".intake-svg .wall-selected {"))).toMatch(/^[^}]*drop-shadow/);
  });
});
