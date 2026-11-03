import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// Real phone viewports (Chrome bars included): the composer and Next stay on screen after a long agent reply.
const SIZES = [
  { width: 360, height: 650 },
  { width: 375, height: 812 },
] as const;

const SHOT_DIR = process.env.PHONEPASS_SHOTS ?? "";
const LONG_REPLY =
  "I added a 3 x 3 m second floor above the living room and kept the stair opening on the north side. " +
  "Because this is a second floor it needs a licensed professional to confirm the structure, the slab and the foundations. " +
  "I also moved the east window 40 cm so it clears the new wall, and the total area is now larger than before. " +
  "Tell me if you want the stairs on the other side, a bigger room, or a different wall thickness for the new level.";

async function openReform(page: Page): Promise<void> {
  await page.route("**/api/agent/turn", async (route) => {
    const body = route.request().postDataJSON() as { scene: unknown };
    await route.fulfill({
      json: {
        reply: LONG_REPLY,
        scene: body.scene,
        ops_applied: [
          { name: "add_room", arguments: {}, flags: ["second_floor"] },
          { name: "move_opening", arguments: {}, flags: [] },
          { name: "set_wall_thickness", arguments: {}, flags: [] },
        ],
        history: [],
        professional_flags: ["second_floor"],
        tool_errors: [],
        tool_warnings: ["Window is close to the new wall"],
      },
    });
  });
  await page.goto("/");
  await page.getByText("Start capture").click();
  await page.getByText("Photograph a sketch").click();
  await page.getByText("Try a sample").click();
  await page.locator("button", { hasText: "Reform" }).click();
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOT_DIR) {
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
  }
}

for (const { width, height } of SIZES) {
  test(`reform keeps composer and Next on screen after long replies at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openReform(page);
    const input = page.getByLabel("Message to the assistant");
    const send = page.getByRole("button", { name: "Send" });
    for (let i = 0; i < 3; i++) {
      await input.fill(`turn ${i} add a second floor`);
      await send.click();
      await expect(page.locator(".agent-message[data-role='assistant']")).toHaveCount(i + 1);
    }
    await shot(page, `reform-${width}x${height}-${process.env.PHONEPASS_TAG ?? "run"}`);

    const footer = await page.locator(".sheet").boundingBox();
    const footTop = footer?.y ?? height;
    for (const target of [input, send, page.locator(".agent-composer .agent-ptt-button"), page.getByRole("button", { name: /Next/ })]) {
      await expect(target).toBeVisible();
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(footTop + 1);
      expect(box!.height).toBeGreaterThanOrEqual(40);
    }
    // The page itself does not scroll; messages scroll inside their own list and end on the newest.
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
    const list = page.locator(".agent-messages");
    const lastOk = await list.evaluate((el) => {
      const last = el.lastElementChild as HTMLElement;
      return last.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 1;
    });
    expect(lastOk).toBe(true);
    const card = await page.locator(".agent-card").boundingBox();
    expect(card?.height ?? 0).toBeGreaterThanOrEqual(120);
    expect((footer?.y ?? 0) + (footer?.height ?? 0)).toBeLessThanOrEqual(height + 1);

    // A second turn on the same variant works without forking.
    await input.fill("one more thing");
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.locator(".agent-message[data-role='assistant']")).toHaveCount(4);
    await expect(input).toBeEnabled();
  });
}
