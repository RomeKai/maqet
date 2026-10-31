import { expect, test, type Page } from "@playwright/test";

const SIZES = [
  { width: 412, height: 915 },
  { width: 360, height: 740 },
] as const;

async function openStage(page: Page, stage: "Reform" | "Design"): Promise<void> {
  // The turn answers with a professional flag so the banner is on screen too.
  await page.route("**/api/agent/turn", async (route) => {
    const body = route.request().postDataJSON() as { scene: unknown };
    await route.fulfill({
      json: { reply: "ok", scene: body.scene, ops_applied: [], history: [], professional_flags: ["second_floor"], tool_errors: [], tool_warnings: [] },
    });
  });
  await page.goto("/");
  await page.getByText("Start capture").click();
  await page.getByText("Photograph a sketch").click();
  await page.getByText("Try a sample").click();
  await page.locator("button", { hasText: "Reform" }).click();
  if (stage === "Design") await page.locator("button", { hasText: "Design" }).first().click();
}

for (const { width, height } of SIZES) {
  for (const stage of ["Reform", "Design"] as const) {
    test(`${stage} layout at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openStage(page, stage);
      const screen = page.getByTestId(stage === "Reform" ? "reform-screen" : "design-screen");
      await expect(screen).toBeVisible();

      // Raise the banner with one turn, then check the empty dock first.
      const card = page.locator(".agent-card");
      const cardBox = await card.boundingBox();
      expect(cardBox?.height ?? 0).toBeGreaterThanOrEqual(height * 0.38 - 1);
      await expect(page.locator(".agent-messages")).toHaveCount(0); // no empty placeholder area

      await page.getByLabel("Message to the assistant").fill("hello");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".agent-message").first()).toBeVisible();
      const banner = page.getByTestId("pro-banner");
      await expect(banner).toBeVisible();
      const bannerBox = await banner.boundingBox();
      expect(bannerBox?.height ?? 999).toBeLessThanOrEqual(56);

      // Hero stays >= 38% even with messages; controls never overlap.
      const card2 = await card.boundingBox();
      expect(card2?.height ?? 0).toBeGreaterThanOrEqual(height * 0.38 - 1);
      const undo = await card.locator("button").filter({ has: page.locator("svg") }).first().boundingBox();
      const buttons = await card.locator("button").all();
      const boxes = [];
      for (const b of buttons) {
        const bb = await b.boundingBox();
        if (bb) boxes.push(bb);
      }
      expect(boxes.length).toBeGreaterThanOrEqual(2);
      expect(undo).not.toBeNull();
      for (let i = 0; i < boxes.length; i++) {
        expect(boxes[i].height).toBeGreaterThanOrEqual(47);
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
          expect(overlap, `controls ${i} and ${j} overlap`).toBe(false);
        }
      }

      // Input visible above the footer, inside the viewport.
      const input = await page.getByLabel("Message to the assistant").boundingBox();
      const footer = await page.locator(".sheet").boundingBox();
      expect(input).not.toBeNull();
      expect((input?.y ?? 0) + (input?.height ?? 0)).toBeLessThanOrEqual((footer?.y ?? height) + 1);
      expect(footer ? footer.y + footer.height : 0).toBeLessThanOrEqual(height + 1);

      await page.screenshot({ path: `e2e/screenshots/${stage.toLowerCase()}-${width}x${height}.png` });
    });
  }
}
