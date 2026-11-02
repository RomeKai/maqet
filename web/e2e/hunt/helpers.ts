import { devices, expect, type Locator, type Page, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const { defaultBrowserType: _browser, ...PIXEL_BASE } = devices["Pixel 7"];
export const PIXEL7 = { ...PIXEL_BASE, viewport: { width: 412, height: 915 } };
export const SMALL = { ...PIXEL_BASE, viewport: { width: 360, height: 740 } };
export const PROFILES = [
  { name: "pixel7", use: PIXEL7 },
  { name: "small360", use: SMALL },
] as const;

export const SHOT_DIR = path.join(process.cwd(), "e2e", "screenshots", "hunt");

export async function shot(page: Page, name: string): Promise<string> {
  mkdirSync(SHOT_DIR, { recursive: true });
  const file = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

/** Collects console errors, page errors and failed/4xx/5xx requests. `expect409` URLs are tolerated. */
export interface Monitor {
  drain(): string[];
}
export function attachMonitor(page: Page, tolerate: RegExp[] = []): Monitor {
  const seen: string[] = [];
  let cursor = 0;
  const ok = (s: string): boolean => tolerate.some((re) => re.test(s));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const s = `console.error: ${m.text()} (${m.location().url})`;
    if (!ok(s)) seen.push(s);
  });
  page.on("pageerror", (e) => seen.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => {
    const f = r.failure()?.errorText ?? "failed";
    if (f.includes("ERR_ABORTED")) return;
    const s = `requestfailed: ${r.method()} ${r.url()} ${f}`;
    if (!ok(s)) seen.push(s);
  });
  page.on("response", (r) => {
    if (r.status() < 400) return;
    const s = `http ${r.status()}: ${r.request().method()} ${r.url()}`;
    if (!ok(s)) seen.push(s);
  });
  return {
    drain() {
      const out = seen.slice(cursor);
      cursor = seen.length;
      return out;
    },
  };
}

