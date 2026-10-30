import { expect, test, type Page } from "@playwright/test";

const QUESTION = "Where should the 3x4 bedroom go: wall 1 (north, 3.0 m) or wall 6 (south, 3.0 m)?";

async function openReform(page: Page): Promise<void> {
  await page.route("**/api/agent/turn", async (route) => {
    const body = route.request().postDataJSON() as { scene: unknown };
    await route.fulfill({
      json: { reply: QUESTION, scene: body.scene, ops_applied: [], history: [], professional_flags: [], tool_errors: [], tool_warnings: [] },
    });
  });
  await page.goto("/");
  await page.getByText("Start capture").click();
  await page.getByText("Photograph a sketch").click();
  await page.getByText("Try a sample").click();
  await page.locator("button", { hasText: "Reform" }).click();
  await page.locator(".agent-keyboard").click();
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByLabel("Message to the assistant").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

for (const height of [915, 780, 640, 500]) {
  test(`reform chat keeps bubbles and input visible at 412x${height}`, async ({ page }) => {
    await page.setViewportSize({ width: 412, height });
    await openReform(page);
    await ask(page, "add another 3x4 room");
    // A clarifying question with no ops is rendered as an assistant bubble.
    const bubble = page.locator('.agent-message[data-role="assistant"]', { hasText: QUESTION });
    await expect(bubble).toBeVisible();

    const list = await page.locator(".agent-messages").boundingBox();
    expect(list?.height ?? 0).toBeGreaterThanOrEqual(100);
    const bubbleBox = await bubble.boundingBox();
    expect(bubbleBox?.height ?? 0).toBeGreaterThan(20);

    const input = await page.getByLabel("Message to the assistant").boundingBox();
    const footer = await page.locator(".sheet").boundingBox();
    expect(input).not.toBeNull();
    expect((input?.y ?? 0) + (input?.height ?? 0)).toBeLessThanOrEqual((footer?.y ?? 0) + 1);
    expect(footer ? footer.y + footer.height : 0).toBeLessThanOrEqual(height);

    // Several exchanges later the input is still on screen and the newest bubble is visible.
    for (let i = 0; i < 4; i++) await ask(page, `again ${i}`);
    await expect(page.locator(".agent-message")).toHaveCount(10);
    const input2 = await page.getByLabel("Message to the assistant").boundingBox();
    expect((input2?.y ?? 0) + (input2?.height ?? 0)).toBeLessThanOrEqual((footer?.y ?? 0) + 1);
  });
}
