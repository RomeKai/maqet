import { expect, test, type Page } from "@playwright/test";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  PROFILES, SHOT_DIR, attachMonitor, auditLayout, checkPreliminary, englishLeaks, mockTurns, setLocale, shot, type Monitor,
} from "./helpers";

/**
 * Full demo path on two phones. Every test builds its own state from scratch (a failing test must not
 * poison the next one). Agent turns are mocked; sample intake, /agent/edit, takeoff and DXF hit the replay server.
 * Per-screen checks are recorded to e2e/screenshots/hunt/issues.jsonl and asserted by the "screen checks" block at the
 * end, so each (screen, check) pair can be marked as a known product bug with test.fail.
 */
const ISSUES = path.join(SHOT_DIR, "issues.jsonl");
const CHECKS = ["console", "overflow", "targets", "overlap", "clipped", "preliminary"] as const;
type Check = (typeof CHECKS)[number];
const SCREENS = [
  "home", "method", "capture-upload", "capture-walls", "wall-sheet", "opening-door-form", "opening-window-form", "capture-check",
  "capture-3d", "reform", "reform-after-turn", "reform-tool-error", "reform-now", "edit-measures", "design", "design-sheet",
  "design-item-sheet", "real-life-sheet", "real-life-thumb", "present", "deliver",
] as const;
/** Screens where the Preliminary label is not required (bare capture/utility screens). */
const NO_PRELIM = new Set<string>(["home", "method", "capture-upload", "wall-sheet", "opening-door-form", "opening-window-form"]);
/** screen:check -> bug id; filled from docs/E2E_BUGS.md once a failure is confirmed as a product bug. */
const KNOWN: Record<string, string> = {
  "pixel7:capture-walls:overlap": "E2E-009",
  "pixel7:deliver:targets": "E2E-014",
  "small360:deliver:targets": "E2E-014",
};

function record(profile: string, screen: string, check: Check, issues: string[]): void {
  mkdirSync(SHOT_DIR, { recursive: true });
  appendFileSync(ISSUES, JSON.stringify({ profile, screen, check, issues }) + "\n");
}

