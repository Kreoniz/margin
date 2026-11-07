import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./synthetic-fixture";

// Hold the real closing state while native key events cross the protocol.
// Locator/assertion latency must not age a nominal 15ms sample past a 180ms exit.
async function holdExit(page: Page) {
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
}
async function finishExit(page: Page) {
  await page.clock.runFor(260);
  await page.clock.resume();
}

test("terminal exit boundary rejects natural browser-token activation after Escape and preserves pending recovery", async ({ page }) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  let writes = 0, configured = false, fail = true, release = () => {};
  let gate = Promise.resolve();
  const hold = () => { gate = new Promise<void>(resolve => { release = resolve; }); };
  await page.route("**/api/integration/browser-token", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { configured } });
    writes++; await gate;
    if (fail) return route.fulfill({ status: 503, json: { error: "Synthetic token update unavailable" } });
    configured = true;
    return route.fulfill({ json: { token: "SYNTHETIC-POST-REVIEW-VALUE-ONLY" } });
  });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.clock.install();
  const origin = page.getByRole("button", { name: "Settings", exact: true });
  const settings = page.locator(".settings-modal");
  const create = () => settings.getByRole("button", { name: "Create browser token", exact: true });
  const tabToCreate = async () => {
    const summary = settings.locator("summary").filter({ hasText: "Helium / browser capture" });
    await summary.click(); await expect(summary).toBeFocused();
    await page.keyboard.press("Tab"); await expect(create()).toBeFocused();
    await page.waitForTimeout(220);
  };
  await origin.click(); await tabToCreate();
  await holdExit(page);
  await page.keyboard.press("Escape");
  await expect(settings).toHaveAttribute("inert", "");
  await expect(settings).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(settings).toHaveCount(1); expect(writes).toBe(0);
  await finishExit(page);
  await expect(settings).toHaveCount(0); await expect(origin).toBeFocused();
  expect(writes).toBe(0);
  // Enter after return focus is a separate, deliberate normal activation.
  await page.keyboard.press("Enter"); await tabToCreate();
  hold(); await page.keyboard.press("Enter");
  await expect.poll(() => writes).toBe(1);
  await expect(settings.getByRole("button", { name: "Close dialog", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  expect(await settings.evaluate(element => (element as HTMLElement).inert)).toBe(false);
  release();
  await expect(settings.getByRole("alert")).toContainText("Synthetic token update unavailable");
  await expect(create()).toBeEnabled();
  expect(await settings.evaluate(element => (element as HTMLElement).inert)).toBe(false);
  fail = false; hold(); await create().focus(); await page.keyboard.press("Enter");
  await expect.poll(() => writes).toBe(2); release();
  await expect(settings.locator("#browser-token")).toHaveValue("SYNTHETIC-POST-REVIEW-VALUE-ONLY");
  await settings.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(settings).toHaveCount(0); await expect(origin).toBeFocused();
  expect(writes).toBe(2);
});

test("terminal exit boundary cancels native removal and programmatic Keep it while normal confirmed deletion still works", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  let deletes = 0, release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/media/video-1", async route => {
    if (route.request().method() === "DELETE") { deletes++; await gate; }
    return route.fallback();
  });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.clock.install();
  const origin = page.locator('[data-row-id="video-1"]');
  const remove = page.locator(".app-modal").filter({ hasText: "Remove from library?" });
  const open = async () => { await origin.locator(".priority-trigger").click(); await page.locator(".priority-panel").getByRole("button", { name: "Remove from library…", exact: true }).click(); await expect(remove.getByRole("button", { name: "Keep it", exact: true })).toBeFocused(); await page.waitForTimeout(220); };
  await open(); await page.keyboard.press("Tab");
  await expect(remove.getByRole("button", { name: "Remove item", exact: true })).toBeFocused();
  await holdExit(page);
  await page.keyboard.press("Escape");
  await expect(remove).toHaveAttribute("inert", "");
  await expect(remove).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(remove).toHaveCount(1); expect(deletes).toBe(0);
  await finishExit(page);
  await expect(remove).toHaveCount(0); await expect(origin).toBeFocused();
  expect(deletes).toBe(0); await expect(page.locator('.media-row[data-row-id="video-1"]')).toBeVisible();
  await open();
  await holdExit(page);
  await page.keyboard.press("Enter");
  await expect(remove).toHaveAttribute("inert", "");
  await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  await expect(remove).toHaveCount(1); expect(deletes).toBe(0);
  await finishExit(page);
  await expect(remove).toHaveCount(0); expect(deletes).toBe(0);
  await open(); await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  await expect.poll(() => deletes).toBe(1);
  await page.keyboard.press("Escape");
  expect(await remove.evaluate(element => (element as HTMLElement).inert)).toBe(false);
  release();
  await expect(remove).toHaveCount(0);
  await expect(page.locator('.media-row[data-row-id="video-1"]')).toHaveCount(0);
  await expect(page.locator('.media-row[data-row-id="video-2"]')).toBeFocused();
  expect(deletes).toBe(1); expect(controls.requests.mediaDeletes).toBe(1);
});

test("terminal exit boundary prevents native Sources form submission after Escape or header dismissal", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.clock.install();
  const origin = page.getByRole("button", { name: "Sources", exact: true });
  const sources = page.locator(".sources-modal");
  const url = () => sources.getByRole("textbox", { name: "Follow a website or RSS/Atom feed", exact: true });
  for (const dismissal of ["Escape", "Close"]) {
    await origin.click(); await url().fill("https://example.com/should-not-follow");
    await page.waitForTimeout(220);
    await holdExit(page);
    if (dismissal === "Escape") await page.keyboard.press("Escape");
    else await sources.getByRole("button", { name: "Close dialog", exact: true }).click();
    await expect(sources).toHaveAttribute("inert", "");
    await page.keyboard.press("Enter");
    await expect(sources).toHaveCount(1); expect(controls.requests.sourceCreates).toBe(0);
    await finishExit(page);
    await expect(sources).toHaveCount(0); await expect(origin).toBeFocused();
    expect(controls.requests.sourceCreates).toBe(0);
  }
  await origin.click(); await url().fill("https://example.com/deliberate-follow");
  await page.keyboard.press("Enter");
  await expect.poll(() => controls.requests.sourceCreates).toBe(1);
  await expect(sources.locator(".source-row")).toHaveCount(3);
  await sources.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(sources).toHaveCount(0); await expect(origin).toBeFocused();
});

test("terminal exit boundary preserves nested keyboard-help focus and leaves the containing Settings interactive", async ({ page }) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  const origin = page.getByRole("button", { name: "Settings", exact: true });
  await origin.click();
  const settings = page.locator(".settings-modal"), help = page.locator(".keyboard-help");
  const guide = settings.getByRole("button", { name: /Full keyboard guide/ });
  await guide.click();
  await expect(help.getByRole("heading", { name: "Keyboard shortcuts", exact: true })).toBeFocused();
  await page.waitForTimeout(220);
  await page.keyboard.press("Escape");
  await expect(help).toHaveAttribute("inert", "");
  await page.keyboard.press("Enter");
  await expect(help).toHaveCount(0); await expect(guide).toBeFocused();
  expect(await settings.evaluate(element => (element as HTMLElement).inert)).toBe(false);
  await settings.getByRole("button", { name: "Use light theme", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Use dark theme", exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(settings).toHaveCount(0); await expect(origin).toBeFocused();
});
