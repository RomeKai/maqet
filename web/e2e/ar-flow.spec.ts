import { expect, test, type Page } from "@playwright/test";

/**
 * AR flows without a device. WebXR is replaced by an init-script fake, the model host by page.route:
 * no live calls, no phone. The fake session runs the real adapter code path (hit-test, select, viewer pose).
 */

type XrMode = "none" | "supported" | "denied" | "live";

async function mockWebXr(page: Page, mode: XrMode): Promise<void> {
  await page.addInitScript((m: XrMode) => {
    if (m === "none") {
      Object.defineProperty(navigator, "xr", { value: undefined, configurable: true });
      return;
    }
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    const state = {
      hit: { x: 0, y: -1.2, z: -2 } as { x: number; y: number; z: number } | null,
      // Camera at (1.5, 1.4, 0) looking -Z: the view matrix is the inverse translation.
      eye: { x: 1.5, y: 1.4, z: 0 },
      tracking: true,
    };
    const frame = {
      getHitTestResults: () =>
        state.hit === null
          ? []
          : [{ getPose: () => ({ transform: { position: { ...state.hit }, orientation: { x: 0, y: 0, z: 0, w: 1 } } }) }],
      getViewerPose: () =>
        state.tracking
          ? {
              views: [
                {
                  projectionMatrix: new Float32Array(16),
                  transform: {
                    inverse: {
                      matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -state.eye.x, -state.eye.y, -state.eye.z, 1]),
                    },
                  },
                },
              ],
            }
          : null,
    };
    const session = {
      renderState: { baseLayer: null as unknown },
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        (listeners[type] ??= []).push(fn);
      },
      requestReferenceSpace: async () => ({}),
      requestHitTestSource: async () => ({}),
      updateRenderState(s: { baseLayer: unknown }) {
        this.renderState.baseLayer = s.baseLayer;
      },
      requestAnimationFrame: (cb: (t: number, f: unknown) => void) => window.setTimeout(() => cb(performance.now(), frame), 40),
      cancelAnimationFrame: (h: number) => window.clearTimeout(h),
      end: async () => {
        (listeners.end ?? []).forEach((fn) => fn({}));
      },
    };
    (window as unknown as { XRWebGLLayer: unknown }).XRWebGLLayer = class {
      framebuffer = null;
    };
    (window as unknown as { __xr: unknown }).__xr = {
      /** A tap with a hit-test pose at `pos` (or none). */
      tap(pos: { x: number; y: number; z: number } | null) {
        state.hit = pos;
        (listeners.select ?? []).forEach((fn) => fn({ frame }));
      },
      setHit(pos: { x: number; y: number; z: number } | null) {
        state.hit = pos;
      },
      setEye(x: number, y: number, z: number) {
        state.eye = { x, y, z };
      },
      setTracking(on: boolean) {
        state.tracking = on;
      },
      sessions: 0,
    };
    Object.defineProperty(navigator, "xr", {
      configurable: true,
      value: {
        isSessionSupported: async () => true,
        requestSession: async () => {
          if (m === "denied") throw new DOMException("Permission denied", "NotAllowedError");
          (window as unknown as { __xr: { sessions: number } }).__xr.sessions += 1;
          return session;
        },
      },
    });
  }, mode);
}

async function openMethods(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByText("Start capture").click();
}

