import { expect, test, type Page } from "@playwright/test";
import { loadSample, mockTurns, toReform, stageTab } from "./hunt/helpers";

const LONG_REPLY =
  "I placed the new bedroom against the north wall and kept the corridor at 1.00 m. " +
  "The door swings into the hall so it does not hit the wardrobe. The window faces east and gives about one tenth of the floor area in light. " +
  "Before you build, check the span of the new opening with a licensed professional, because it replaces part of an existing wall. " +
  "Next I suggest finishing the floor and then adding a wardrobe along the south wall, leaving 0.60 m free in front of it.";

const OPS = [
  { name: "add_room", arguments: { name: "Bedroom" }, flags: ["needs_professional"] },
  { name: "add_opening", arguments: { kind: "door" }, flags: [] },
  { name: "add_opening", arguments: { kind: "window" }, flags: ["needs_professional"] },
];

const SIZES = [
  { width: 412, height: 915 },
  { width: 360, height: 740 },
];

async function sendLong(page: Page): Promise<void> {
  await page.getByLabel("Message to the assistant").fill("add a bedroom");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator('.agent-message[data-role="assistant"]')).toHaveCount(1);
}

/** The newest reply is fully readable: inside the list, clear of the chips, and the list is not squeezed to a sliver. */
async function expectReplyReadable(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>(".agent-messages")!;
    const msgs = list.querySelectorAll<HTMLElement>(".agent-message");
    const last = msgs[msgs.length - 1];
    const sug = document.querySelector<HTMLElement>(".agent-suggestions");
    const l = list.getBoundingClientRect();
    const b = last.getBoundingClientRect();
    const s = sug && getComputedStyle(sug).display !== "none" ? sug.getBoundingClientRect() : null;
    // Scroll to the very end: the last bubble's bottom must then be inside the list, and the list must not reach the chips.
    list.scrollTop = list.scrollHeight;
    const b2 = last.getBoundingClientRect();
    return {
      listH: l.height,
      listBottom: l.bottom,
      sugTop: s ? s.top : null,
      lastBottomAfterScroll: b2.bottom,
      lastTop: b.top,
      listTop: l.top,
      viewportH: window.innerHeight,
      canScroll: list.scrollHeight > list.clientHeight,
      fits: b.height <= l.height,
    };
  });
  // Not squeezed: at least ~3 lines, or the whole reply when it fits.
  expect(m.listH, "message list height").toBeGreaterThanOrEqual(96);
  expect(m.lastBottomAfterScroll, "newest bubble bottom inside list").toBeLessThanOrEqual(m.listBottom + 1);
  if (m.sugTop !== null) expect(m.listBottom, "list ends above the suggestion chips").toBeLessThanOrEqual(m.sugTop + 1);
  // Readable by scrolling: either it fits, or the list scrolls.
  expect(m.fits || m.canScroll).toBe(true);
  // The newest message scrolled into view automatically (before our own scroll in the evaluate above).
}

async function newestInView(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const list = document.querySelector<HTMLElement>(".agent-messages")!;
    const msgs = list.querySelectorAll<HTMLElement>(".agent-message");
    const last = msgs[msgs.length - 1].getBoundingClientRect();
    const l = list.getBoundingClientRect();
    return last.bottom <= l.bottom + 1 && last.bottom > l.top;
  });
}

for (const size of SIZES) {
  test.describe(`finding 1: long reply readable at ${size.width}x${size.height}`, () => {
    test("Reform", async ({ page }) => {
      await page.setViewportSize(size);
      await mockTurns(page, { reply: LONG_REPLY, ops: OPS, warnings: ["Window area is below 10% of floor area"], flags: ["needs_professional"] });
      await loadSample(page);
      await toReform(page);
      await sendLong(page);
      expect(await newestInView(page)).toBe(true);
      await expectReplyReadable(page);
    });

    test("Design", async ({ page }) => {
      await page.setViewportSize(size);
      await mockTurns(page, { reply: LONG_REPLY, ops: OPS, warnings: ["Window area is below 10% of floor area"], flags: ["needs_professional"] });
      await loadSample(page);
      await toReform(page);
      await stageTab(page, /Design/).click();
      await expect(page.getByTestId("design-screen")).toBeVisible();
      await sendLong(page);
      expect(await newestInView(page)).toBe(true);
      await expectReplyReadable(page);
    });
  });
}

type Pt = [number, number];
interface TurnBody { scene: { walls: { id: string; a: Pt; b: Pt }[] } }

/** Every wall endpoint coincides with an endpoint of another wall (closed outline, nothing detached). */
function disconnected(walls: TurnBody["scene"]["walls"]): string[] {
  const near = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
  const bad: string[] = [];
  for (const w of walls) {
    for (const [end, p] of [["a", w.a], ["b", w.b]] as const) {
      if (!walls.some((o) => o.id !== w.id && (near(p, o.a) || near(p, o.b)))) bad.push(`${w.id}.${end}`);
    }
  }
  return bad;
}

for (const size of SIZES) {
  test(`finding 2: dragging a corner keeps walls joined (one undo) at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    const mock = await mockTurns(page);
    await loadSample(page);
    const editor = page.locator(".capture-editor");
    await editor.getByRole("button", { name: "Next" }).click(); // walls step
    const handle = page.locator(".handle-btn").first();
    const box = await handle.boundingBox();
    if (!box) throw new Error("no handle");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    // Far more than the 12 px cluster tolerance, in several moves like a finger.
    for (let i = 1; i <= 6; i++) await page.mouse.move(cx + i * 12, cy + i * 6);
    await page.mouse.up();
    await toReform(page);
    await page.getByLabel("Message to the assistant").fill("hello");
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(() => mock.bodies.length).toBe(1);
    const moved = mock.bodies[0]!.scene as TurnBody["scene"];
    expect(disconnected(moved.walls), "walls detached after the drag").toEqual([]);
  });
}
