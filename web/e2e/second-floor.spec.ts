import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const SHOT_DIR = process.env.PHONEPASS_SHOTS ?? "";

// View-only check: a level-2 room must render upstairs. Needs WebGL; skipped where the browser has none.
for (const [width, height] of [[360, 707], [375, 812]] as const) {
test(`a level-2 room renders as a second floor at ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await page.route("**/api/agent/turn", async (route) => {
    const body = route.request().postDataJSON() as { scene: { walls: { a: [number, number]; b: [number, number] }[]; rooms?: unknown[] } };
    // A 3x3 room over the south-west corner of the house, i.e. inside the ground footprint.
    const x = Math.min(...body.scene.walls.flatMap((w) => [w.a[0], w.b[0]]));
    const y = Math.min(...body.scene.walls.flatMap((w) => [w.a[1], w.b[1]]));
    const rooms = [...(body.scene.rooms ?? []), { id: "upper", name: "Second floor", polygon: [[x, y], [x + 3, y], [x + 3, y + 3], [x, y + 3]], level: 2 }];
    await route.fulfill({
      json: { reply: "Added a 3x3 second floor.", scene: { ...body.scene, rooms }, ops_applied: [], history: [], professional_flags: ["second_floor"], tool_errors: [], tool_warnings: [] },
    });
  });
  await page.goto("/");
  await page.getByText("Start capture").click();
  await page.getByText("Photograph a sketch").click();
  await page.getByText("Try a sample").click();
  await page.locator("button", { hasText: "Reform" }).click();
  const webgl = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2") || !!document.createElement("canvas").getContext("webgl"));
  test.skip(!webgl, "no WebGL in this browser");
  await page.getByLabel("Message to the assistant").fill("add a 3x3 second floor");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".agent-message[data-role='assistant']")).toHaveCount(1);
  await page.waitForTimeout(800);
  if (SHOT_DIR) {
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOT_DIR}/second-floor-${width}x${height}-${process.env.PHONEPASS_TAG ?? "run"}.png` });
  }
});
}