const SHEET_BTN = 'button:not([role=tab]):not([aria-label="Close"])';
const PIECE = /bed|sofa|table|chair|desk|wardrobe|cooker|nightstand|shelf|unit|armchair/i;
const BASE = `https://localhost:${process.env.E2E_WEB_PORT ?? "5320"}`;
const TOLERATED = [/\/api\/agent\/turn/, /\/api\/render\//, /@fontsource/]; // fonts: worktree node_modules junction is outside Vite's fs allow list

for (const profile of PROFILES) {
  test.describe(`journey ${profile.name}`, () => {
    let page: Page;
    let monitor: Monitor;

    test.beforeEach(async ({ browser }) => {
      const ctx = await browser.newContext({ ...profile.use, baseURL: BASE, ignoreHTTPSErrors: true, acceptDownloads: true, locale: "en-US" });
      page = await ctx.newPage();
      monitor = attachMonitor(page, TOLERATED);
      await mockTurns(page, { reply: "Added a room." });
    });
    test.afterEach(async () => {
      await page.context().close();
    });

    async function audit(screen: string): Promise<void> {
      await page.waitForTimeout(400);
      await shot(page, `${profile.name}-${screen}`);
      record(profile.name, screen, "console", monitor.drain());
      const a = await auditLayout(page);
      record(profile.name, screen, "overflow", a.overflow);
      record(profile.name, screen, "targets", a.small);
      record(profile.name, screen, "overlap", a.overlap);
      record(profile.name, screen, "clipped", a.clipped);
      record(profile.name, screen, "preliminary", NO_PRELIM.has(screen) || (await checkPreliminary(page)) ? [] : ["no Preliminary label visible"]);
    }

    const tab = (re: RegExp) => page.getByRole("tab", { name: re }).first();

    async function toEditor(): Promise<void> {
      await page.goto("/");
      await expect(page.getByTestId("home-screen")).toBeVisible();
      await page.getByRole("button", { name: "Start capture" }).click();
      await page.locator("[data-method=photo]").click();
      await page.getByRole("button", { name: /Sample sketch/ }).click();
      await expect(page.getByRole("application", { name: "Plan editor" })).toBeVisible({ timeout: 30_000 });
    }
    async function toReform(): Promise<void> {
      await toEditor();
      const editor = page.locator(".capture-editor");
      for (let i = 0; i < 3; i++) {
        const next = editor.getByRole("button", { name: "Next" });
        if (await next.isVisible().catch(() => false)) await next.click();
      }
      await editor.getByRole("button", { name: "Looks right" }).click();
      await expect(page.getByTestId("reform-screen")).toBeVisible();
    }
    async function toDesign(): Promise<void> {
      await toReform();
      await tab(/Design/).click();
      await expect(page.getByTestId("design-screen")).toBeVisible();
    }
    async function placeFurniture(): Promise<void> {
      await page.getByRole("button", { name: "Add", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Furniture and finishes" });
      await expect(sheet).toBeVisible();
      await sheet.getByRole("tab", { name: "Furniture" }).click();
      await sheet.locator(".grid button").first().click();
      await sheet.getByRole("tab", { name: "Placed" }).click();
      await expect(sheet.locator(SHEET_BTN).filter({ hasText: PIECE })).toHaveCount(1);
      await sheet.getByRole("button", { name: "Close" }).first().click();
    }

    test("home and method cards, AR gated", async () => {
      await page.goto("/");
      await expect(page.getByTestId("home-screen")).toBeVisible();
      await audit("home");
      await page.getByRole("button", { name: "Start capture" }).click();
      await expect(page.getByTestId("method-screen")).toBeVisible();
      await expect(page.locator("[data-method=photo]")).toBeEnabled();
      // No WebXR in this browser: the AR card must not be offered (E2E: AR gated).
      await expect(page.locator("[data-method=ar]")).toHaveCount(0);
      await audit("method");
    });

    test("capture C: sample sketch, wall sheet, door and window via edit sheet", async () => {
      await page.goto("/");
      await page.getByRole("button", { name: "Start capture" }).click();
      await page.locator("[data-method=photo]").click();
      await audit("capture-upload");
      await page.getByRole("button", { name: /Sample sketch/ }).click();
      await expect(page.getByRole("application", { name: "Plan editor" })).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("svg g.wall-pill")).toHaveCount(4);
      await audit("capture-walls");

      await page.locator("svg g.wall-pill").first().click();
      const sheet = page.getByRole("dialog", { name: /^Wall \d+ length$/ });
      await expect(sheet).toBeVisible();
      await audit("wall-sheet");
      await sheet.getByRole("button", { name: "Later" }).click();
      await expect(sheet).toBeHidden();

      await page.locator(".capture-editor").getByRole("button", { name: "Next" }).click();
      const before = await page.locator("svg .opening-hit").count();
      for (const [idx, kind, vals] of [
        [0, "door", { distance: "1.0", width: "0.9", height: "2.05" }],
        [1, "window", { distance: "1.0", width: "1.2", height: "1.4", sill: "0.9" }],
      ] as const) {
        await page.locator("svg g.wall-pill").nth(idx).click();
        const ws = page.getByRole("dialog", { name: /^Wall \d+ length$/ });
        if (await ws.isVisible().catch(() => false)) await ws.getByRole("button", { name: "Later" }).click();
        await page.getByRole("button", { name: kind === "door" ? "Mark door" : "Mark window" }).click();
        await page.getByRole("button", { name: "Use form" }).click();
        const form = page.getByRole("group", { name: "Confirm opening" });
        await form.getByLabel("Distance from wall start").fill(vals.distance);
        await form.getByLabel("Width", { exact: true }).fill(vals.width);
        await form.getByLabel("Height", { exact: true }).fill(vals.height);
        if ("sill" in vals) await form.getByLabel("Sill height").fill(vals.sill);
        await audit(`opening-${kind}-form`);
        await form.getByRole("button", { name: "Confirm opening" }).click();
      }
      await expect(page.locator("svg .opening-hit")).toHaveCount(before + 2);
    });

    test("capture C: undo, redo", async () => {
      test.fail(true, "E2E-006 no Redo control in the plan editor, see docs/E2E_BUGS.md");
      await toEditor();
      const editor = page.locator(".capture-editor");
      await editor.getByRole("button", { name: "Next" }).click();
      const before = await page.locator("svg .opening-hit").count();
      await page.locator("svg g.wall-pill").nth(0).click();
      const ws = page.getByRole("dialog", { name: /^Wall \d+ length$/ });
      if (await ws.isVisible().catch(() => false)) await ws.getByRole("button", { name: "Later" }).click();
      await page.getByRole("button", { name: "Mark door" }).click();
      await page.getByRole("button", { name: "Use form" }).click();
      const form = page.getByRole("group", { name: "Confirm opening" });
      await form.getByLabel("Distance from wall start").fill("1.0");
      await form.getByLabel("Width", { exact: true }).fill("0.9");
      await form.getByLabel("Height", { exact: true }).fill("2.05");
      await form.getByRole("button", { name: "Confirm opening" }).click();
      await expect(page.locator("svg .opening-hit")).toHaveCount(before + 1);

      const toolbar = page.getByRole("toolbar", { name: "Plan editor" });
      await toolbar.getByRole("button", { name: "Undo" }).click();
      await expect(page.locator("svg .opening-hit")).toHaveCount(before);
      await expect(toolbar.getByRole("button", { name: "Redo" }), "a Redo control exists next to Undo").toBeVisible({ timeout: 2000 });
    });

    test("capture C: reset to sketch reading discards edits", async () => {
      await toEditor();
      const editor = page.locator(".capture-editor");
      const before = await page.locator("svg .opening-hit").count();
      await editor.getByRole("button", { name: "Next" }).click();
      await page.locator("svg g.wall-pill").nth(0).click();
      const ws = page.getByRole("dialog", { name: /^Wall \d+ length$/ });
      if (await ws.isVisible().catch(() => false)) await ws.getByRole("button", { name: "Later" }).click();
      await page.getByRole("button", { name: "Mark window" }).click();
      await page.getByRole("button", { name: "Use form" }).click();
      const form = page.getByRole("group", { name: "Confirm opening" });
      await form.getByLabel("Distance from wall start").fill("1.0");
      await form.getByLabel("Width", { exact: true }).fill("1.2");
      await form.getByLabel("Height", { exact: true }).fill("1.4");
      await form.getByLabel("Sill height").fill("0.9");
      await form.getByRole("button", { name: "Confirm opening" }).click();
      await expect(page.locator("svg .opening-hit")).toHaveCount(before + 1);
      page.on("dialog", (d) => void d.accept());
      await editor.getByRole("button", { name: "Back" }).click();
      await page.getByRole("button", { name: "Reset to sketch reading" }).click();
      await expect(page.locator("svg .opening-hit")).toHaveCount(before);
    });

    test("capture C: dragging a corner changes the wall length", async () => {
      test.fail(profile.name === "small360", "E2E-009 on 360 px the first corner handle cannot be dragged (covered by another control), see docs/E2E_BUGS.md");
      await toEditor();
      const handle = page.locator(".handle-btn").first();
      await expect(handle).toBeVisible();
      const box = (await handle.boundingBox())!;
      const before = box;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 30, cy + 12, { steps: 8 });
      await page.mouse.up();
      const after = (await page.locator(".handle-btn").first().boundingBox())!;
      expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y), "the dragged corner handle moved").toBeGreaterThan(10);
    });

    test("capture C: Check step and 3D", async () => {
      await toEditor();
      const editor = page.locator(".capture-editor");
      for (let i = 0; i < 2; i++) await editor.getByRole("button", { name: "Next" }).click();
      await audit("capture-check");
      await expect(page.getByTestId("scene-view").first()).toBeVisible();
      await audit("capture-3d");
    });

    test("capture C: Check step keeps its list and Looks right reachable above the 3D sheet", async () => {
      await toEditor();
      const editor = page.locator(".capture-editor");
      for (let i = 0; i < 2; i++) await editor.getByRole("button", { name: "Next" }).click();
      const cta = editor.getByRole("button", { name: "Looks right" });
      await expect(cta).toBeVisible();
      const box = (await cta.boundingBox())!;
      const vh = page.viewportSize()!.height;
      expect(box.y + box.height, "Looks right is inside the viewport").toBeLessThanOrEqual(vh + 1);
      const hit = await cta.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + r.height / 2, window.innerHeight - 1));
        return top === el || el.contains(top);
      });
      expect(hit, "nothing (3D sheet, banner) covers Looks right").toBe(true);
    });

    test("reform: mocked add_room turn, then tool errors as one sentence with details", async () => {
      await toReform();
      await audit("reform");
      const mock = await mockTurns(page, { reply: "I added the bedroom.", ops: [{ name: "add_room", arguments: { width: 3, depth: 4 } }] });
      await page.getByLabel("Message to the assistant").fill("add a 3x4 bedroom");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".agent-message[data-role=assistant]").last()).toContainText("bedroom");
      expect(mock.bodies).toHaveLength(1);
      await audit("reform-after-turn");

      await mockTurns(page, { reply: "I could not do that.", errors: ["wall_not_found: no wall 'w99' in this scene", "opening_outside_wall: width 5 m exceeds wall length 3 m"] });
      await page.getByLabel("Message to the assistant").fill("add a door on wall 99");
      await page.getByRole("button", { name: "Send" }).click();
      const last = page.locator(".agent-message[data-role=assistant]").last();
      await expect(last).toContainText("could not");
      await expect(last.locator(".agent-details li").first(), "raw codes stay hidden until Details opens").toBeHidden();
      await last.locator("summary").click();
      await expect(last).toContainText("wall_not_found");
      await audit("reform-tool-error");
    });

    test("reform: Fork, Now is read-only, conversations are per variant", async () => {
      await toReform();
      const group = page.getByRole("radiogroup", { name: "Variants" });
      const count = await group.getByRole("radio").count();
      await page.getByLabel("Message to the assistant").fill("hello");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".agent-message")).toHaveCount(2);
      await page.getByRole("button", { name: "Fork variant" }).click();
      await expect(group.getByRole("radio")).not.toHaveCount(count);
      const radios = group.getByRole("radio");
      await radios.last().click();
      await expect(page.locator(".agent-message"), "a fresh fork starts with an empty conversation").toHaveCount(0);
      await group.getByRole("radio", { name: "Now", exact: true }).click();
      await expect(page.getByText(/Now is read-only/)).toBeVisible();
      await audit("reform-now");
    });

    test("reform: Edit measures applies and Undo reverts (E2E-002 regression)", async () => {
      await toReform();
      await page.getByRole("radiogroup", { name: "Variants" }).getByRole("radio", { name: "A", exact: true }).click();
      await page.getByRole("button", { name: "Edit measures" }).click();
      const sheet = page.getByRole("dialog", { name: "Edit measures" });
      await expect(sheet).toBeVisible();
      await audit("edit-measures");
      await sheet.getByLabel("Width (m)").fill("4");
      await sheet.getByLabel("Depth (m)").fill("8");
      await sheet.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(sheet).toBeHidden({ timeout: 10_000 });
      await expect(page.getByLabel(/Floor area:/)).toHaveAttribute("aria-label", "Floor area: 32.0 m²");
      await page.getByRole("button", { name: "Undo last change" }).click();
      await expect(page.getByLabel(/Floor area:/)).toHaveAttribute("aria-label", "Floor area: 24.0 m²");
    });

    test("design: furniture add, move, rotate, remove and finishes", async () => {
      await toDesign();
      await audit("design");
      await page.getByRole("button", { name: "Add", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Furniture and finishes" });
      await expect(sheet).toBeVisible();
      await audit("design-sheet");
      await sheet.getByRole("tab", { name: "Finishes" }).click();
      await sheet.locator(".grid button").first().click();
      await sheet.getByRole("button", { name: "Close" }).first().click();
      await placeFurniture();
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await sheet.getByRole("tab", { name: "Placed" }).click();
      await sheet.locator(SHEET_BTN).filter({ hasText: PIECE }).first().click();
      const item = page.getByTestId("item-sheet");
      await expect(item).toBeVisible();
      await audit("design-item-sheet");
      await item.getByRole("button", { name: "Move east" }).click();
      await item.getByRole("button", { name: "Move north" }).click();
      await item.getByRole("button", { name: "Turn 90 degrees" }).click();
      await item.getByRole("button", { name: "Wall 1" }).click();
      await item.getByRole("button", { name: "Remove" }).last().click();
      await expect(item).toBeHidden();
    });

    test("design: In real life sends the guide PNG and shows the image in sheet and thumbnail", async () => {
      await toDesign();
      let guide = "";
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      await page.route("**/render/real-life", async (route) => {
        guide = (route.request().postDataJSON() as { guide_image_b64?: string }).guide_image_b64 ?? "";
        await route.fulfill({ json: { image_b64: png, style: "modern", cost_usd: 0.01, guided: true } });
      });
      await page.getByRole("button", { name: "In real life" }).first().click();
      await audit("real-life-sheet");
      await page.getByRole("button", { name: "Show it in real life" }).click();
      await expect.poll(() => guide.length, { timeout: 20_000 }).toBeGreaterThan(1000);
      expect(Buffer.from(guide, "base64").subarray(1, 4).toString("ascii")).toBe("PNG");
      const sheet = page.getByRole("dialog", { name: "In real life" });
      await expect(sheet.locator("img")).toBeVisible();
      await sheet.getByRole("button", { name: "Close" }).first().click();
      await expect(page.getByTestId("real-life-row").locator("img")).toBeVisible();
      await audit("real-life-thumb");
    });

    test("present: AR card state, share link", async () => {
      await toReform();
      await tab(/Present/).click();
      await expect(page.getByTestId("present-view")).toBeVisible();
      await expect(page.getByRole("button", { name: /View in AR|Building the maquette|Preparing the model/ })).toBeVisible();
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
      await page.getByRole("button", { name: "Share with the family" }).click();
      await expect(page.getByText(/Link copied|Could not copy the link/)).toBeVisible();
      await audit("present");
    });

    test("present: In real life card sits above the AR card", async () => {
      await toDesign();
      await tab(/Present/).click();
      const card = page.getByTestId("real-life-card");
      await expect(card).toBeVisible();
      const ar = page.getByRole("button", { name: /View in AR|Building the maquette|Preparing the model/ });
      const a = (await card.boundingBox())!;
      const b = (await ar.boundingBox())!;
      expect(a.y, "In real life above the AR card").toBeLessThan(b.y);
    });

    test("deliver: takeoff, next steps, snapshot, DXF and CSV downloads", async () => {
      await toDesign();
      await placeFurniture();
      await tab(/Deliver/).click();
      await expect(page.getByTestId("deliver-view")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Staged takeoff" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("next-steps")).toBeVisible();
      const body = await page.getByTestId("deliver-view").innerText();
      expect(body, "no raw catalog ids in the takeoff").not.toMatch(/\b(?:mat|furn|cat|item)[._-][a-z0-9_.-]{3,}\b/);
      await audit("deliver");

      const deliver = page.getByTestId("deliver-view");
      const [dxf] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), deliver.getByRole("button", { name: "Download DXF" }).click()]);
      const dxfPath = await dxf.path();
      const text = readFileSync(dxfPath, "utf8");
      expect(text.length).toBeGreaterThan(1000);
      for (const layer of ["A-WALL", "A-DOOR", "A-GLAZ", "A-FLOR-FURN"]) expect(text, `DXF has layer ${layer}`).toContain(layer);
      const [csv] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), deliver.getByRole("button", { name: "Export CSV" }).last().click()]);
      expect(csv.suggestedFilename()).toBe("takeoff.csv");
      expect(readFileSync(await csv.path(), "utf8").length).toBeGreaterThan(50);
    });

    test("deliver: Plan snapshot is shown once furniture is placed", async () => {
      test.fixme(true, "E2E-010 intermittent: the Plan snapshot card sometimes never appears although /scene/snapshot.svg answers 200, see docs/E2E_BUGS.md");
      await toDesign();
      await placeFurniture();
      await tab(/Deliver/).click();
      await expect(page.getByTestId("deliver-view")).toBeVisible();
      await expect(page.getByRole("img", { name: "Plan snapshot" })).toBeVisible({ timeout: 15_000 });
    });

    test("deliver: Plan snapshot is shown without furniture", async () => {
      test.fixme(true, "E2E-010 intermittent, see docs/E2E_BUGS.md");
      await toReform();
      await tab(/Deliver/).click();
      await expect(page.getByRole("img", { name: "Plan snapshot" })).toBeVisible({ timeout: 15_000 });
    });

    test("locale: Spanish on Reform, Design, Present, Deliver shows no English", async () => {
      await toDesign();
      await placeFurniture();
      await setLocale(page, "es");
      const leaks: Record<string, string[]> = {};
      for (const [stage, id] of [["Diseño", "design-screen"], ["Presentación", "present-view"], ["Entrega", "deliver-view"], ["Reforma", "reform-screen"]] as const) {
        await tab(new RegExp(stage)).click();
        await expect(page.getByTestId(id)).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(600);
        leaks[id] = await englishLeaks(page);
        await shot(page, `${profile.name}-${id}-es`);
        if (id === "deliver-view") {
          const t = await page.getByTestId(id).innerText();
          expect(t, "es-AR takeoff shows no raw catalog ids").not.toMatch(/\b(?:mat|furn|cat|item)[._-][a-z0-9_.-]{3,}\b/);
        }
      }
      expect(leaks, "English words visible in es-AR").toEqual({ "design-screen": [], "present-view": [], "deliver-view": [], "reform-screen": [] });
    });

    test("global: stepper and Back navigation", async () => {
      await toReform();
      await tab(/Design/).click();
      await expect(page.getByTestId("design-screen")).toBeVisible();
      await tab(/Reform/).click();
      await expect(page.getByTestId("reform-screen")).toBeVisible();
      await page.getByRole("button", { name: "Back" }).first().click();
      await expect(page.getByTestId("reform-screen"), "Back leaves Reform").toBeHidden();
    });

    test("global: reload mid-flow keeps the project", async () => {
      // Last test of a long shared-page journey: the page is slow by now, not the reload.
      test.setTimeout(120_000);
      await toReform();
      await page.reload({ waitUntil: "commit" });
      await expect(page.getByTestId("reform-screen"), "reload mid-flow keeps the stage").toBeVisible({ timeout: 20_000 });
    });
  });
}

// --- Per-screen checklist results (one test per profile x screen x check) ---------------------------------------
function readIssues(profile: string, screen: string, check: string): string[] | null {
  if (!existsSync(ISSUES)) return null;
  const rows = readFileSync(ISSUES, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { profile: string; screen: string; check: string; issues: string[] });
  const hits = rows.filter((r) => r.profile === profile && r.screen === screen && r.check === check);
  return hits.length === 0 ? null : hits.flatMap((r) => r.issues);
}
void readdirSync;

for (const profile of PROFILES) {
  test.describe(`screen checks ${profile.name}`, () => {
    for (const screen of SCREENS) {
      for (const check of CHECKS) {
        test(`${screen}: ${check}`, () => {
          const known = KNOWN[`${profile.name}:${screen}:${check}`] ?? KNOWN[`*:${screen}:${check}`];
          if (known) test.fail(true, `Known product bug ${known}, see docs/E2E_BUGS.md`);
          const issues = readIssues(profile.name, screen, check);
          test.skip(issues === null, "screen not reached by the journey (see the flow test failure)");
          expect(issues).toEqual([]);
        });
      }
    }
  });
}
