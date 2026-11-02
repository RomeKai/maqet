import { expect, test, type Page } from "@playwright/test";
import { PIXEL7, SMALL, attachMonitor, auditLayout, loadSample, mockTurns, setLocale, shot, toReform } from "./helpers";

/** Edge cases on a phone viewport. Agent turns are mocked; nothing calls Meta. */
const BASE = `https://localhost:${process.env.E2E_WEB_PORT ?? "5320"}`;

async function fresh(browser: import("@playwright/test").Browser, profile = PIXEL7): Promise<Page> {
  const ctx = await browser.newContext({ ...profile, baseURL: BASE, ignoreHTTPSErrors: true, locale: "en-US", acceptDownloads: true });
  return ctx.newPage();
}
const send = async (page: Page, text: string): Promise<void> => {
  await page.getByLabel("Message to the assistant").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
};

test.describe("edge cases", () => {
  test("empty database: Home loads with no console errors or failed requests (E2E-001 regression)", async ({ browser }) => {
    const page = await fresh(browser);
    const monitor = attachMonitor(page, [/@fontsource/]);
    await page.goto("/");
    await expect(page.getByTestId("home-screen")).toBeVisible();
    await page.waitForTimeout(800);
    expect(monitor.drain()).toEqual([]);
    await shot(page, "edge-empty-db-home");
    await page.context().close();
  });

  test("replay 409 on a turn shows a friendly one-line error and keeps the user bubble", async ({ browser }) => {
    test.fail(true, "E2E-005 a 409/500 turn shows 'Agent request failed (N): ...', see docs/E2E_BUGS.md");
    const page = await fresh(browser);
    await page.route("**/api/agent/turn", (r) => r.fulfill({ status: 409, json: { detail: "no recorded response for this request" } }));
    await loadSample(page);
    await toReform(page);
    await send(page, "add a bedroom");
    await expect(page.locator(".agent-message[data-role=user]")).toContainText("add a bedroom");
    const err = page.locator(".agent-error").first();
    await expect(err).toBeVisible();
    const text = (await err.innerText()).trim();
    expect(text, "no raw JSON or status codes in the error").not.toMatch(/[{}]|\b409\b|detail/);
    await shot(page, "edge-turn-409");
    await page.context().close();
  });

  test("server 500 on a turn shows a friendly error, not a raw status line", async ({ browser }) => {
    test.fail(true, "E2E-005 a 500 turn shows 'Agent request failed (500): ...', see docs/E2E_BUGS.md");
    const page = await fresh(browser);
    await loadSample(page);
    await toReform(page);
    await mockTurns(page, { status: 500 });
    await send(page, "add a bedroom");
    const err = page.locator(".agent-error").first();
    await expect(err).toBeVisible();
    expect(await err.innerText(), "friendly error without 'failed (500)'").not.toMatch(/\(500\)|\b500\b/);
    await shot(page, "edge-turn-500");
    await page.context().close();
  });

  test("a slow turn (30 s) shows a pending state and stays cancellable", async ({ browser }) => {
    test.fail(true, "E2E-011 a pending agent turn cannot be cancelled, see docs/E2E_BUGS.md");
    const page = await fresh(browser);
    await loadSample(page);
    await toReform(page);
    await mockTurns(page, { delayMs: 30_000 });
    await send(page, "add a bedroom");
    await expect(page.getByText("Working on it…").first()).toBeVisible({ timeout: 5000 });
    await shot(page, "edge-turn-slow-pending");
    await expect(page.getByRole("button", { name: /Cancel|Stop/ }), "a Cancel/Stop control while pending").toBeVisible({ timeout: 2000 });
    await page.context().close();
  });

  test("double-tapping Send submits the turn once", async ({ browser }) => {
    const page = await fresh(browser);
    await loadSample(page);
    await toReform(page);
    const mock = await mockTurns(page, { delayMs: 600 });
    await page.getByLabel("Message to the assistant").fill("add a bedroom");
    await page.getByRole("button", { name: "Send" }).dblclick();
    await page.waitForTimeout(1500);
    expect(mock.bodies, "one request for a double tap").toHaveLength(1);
    await expect(page.locator(".agent-message[data-role=user]")).toHaveCount(1);
    await page.context().close();
  });

  test("a very long message wraps without overflow and keeps the input visible", async ({ browser }) => {
    const page = await fresh(browser, SMALL);
    await loadSample(page);
    await toReform(page);
    await mockTurns(page, {});
    await send(page, ("add a very long bedroom request " + "x".repeat(40) + " ").repeat(60));
    await expect(page.locator(".agent-message[data-role=user]")).toBeVisible();
    const a = await auditLayout(page);
    expect(a.overflow).toEqual([]);
    const input = (await page.getByLabel("Message to the assistant").boundingBox())!;
    expect(input.y + input.height).toBeLessThanOrEqual(740 + 1);
    await shot(page, "edge-long-message-360");
    await page.context().close();
  });

  test("rotating the viewport mid-flow keeps the chat usable in both orientations", async ({ browser }) => {
    test.fail(true, "E2E-012 in landscape the chat input is pushed below the 412 px viewport, see docs/E2E_BUGS.md");
    const page = await fresh(browser);
    await loadSample(page);
    await toReform(page);
    await mockTurns(page, {});
    await send(page, "hello");
    await expect(page.locator(".agent-message")).toHaveCount(2);
    await page.setViewportSize({ width: 915, height: 412 });
    await page.waitForTimeout(400);
    await shot(page, "edge-rotate-landscape");
    const land = await auditLayout(page);
    expect(land.overflow, "no horizontal overflow in landscape").toEqual([]);
    await expect(page.getByLabel("Message to the assistant"), "input reachable in landscape").toBeVisible();
    const box = (await page.getByLabel("Message to the assistant").boundingBox())!;
    expect(box.y + box.height, "input inside the 412 px landscape viewport").toBeLessThanOrEqual(412 + 1);
    await page.setViewportSize({ width: 412, height: 915 });
    await page.waitForTimeout(300);
    await expect(page.locator(".agent-message")).toHaveCount(2);
    await page.context().close();
  });

  test("offline: sending a turn shows a friendly error and the app keeps working", async ({ browser }) => {
    test.fail(true, "E2E-013 offline turn shows the raw 'Failed to fetch', see docs/E2E_BUGS.md");
    const page = await fresh(browser);
    await loadSample(page);
    await toReform(page);
    await page.context().setOffline(true);
    await send(page, "add a bedroom");
    const err = page.locator(".agent-error").first();
    await expect(err).toBeVisible({ timeout: 15_000 });
    expect(await err.innerText(), "no raw 'Failed to fetch'").not.toMatch(/Failed to fetch|NetworkError|TypeError/);
    await shot(page, "edge-offline-turn");
    await page.context().setOffline(false);
    await expect(page.getByLabel("Message to the assistant")).toBeEnabled();
    await page.context().close();
  });

  test("method screen: draw and type cards are labelled Soon and disabled (mode B)", async ({ browser }) => {
    const page = await fresh(browser);
    await page.goto("/");
    await page.getByRole("button", { name: "Start capture" }).click();
    for (const name of [/Draw on the screen/, /Type the measurements/]) {
      const card = page.getByRole("button", { name });
      await expect(card).toBeDisabled();
      await expect(card).toContainText("Soon");
    }
    await page.context().close();
  });

  test("method screen: AR card appears only with WebXR", async ({ browser }) => {
    const withXr = await fresh(browser);
    await withXr.addInitScript(() => {
      Object.defineProperty(navigator, "xr", { configurable: true, value: { isSessionSupported: async () => true, requestSession: async () => Promise.reject(new DOMException("denied", "NotAllowedError")) } });
    });
    await withXr.goto("/");
    await withXr.getByRole("button", { name: "Start capture" }).click();
    await expect(withXr.locator("[data-method=ar]")).toBeVisible();
    await shot(withXr, "edge-method-with-ar");
    await withXr.context().close();
    const without = await fresh(browser);
    await without.addInitScript(() => Object.defineProperty(navigator, "xr", { value: undefined, configurable: true }));
    await without.goto("/");
    await without.getByRole("button", { name: "Start capture" }).click();
    await expect(without.locator("[data-method=ar]")).toHaveCount(0);
    await without.context().close();
  });

  test("es-AR Deliver: flags are labelled in Spanish and each flag appears once", async ({ browser }) => {
    const page = await fresh(browser);
    await loadSample(page);
    await toReform(page);
    await page.getByRole("tab", { name: /Entrega|Deliver/ }).click();
    await setLocale(page, "es");
    await expect(page.getByRole("heading", { name: "Cómputo por etapas" })).toBeVisible({ timeout: 30_000 });
    const items = await page.locator('[data-testid="deliver-view"] li').allInnerTexts();
    const flagLines = items.filter((t) => /profesional/i.test(t));
    expect(new Set(flagLines).size, "flag lines are deduped").toBe(flagLines.length);
    expect(flagLines.join(" "), "flags are in Spanish").not.toMatch(/licensed professional/i);
    await shot(page, "edge-deliver-es-flags");
    await page.context().close();
  });
});