test.describe("Mode A: device support", () => {
  test("an unsupported device never offers AR measure and keeps the photo path", async ({ page }) => {
    await mockWebXr(page, "none");
    await openMethods(page);
    await expect(page.getByTestId("method-screen")).toBeVisible();
    await expect(page.locator('[data-method="ar"]')).toHaveCount(0);
    await expect(page.locator('[data-method="photo"]')).toBeEnabled();
  });

  test("a WebXR device shows the AR card and the start screen with 48 px targets", async ({ page }) => {
    await mockWebXr(page, "supported");
    await openMethods(page);
    await page.locator('[data-method="ar"]').click();
    const dialog = page.getByRole("dialog", { name: "Measure with AR" });
    await expect(dialog).toBeVisible();
    const start = dialog.getByRole("button", { name: "Measure (AR)" });
    await expect(start).toBeEnabled();
    for (const button of await dialog.getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(47.5);
    }
  });

  test("permission denied shows a plain message and the plan/sketch fallbacks", async ({ page }) => {
    await mockWebXr(page, "denied");
    await openMethods(page);
    await page.locator('[data-method="ar"]').click();
    await page.getByRole("button", { name: "Measure (AR)" }).click();
    await expect(page.getByRole("alert")).toContainText("permission was denied");
    await expect(page.getByRole("button", { name: "Plan" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sketch" })).toBeVisible();
    // Retry stays available.
    await expect(page.getByRole("button", { name: "Measure (AR)" })).toBeVisible();
  });
});

type Xr = { tap: (p: { x: number; y: number; z: number } | null) => void; setTracking: (on: boolean) => void; setEye: (x: number, y: number, z: number) => void; sessions: number };

test.describe("Mode A: live session (fake WebXR)", () => {
  test("captures a 4-wall room with ONE height and hands it to the editor", async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await mockWebXr(page, "live");
    await openMethods(page);
    await page.locator('[data-method="ar"]').click();
    await page.getByRole("button", { name: "Measure (AR)" }).click();

    const pill = page.locator(".ar-hud-pill");
    await expect(pill).toBeVisible();
    const tap = (x: number, z: number) =>
      page.evaluate(([px, pz]) => (window as unknown as { __xr: Xr }).__xr.tap({ x: px as number, y: -1.2, z: pz as number }), [x, z]);

    // The first floor tap becomes corner A; the second becomes B.
    await tap(0, -2);
    await expect(pill).toContainText("Tap the other end");
    await tap(3, -2);
    await expect(pill).toContainText("Tap where the wall meets the ceiling");
    // Height step: the manual input and the 2.60 m default are always there, and the ray previews 2.60 m.
    await expect(page.getByRole("textbox", { name: "Type height" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use 2.60 m" })).toBeVisible();
    await expect(pill).toContainText("2.60");
    // Tapping confirms the ray height: wall 1 done, the next step asks for a corner only.
    await tap(3, -2);
    await expect(pill).toContainText("Wall 2: tap the next corner");
    await expect(page.getByRole("textbox", { name: "Type height" })).toHaveCount(0);

    await tap(3, -5);
    await expect(pill).toContainText("Wall 3");
    await tap(0, -5);
    await expect(pill).toContainText("Wall 4");
    // Closing tap near corner A completes wall 4 and closes the room, with no second height prompt.
    await tap(0.05, -2.05);
    await expect(pill).toContainText("Room captured");

    // Per-wall override stays available after the height step is gone.
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("dialog", { name: "Review measurements" })).toBeVisible();
    await page.getByRole("button", { name: "Looks right" }).click();
    await expect(page.getByText("Room captured with AR")).toBeVisible();
    await expect(page.getByText("4 walls measured")).toBeVisible();
    await page.getByRole("button", { name: "Looks right" }).click();
    await expect(page.getByLabel("Message to the assistant")).toBeVisible();
  });

  test("an out-of-range typed height is refused and the next wall still works", async ({ page }) => {
    await mockWebXr(page, "live");
    await openMethods(page);
    await page.locator('[data-method="ar"]').click();
    await page.getByRole("button", { name: "Measure (AR)" }).click();
    const pill = page.locator(".ar-hud-pill");
    const tap = (x: number, z: number) =>
      page.evaluate(([px, pz]) => (window as unknown as { __xr: Xr }).__xr.tap({ x: px as number, y: -1.2, z: pz as number }), [x, z]);
    await tap(0, -2);
    await tap(3, -2);
    await page.getByRole("textbox", { name: "Type height" }).fill("1.1");
    await page.getByRole("button", { name: "Confirm height" }).click();
    await expect(pill).toContainText("between 2.0 and 4.0 m");
    await page.getByRole("textbox", { name: "Type height" }).fill("2,4");
    await page.getByRole("button", { name: "Confirm height" }).click();
    await expect(pill).toContainText("Wall 2: tap the next corner");
    await tap(3, -5);
    await expect(pill).toContainText("Wall 3");
    // Wall 1 can be overridden by typing, without a camera ray.
    await page.getByText(/Wall 2 height/).click();
    await page.getByLabel(/Height of wall 2/).fill("2.4");
    await page.getByRole("button", { name: "Set wall height" }).click();
    await expect(page.getByText(/Wall 2 height: 2\.40/)).toBeVisible();
  });

  test("Set height here confirms the ray height, then the next corner lands on the floor", async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await mockWebXr(page, "live");
    await openMethods(page);
    await page.locator('[data-method="ar"]').click();
    await page.getByRole("button", { name: "Measure (AR)" }).click();
    const pill = page.locator(".ar-hud-pill");
    const tap = (x: number, y: number, z: number) =>
      page.evaluate(([px, py, pz]) => (window as unknown as { __xr: Xr }).__xr.tap({ x: px as number, y: py as number, z: pz as number }), [x, y, z]);
    await tap(0, -1.2, -2);
    await tap(3, -1.2, -2);
    await expect(page.locator(".ar-hud-crosshair")).toBeVisible();
    // The DOM button works without any hit-test or world tap.
    await page.getByRole("button", { name: "Set height here" }).click();
    await expect(pill).toContainText("Wall 2: tap the next corner");
    // The hit-test now reports a point at wall height: the corner must still be accepted on the floor.
    // (Level fake camera has no floor ray, so a mid-air pose is refused with floor guidance.)
    await tap(3, 0.8, -5);
    await expect(pill).toContainText("Aim at the floor");
    await tap(3, -1.2, -5);
    await expect(pill).toContainText("Wall 3");
  });

  test("captures a window and a door on a wall with two taps each", async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await mockWebXr(page, "live");
    await openMethods(page);
    await page.locator('[data-method="ar"]').click();
    await page.getByRole("button", { name: "Measure (AR)" }).click();
    const pill = page.locator(".ar-hud-pill");
    const tap = (x: number, y: number, z: number) =>
      page.evaluate(([px, py, pz]) => (window as unknown as { __xr: Xr }).__xr.tap({ x: px as number, y: py as number, z: pz as number }), [x, y, z]);
    // The fake camera moves on the next animation frame (40 ms): wait so the tap reads the new ray.
    const aimAt = async (x: number) => {
      await page.evaluate((px) => (window as unknown as { __xr: Xr }).__xr.setEye(px, 1.4, 0), x);
      await page.waitForTimeout(200);
    };
    await tap(0, -1.2, -2);
    await tap(3, -1.2, -2);
    await page.getByRole("button", { name: "Use 2.60 m" }).click();
    await expect(pill).toContainText("Wall 2");

    await page.getByRole("button", { name: "Window" }).click();
    await expect(pill).toContainText("window");
    await aimAt(0.5);
    await tap(0.5, -1.2, -1);
    await aimAt(1.7);
    await tap(1.7, -1.2, -1);

    await page.getByRole("button", { name: "Door" }).click();
    await aimAt(2.0);
    await tap(2.0, -1.2, -1);
    await aimAt(2.9);
    await tap(2.9, -1.2, -1);

    await page.getByRole("button", { name: "Done" }).click();
    const sheet = page.getByRole("dialog", { name: "Review measurements" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("opening-1 window");
    await expect(sheet).toContainText("opening-2 door");
    const values = await sheet.locator("input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    const nums = values.map(Number);
    const has = (n: number) => nums.some((v) => Math.abs(v - n) < 0.01);
    expect(has(0.9)).toBe(true); // window sill
    expect(has(1.2)).toBe(true); // window height
    expect(has(2.0)).toBe(true); // door height
  });

  test("tracking lost shows guidance and clears when tracking returns", async ({ page }) => {
    await mockWebXr(page, "live");
    await openMethods(page);
    await page.locator('[data-method="ar"]').click();
    await page.getByRole("button", { name: "Measure (AR)" }).click();
    const pill = page.locator(".ar-hud-pill");
    await expect(pill).toBeVisible();
    await page.evaluate(() => (window as unknown as { __xr: Xr }).__xr.setTracking(false));
    await expect(pill).toContainText("Tracking lost");
    await page.evaluate(() => (window as unknown as { __xr: Xr }).__xr.setTracking(true));
    await expect(pill).not.toContainText("Tracking lost");
  });
});

async function openPresent(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByText("Start capture").click();
  await page.getByText("Photograph a sketch").click();
  await page.getByText("Try a sample").click();
  await page.locator("button", { hasText: "Present" }).click();
}

test.describe("Present AR card", () => {
  test("waits for the hosted model, then enables the AR button and keeps it visible", async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 640 });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let uploads = 0;
    await page.route("**/api/ar/model", async (route) => {
      uploads += 1;
      await gate;
      await route.fulfill({ json: { id: "a".repeat(32), kind: uploads === 1 ? "glb" : "usdz", path: `/ar/model/${"a".repeat(32)}.glb` } });
    });
    await openPresent(page);
    const ar = page.getByRole("button", { name: /Preparing the model|View in AR on the table|Building the maquette/ });
    await expect(ar).toBeDisabled();
    release();
    const ready = page.getByRole("button", { name: "View in AR on the table" });
    await expect(ready).toBeEnabled({ timeout: 30_000 });
    // The compact banner and the sticky bar never cover the AR button.
    const box = await ready.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(640);
    const covered = await ready.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return top === null || !el.contains(top);
    });
    expect(covered).toBe(false);
    expect(uploads).toBeGreaterThanOrEqual(1);
  });

  test("a failed upload explains that only WebXR is offered and still allows the button", async ({ page }) => {
    await page.route("**/api/ar/model", (route) => route.fulfill({ status: 500, body: "boom" }));
    await openPresent(page);
    await expect(page.getByText("only WebXR is offered")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "View in AR on the table" })).toBeEnabled();
    await expect(page.locator("model-viewer")).toHaveAttribute("ar-modes", "webxr");
  });

  test("a hosted model offers every AR mode and a not-presenting launch shows the WebXR retry", async ({ page }) => {
    await page.route("**/api/ar/model", (route) =>
      route.fulfill({ json: { id: "b".repeat(32), kind: "glb", path: `/ar/model/${"b".repeat(32)}.glb` } }),
    );
    const logs: string[] = [];
    page.on("console", (m) => logs.push(m.text()));
    await openPresent(page);
    const viewer = page.locator("model-viewer");
    await expect(viewer).toHaveAttribute("ar-modes", "webxr scene-viewer quick-look", { timeout: 30_000 });
    await expect(viewer).toHaveAttribute("src", /^https:\/\/localhost:\d+\/api\/ar\/model\/b{32}\.glb$/);
    // Scene Viewer closed without ever presenting.
    await viewer.evaluate((el) => el.dispatchEvent(new CustomEvent("ar-status", { detail: { status: "not-presenting" } })));
    await expect(page.getByRole("alert").filter({ hasText: "AR could not show the maquette" })).toBeVisible();
    await expect(page.getByText(/certificate is not trusted/)).toBeVisible();
    await page.getByRole("button", { name: "Try again with WebXR" }).click();
    await expect(viewer).toHaveAttribute("ar-modes", "webxr");
    expect(logs.some((l) => l.includes("[ar-status]"))).toBe(true);
  });
});