/** Everything the per-screen checklist inspects, in one page.evaluate. Returns human-readable issues. */
export async function auditLayout(page: Page): Promise<{ overflow: string[]; small: string[]; overlap: string[]; clipped: string[] }> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const visible = (el: HTMLElement): DOMRect | null => {
      if (el.closest('[aria-hidden="true"], [hidden], [inert]')) return null;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return null;
      return r;
    };
    const label = (el: HTMLElement): string =>
      `${el.tagName.toLowerCase()}[${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 28)}]`;

    const overflow: string[] = [];
    if (document.documentElement.scrollWidth > vw + 1) overflow.push(`doc scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const r = visible(el);
      if (!r || getComputedStyle(el).position === "fixed") continue;
      if (r.right > vw + 1 || r.left < -1) {
        let p: HTMLElement | null = el.parentElement;
        let scrolls = false;
        while (p && p !== document.body) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") scrolls = true;
          p = p.parentElement;
        }
        if (!scrolls) overflow.push(`${label(el)} left=${Math.round(r.left)} right=${Math.round(r.right)}`);
      }
    }

    const sel = 'button, a[href], input:not([type="hidden"]):not([type="file"]), select, textarea, [role="button"], [role="tab"], [role="radio"], [role="checkbox"], summary';
    const targets: { el: HTMLElement; r: DOMRect }[] = [];
    const small: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = visible(el);
      if (!r) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue; // only what is on screen now
      // Only what the user can actually hit: a sheet/backdrop on top hides the controls below it.
      const cx = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1);
      const cy = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1);
      const top = document.elementFromPoint(cx, cy);
      if (!top || !(el === top || el.contains(top) || top.contains(el))) continue;
      targets.push({ el, r });
      if (Math.min(r.width, r.height) < 43.5) small.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const overlap: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const a = targets[i];
        const b = targets[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 2 && h > 2) overlap.push(`${label(a.el)} x ${label(b.el)} (${Math.round(w)}x${Math.round(h)})`);
      }
    }
    const clipped: string[] = [];
    for (const { el } of targets) {
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible") clipped.push(`${label(el)} scrollWidth ${el.scrollWidth} > ${el.clientWidth}`);
    }
    return { overflow, small, overlap, clipped };
  });
}

/** The pieces of the checklist that apply to every screen; each returns issues so callers can mark known bugs. */
export async function checkPreliminary(page: Page, locale: "en" | "es" = "en"): Promise<boolean> {
  const re = locale === "es" ? /Preliminar/i : /Preliminary/i;
  return page.getByText(re).filter({ visible: true }).count().then((n) => n > 0);
}

/** English words that must not appear while the UI is in es-AR (product nouns like DXF/CSV/AR/3D are fine). */
export const ENGLISH_MARKERS = [
  "Preliminary", "Download", "Staged takeoff", "Next steps", "Foundations", "Walls", "Openings", "Finishes",
  "Furniture", "Placed", "Undo", "Send", "Type a message", "Hold to talk", "Variants", "Fork", "Edit measures",
  "Apply", "Cancel", "Back", "Capture", "Reform", "Design", "Present", "Deliver", "Share with", "Details",
  "Looks right", "Your projects", "Start capture", "Continue", "Try again", "Remove", "Close", "Show 3D",
  "Floor area", "In real life", "Wall", "Door", "Window", "Rule", "Warning", "Applied", "Rejected",
];

export async function englishLeaks(page: Page): Promise<string[]> {
  const text = await page.evaluate(() => document.body.innerText);
  const leaks: string[] = [];
  for (const w of ENGLISH_MARKERS) {
    if (new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "u").test(text)) leaks.push(w);
  }
  return leaks;
}

export async function setLocale(page: Page, which: "en" | "es"): Promise<void> {
  const group = page.getByRole("radiogroup", { name: /Language|Idioma/ });
  await group.getByRole("radio", { name: which === "es" ? "Español" : "English" }).click();
}

/** Mocked agent turn: echoes the scene, optional reply/errors/delay. Returns the captured request bodies. */
export interface TurnMock {
  bodies: { message: string; conversation?: { role: string; text: string }[]; scene: unknown }[];
}
export interface TurnOptions {
  reply?: string | ((n: number) => string);
  ops?: { name: string; arguments: Record<string, unknown>; flags?: string[] }[];
  errors?: string[];
  warnings?: string[];
  flags?: string[];
  status?: number;
  delayMs?: number;
}
export async function mockTurns(page: Page, opts: TurnOptions = {}): Promise<TurnMock> {
  const mock: TurnMock = { bodies: [] };
  await page.route("**/api/agent/turn", async (route: Route) => {
    const body = route.request().postDataJSON() as TurnMock["bodies"][number];
    mock.bodies.push(body);
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.status && opts.status >= 400) {
      await route.fulfill({ status: opts.status, json: { detail: "Preliminary: something unexpected failed on the server; no scene was stored." } });
      return;
    }
    const reply = typeof opts.reply === "function" ? opts.reply(mock.bodies.length) : (opts.reply ?? "Done.");
    await route.fulfill({
      json: {
        reply,
        scene: body.scene,
        ops_applied: opts.ops ?? [],
        history: [],
        professional_flags: opts.flags ?? [],
        tool_errors: opts.errors ?? [],
        tool_warnings: opts.warnings ?? [],
      },
    });
  });
  return mock;
}

/** Home -> method -> sample sketch loaded in the plan editor (mode C). */
export async function loadSample(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Start capture" }).click();
  await page.locator("[data-method=photo]").click();
  await page.getByRole("button", { name: /Sample sketch/ }).or(page.getByText("Try a sample")).first().click();
  await expect(page.getByRole("application", { name: "Plan editor" })).toBeVisible({ timeout: 30_000 });
}

export const stageTab = (page: Page, name: RegExp): Locator => page.locator("nav button, nav [role=tab]").filter({ hasText: name }).first();

/** Capture editor -> Check -> Looks right -> Reform. */
export async function toReform(page: Page): Promise<void> {
  const editor = page.locator(".capture-editor");
  for (let i = 0; i < 3; i++) {
    const next = editor.getByRole("button", { name: "Next" });
    if (await next.isVisible().catch(() => false)) await next.click();
  }
  await editor.getByRole("button", { name: "Looks right" }).click();
  await expect(page.getByTestId("reform-screen")).toBeVisible();
}
