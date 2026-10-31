import { expect, test, type Page } from "@playwright/test";

interface SceneBody {
  scene: { rooms: { id: string; polygon: number[][] }[] };
  message: string;
}

function area(polygon: number[][]): number {
  let sum = 0;
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    sum += p[0] * q[1] - q[0] * p[1];
  });
  return Math.abs(sum) / 2;
}

async function openReform(page: Page, bodies: SceneBody[]): Promise<void> {
  // The model is mocked: it "adds" a room r_new to whatever scene it receives.
  await page.route("**/api/agent/turn", async (route) => {
    const body = route.request().postDataJSON() as SceneBody;
    bodies.push(body);
    const scene = {
      ...body.scene,
      rooms: body.scene.rooms.some((r) => r.id === "r_new")
        ? body.scene.rooms
        : [...body.scene.rooms, { id: "r_new", name: "New", polygon: [[0, 9], [3, 9], [3, 13], [0, 13]], level: 1 }],
    };
    await route.fulfill({
      json: { reply: "Added.", scene, ops_applied: [{ name: "add_room", arguments: {}, flags: [] }], history: [], professional_flags: [], tool_errors: [], tool_warnings: [] },
    });
  });
  await page.goto("/");
  await page.getByText("Start capture").click();
  await page.getByText("Photograph a sketch").click();
  await page.getByText("Try a sample").click();
  await page.locator("button", { hasText: "Reform" }).click();
  await page.locator(".agent-keyboard").click();
}

async function ask(page: Page, text: string, count: number): Promise<void> {
  await page.getByLabel("Message to the assistant").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".agent-message")).toHaveCount(count);
}

async function resize(page: Page, width: string, depth: string): Promise<void> {
  await page.getByRole("button", { name: "Edit measures" }).click();
  await page.getByLabel("Width (m)").fill(width);
  await page.getByLabel("Depth (m)").fill(depth);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("button", { name: "Apply" })).toHaveCount(0);
}

const variantsGroup = (page: Page) => page.getByRole("radiogroup", { name: "Variants" });

test("the next turn carries the scene the previous turn returned", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const bodies: SceneBody[] = [];
  await openReform(page, bodies);
  await ask(page, "add a 3x4 bedroom", 2);
  await ask(page, "add a window to the new room", 4);
  expect(bodies[0].scene.rooms.map((r) => r.id)).not.toContain("r_new");
  expect(bodies[1].scene.rooms.map((r) => r.id)).toContain("r_new");
});

test("an Edit measures edit is in the next turn, also after switching variants and back", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const bodies: SceneBody[] = [];
  await openReform(page, bodies);
  const group = variantsGroup(page);
  await group.getByRole("radio", { name: "A", exact: true }).click();
  await resize(page, "4", "8");
  await page.getByRole("button", { name: "Fork variant" }).click();
  await group.getByRole("radio", { name: "B", exact: true }).click();
  await resize(page, "5", "8");
  await group.getByRole("radio", { name: "A", exact: true }).click();
  await ask(page, "make it brighter", 2);
  expect(area(bodies[0].scene.rooms[0].polygon)).toBeCloseTo(32, 0);
  await group.getByRole("radio", { name: "B", exact: true }).click();
  await ask(page, "and here too", 2);
  expect(area(bodies[1].scene.rooms[0].polygon)).toBeCloseTo(40, 0);
});
