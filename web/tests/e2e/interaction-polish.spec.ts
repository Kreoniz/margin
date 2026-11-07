import { test, expect, type Page } from "@playwright/test";
import { fixture } from "./synthetic-fixture";

// Every request is intercepted, including assets. These UI regressions never
// connect to a personal instance or depend on a running database/server.
async function motion(page: Page, selector: string, trigger: string, closing = false, focus = false) {
  return page.evaluate(async ({ selector, trigger, closing, focus }) => {
    const frames: number[] = [];
    const action = document.querySelector<HTMLElement>(trigger)!;
    if (closing) action.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    else if (focus) action.focus();
    else action.click();
    await new Promise<void>(resolve => {
      const start = performance.now();
      const tick = () => {
        const popup = document.querySelector(selector);
        if (popup) frames.push(Number(getComputedStyle(popup).opacity));
        if (performance.now() - start < 350) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return frames;
  }, { selector, trigger, closing, focus });
}

test("conditionally mounted dialogs animate both ways and honor reduced motion", async ({ page }) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  const sources = page.getByRole("button", { name: "Sources", exact: true });
  await sources.waitFor();
  const trigger = await sources.evaluate(element => { element.id = "sources-motion-trigger"; return "#" + element.id; });
  const opening = await motion(page, ".app-modal", trigger);
  expect(opening.some(value => value > 0 && value < 1)).toBe(true);
  const closing = await motion(page, ".app-modal", ".app-modal", true);
  expect(closing.some(value => value > 0 && value < 1)).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Closing during entry must still complete and allow a fresh opening.
  await sources.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await sources.click();
  expect(await page.getByRole("dialog").evaluate(element => getComputedStyle(element).transitionDuration)).toBe("0s");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("auto-save toggle leaves source rows and following content stationary", async ({ page }) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  const boxes = () => page.locator(".source-row").evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { top: box.top, height: box.height }; }));
  const before = await boxes();
  const checkbox = page.locator(".source-row").first().getByRole("checkbox");
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  expect(await boxes()).toEqual(before);
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  expect(await boxes()).toEqual(before);
});

test("select menus and keyboard tooltips keep opening and closing transitions", async ({ page }) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Add item", exact: true }).waitFor();
  const selectOpen = await motion(page, ".library-filter-panel", '#library-filter-types');
  expect(selectOpen.some(value => value > 0 && value < 1)).toBe(true);
  const selectClose = await motion(page, ".library-filter-panel", ".library-filter-panel", true);
  expect(selectClose.some(value => value > 0 && value < 1)).toBe(true);
  await page.keyboard.press("Tab");
  const tooltipOpen = await motion(page, ".u-tooltip", '[aria-label="Add item"]', false, true);
  expect(tooltipOpen.some(value => value > 0 && value < 1)).toBe(true);
  const tooltipClose = await motion(page, ".u-tooltip", '[aria-label="Search library"]', false, true);
  expect(tooltipClose.some(value => value > 0 && value < 1)).toBe(true);
});

test("Discover shows skeletons initially and while paging without removing existing rows", async ({ page }) => {
  const controls = await fixture(page);
  controls.holdInbox();
  await page.goto("http://margin.test/dashboard#discover");
  await expect(page.getByRole("status", { name: "Loading discoveries" })).toBeVisible();
  expect(await page.locator(".loading-row").count()).toBe(4);
  controls.releaseInbox();
  await expect(page.locator(".article-row")).toHaveCount(40);
  controls.holdInbox();
  const more = page.getByRole("button", { name: "Show more", exact: true });
  await more.focus();
  const before = await more.boundingBox();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status", { name: "Loading discoveries" })).toBeVisible();
  expect(await page.locator(".article-row").count()).toBe(40);
  expect(await page.locator(".loading-row").count()).toBe(3);
  expect(await page.locator(".loading-row").first().getAttribute("aria-hidden")).toBe("true");
  const pending = await more.boundingBox();
  expect(pending!.y).toBeCloseTo(before!.y, 0);
  expect(pending!.y + pending!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  controls.releaseInbox();
  await expect(page.locator(".article-row")).toHaveCount(42);
  await expect(page.getByRole("status", { name: "Loading discoveries" })).toHaveCount(0);
});

test("video previews reserve Library geometry through loading and failure while public layouts remain landscape", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  controls.holdImage();
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  const preview = page.locator(".mini-video").first();
  await expect(preview).toHaveAttribute("data-loading", "true");
  await page.evaluate(() => document.fonts.ready);
  const before = await preview.boundingBox();
  controls.releaseImage();
  await expect(preview).not.toHaveAttribute("data-loading", "true");
  expect(await preview.boundingBox()).toEqual(before);
  expect(before!.height).toBeGreaterThanOrEqual(96); // Both current layouts preserve a useful preview size.
  const checkRatio = async () => {
    for (const box of await page.locator(".mini-video").evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { width: box.width, height: box.height }; }))) expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
  };
  await expect(page.locator(".mini-video").nth(1)).toHaveAttribute("data-empty", "true");
  await page.goto("http://margin.test/");
  await page.locator(".mini-video").first().waitFor();
  await checkRatio();
  await page.goto("http://margin.test/shared/video-1");
  await page.locator(".mini-video").waitFor();
  await checkRatio();
});

test("dark publisher tiles are subdued and scrolling tabs retain a complete focus ring", async ({ page }) => {
  await fixture(page);
  await page.goto("http://margin.test/dashboard#discover");
  await page.locator(".article-row").first().waitFor();
  const tile = page.locator(".article-row .mini-cover").first();
  await expect(tile).toHaveAttribute("data-brand", "openai");
  expect(await tile.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe("rgb(239, 239, 233)");
  await page.keyboard.press("Tab");
  const read = page.locator(".list-tabs").getByRole("button", { name: "Read", exact: true });
  await read.focus();
  const focus = await read.evaluate(element => { const style = getComputedStyle(element); const box = element.getBoundingClientRect(); const parent = element.parentElement!.getBoundingClientRect(); return { visible: element.matches(":focus-visible"), width: parseFloat(style.outlineWidth), offset: parseFloat(style.outlineOffset), inside: box.top >= parent.top && box.bottom <= parent.bottom }; });
  expect(focus.visible).toBe(true);
  expect(focus.width).toBeGreaterThanOrEqual(2);
  expect(focus.offset).toBeLessThanOrEqual(-2);
  expect(focus.inside).toBe(true);
});

test("failed append retains rows, scroll and navigation, then retries its cursor without bootstrap", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("http://margin.test/dashboard#discover");
  await expect(page.locator(".article-row")).toHaveCount(40);
  controls.failCursor();
  controls.failBootstrap();
  const more = page.getByRole("button", { name: "Show more", exact: true });
  await more.focus();
  const before = await page.evaluate(() => ({ y: scrollY, focused: document.activeElement?.textContent }));
  await page.keyboard.press("Enter");
  const error = page.getByRole("alert").filter({ hasText: "Your loaded articles are still available" });
  await expect(error).toBeVisible();
  expect(await page.locator(".article-row").count()).toBe(40);
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(before.y, 0);
  await expect(more).toBeFocused();
  await page.locator('.article-row[data-row-id="inbox-0"]').focus();
  await page.keyboard.press("j");
  await expect(page.locator('.article-row[data-row-id="inbox-1"]')).toBeFocused();
  const bootstrapRequests = controls.requests.bootstrap;
  controls.failCursor(false);
  controls.holdInbox();
  await error.getByRole("button", { name: "Try again", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(error.getByRole("button", { name: "Retrying…", exact: true })).toBeFocused();
  controls.releaseInbox();
  await expect(page.locator(".article-row")).toHaveCount(42);
  expect(controls.requests.bootstrap).toBe(bootstrapRequests);
  expect(controls.requests.inbox.at(-1)).toContain("cursor=second-page");
  await expect(page.locator('.article-row[data-row-id="inbox-40"]')).toBeFocused();
  expect(await page.locator(".article-row").evaluateAll(elements => new Set(elements.map(element => element.getAttribute("data-row-id"))).size)).toBe(42);
  await expect(error).toHaveCount(0);
});

test("failed same-scope refresh retains known rows and count, while new filters show an unknown count", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  controls.holdInbox();
  await page.goto("http://margin.test/dashboard#discover");
  await expect(page.locator(".result-count")).toHaveText("Loading…");
  controls.releaseInbox();
  await expect(page.locator(".article-row")).toHaveCount(40);
  await expect(page.locator(".result-count")).toHaveText("42 articles");
  controls.failInbox();
  await page.getByRole("button", { name: "Check now", exact: true }).click();
  const error = page.getByRole("alert").filter({ hasText: "Your loaded articles are still available" });
  await expect(error).toBeVisible();
  expect(await page.locator(".article-row").count()).toBe(40);
  await expect(page.locator(".result-count")).toHaveText("42 articles");
  controls.failInbox(false);
  await error.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(error).toHaveCount(0);
  controls.holdInbox();
  await page.getByRole("combobox", { name: "Filter source" }).click();
  await page.getByRole("option", { name: "Second source", exact: true }).click();
  await expect(page.locator(".result-count")).toHaveText("Loading…");
  expect(await page.locator(".article-row").count()).toBe(0);
  controls.releaseInbox();
  await expect(page.locator(".result-count")).toHaveText("0 articles");
});

test("initial Discover failure offers a usable direct retry with an unknown count", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  controls.failInbox();
  await page.goto("http://margin.test/dashboard#discover");
  await expect(page.locator(".result-count")).toHaveText("Count unavailable");
  const retry = page.getByRole("alert").getByRole("button", { name: "Try again", exact: true });
  await expect(retry).toBeEnabled();
  const bootstrapRequests = controls.requests.bootstrap;
  controls.failBootstrap();
  controls.failInbox(false);
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".article-row")).toHaveCount(40);
  await expect(page.locator('.article-row[data-row-id="inbox-0"]')).toBeFocused();
  expect(controls.requests.bootstrap).toBe(bootstrapRequests);
});

test("source writes reconcile before a failed refresh and in-dialog retry does not repeat the write", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  controls.failBootstrap();
  const row = page.locator('.source-row[aria-label="OpenAI"]');
  await row.getByRole("checkbox").click();
  await expect(row.getByRole("checkbox")).toBeChecked();
  const modal = page.getByRole("dialog");
  await expect(modal.getByText("Could not refresh sources.", { exact: false })).toBeVisible();
  await expect(row.getByRole("checkbox")).toBeEnabled();
  expect(controls.requests.sourcePatches).toBe(1);
  controls.failBootstrap(false);
  await modal.getByRole("button", { name: "Refresh sources", exact: true }).click();
  await expect(modal.getByRole("button", { name: "Refresh sources", exact: true })).toHaveCount(0);
  await expect(row.getByRole("checkbox")).toBeChecked();
  expect(controls.requests.sourcePatches).toBe(1);
});

test("follow and unfollow acknowledgements survive refresh failure", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  controls.failBootstrap();
  await page.getByRole("textbox", { name: "Follow a website or RSS/Atom feed" }).fill("https://publisher.example/feed");
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  const row = page.locator('.source-row[aria-label="New source"]');
  await expect(row).toBeVisible();
  expect(controls.requests.sourceCreates).toBe(1);
  await row.getByRole("button", { name: "Remove New source", exact: true }).click();
  await row.getByRole("button", { name: "Unfollow", exact: true }).click();
  await expect(row).toHaveCount(0);
  expect(controls.requests.sourceDeletes).toBe(1);
  await expect(page.getByRole("dialog").getByRole("button", { name: "Refresh sources", exact: true })).toBeVisible();
});

test("failed and absent shared video previews retain their landscape frame and full artwork policy", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  controls.holdImage();
  await page.goto("http://margin.test/shared/video-1");
  const preview = page.locator(".mini-video");
  await expect(preview).toHaveAttribute("data-loading", "true");
  await page.evaluate(() => document.fonts.ready);
  const before = await preview.boundingBox();
  const titleBefore = await page.getByRole("heading", { level: 1 }).boundingBox();
  controls.failImage();
  controls.releaseImage();
  await expect(preview).toHaveAttribute("data-empty", "true");
  expect(await preview.boundingBox()).toEqual(before);
  expect(await page.getByRole("heading", { level: 1 }).boundingBox()).toEqual(titleBefore);
  await page.goto("http://margin.test/shared/video-3");
  await expect(preview).toHaveAttribute("data-empty", "true");
  const absent = await preview.boundingBox();
  expect(absent!.width / absent!.height).toBeCloseTo(16 / 9, 1);
  expect(absent!.width).toBeGreaterThan(100);
  controls.failImage(false);
  await page.goto("http://margin.test/shared/video-4");
  await expect(preview).not.toHaveAttribute("data-loading", "true");
  const image = preview.locator("img");
  await expect(image).toBeVisible();
  expect(await image.evaluate(element => ({ natural: element.naturalWidth / element.naturalHeight, fit: getComputedStyle(element).objectFit }))).toEqual({ natural: 0.6, fit: "contain" });
  await expect(page.getByRole("heading", { level: 1 }).locator("svg")).toHaveCount(0);
});

async function expectFocusedControlInsideModal(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const modal = document.querySelector(".app-modal")!;
    const focused = document.activeElement!;
    const box = focused.getBoundingClientRect();
    const viewport = modal.getBoundingClientRect();
    const style = getComputedStyle(focused);
    return { inside: modal.contains(focused) && box.top >= viewport.top + 2 && box.bottom <= viewport.bottom - 2, inset: parseFloat(style.outlineOffset) <= -2 };
  })).toEqual({ inside: true, inset: true });
}

test("real Tab traversal reveals complete fields and focus rings at both modal scroll edges", async ({ page }) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: page.viewportSize()!.width < 600 ? 320 : 1440, height: 900 });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Edit A landscape video", exact: true }).click();
  await page.getByText("Details, image & note", { exact: true }).click();
  const tags = page.getByRole("textbox", { name: "Tags (optional)", exact: true });
  const description = page.getByRole("textbox", { name: "Description (optional)", exact: true });
  const note = page.getByRole("textbox", { name: "Private note", exact: true });
  await tags.focus();
  await page.keyboard.press("Tab");
  await expect(description).toBeFocused();
  await expectFocusedControlInsideModal(page);
  await page.keyboard.press("Tab");
  await expect(note).toBeFocused();
  await expectFocusedControlInsideModal(page);
  await page.keyboard.press("Shift+Tab");
  await expect(description).toBeFocused();
  await expectFocusedControlInsideModal(page);
  await page.keyboard.press("Shift+Tab");
  await expect(tags).toBeFocused();
  await expectFocusedControlInsideModal(page);
  await page.getByRole("dialog").getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByText("Telegram & Hermes", { exact: true }).click();
  // Focus the summary itself rather than its decorative text span.
  await page.locator("summary").filter({ hasText: "Telegram & Hermes" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Create submission token", exact: true })).toBeFocused();
  await expectFocusedControlInsideModal(page);
  await page.getByText("How to submit an item", { exact: true }).click();
  await page.locator("summary").filter({ hasText: "How to submit an item" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("summary").filter({ hasText: "Helium / browser capture" })).toBeFocused();
  await expectFocusedControlInsideModal(page);
  await page.keyboard.press("Shift+Tab");
  await expectFocusedControlInsideModal(page);
});

test("removal cancellation and success use animated close completion with useful final focus", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  const remove = page.locator('[data-row-id="video-1"]');
  const openRemoval = async () => { await remove.locator(".priority-trigger").click(); await page.locator(".priority-panel").getByRole("button", { name: "Remove from library…", exact: true }).click(); };
  const modal = page.getByRole("dialog", { name: "Remove from library?", exact: true });
  await openRemoval();
  const keep = page.getByRole("button", { name: "Keep it", exact: true });
  await keep.evaluate(element => { element.id = "keep-motion-trigger"; });
  // Wait for entry to finish before measuring exit.
  await expect.poll(() => modal.evaluate(element => getComputedStyle(element).opacity)).toBe("1");
  const cancellation = await motion(page, ".app-modal", "#keep-motion-trigger");
  expect(cancellation.some(value => value > 0 && value < 1)).toBe(true);
  await expect(modal).toHaveCount(0);
  await expect(remove).toBeFocused();
  await openRemoval();
  await expect.poll(() => modal.evaluate(element => getComputedStyle(element).opacity)).toBe("1");
  controls.failDelete();
  await page.getByRole("button", { name: "Remove item", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Synthetic removal unavailable", exact: true })).toBeVisible();
  await expect(modal).toBeVisible();
  controls.failDelete(false);
  await page.getByRole("button", { name: "Remove item", exact: true }).evaluate(element => { element.id = "remove-motion-trigger"; });
  const success = await motion(page, ".app-modal", "#remove-motion-trigger");
  expect(success.some(value => value > 0 && value < 1)).toBe(true);
  await expect(modal).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-row-id]")?.getAttribute("data-row-id") || document.activeElement?.id)).toMatch(/^(content|video-[234])$/);
  await expect(remove).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Up next: An unavailable preview", exact: true }).click();
  await page.locator(".priority-panel").getByRole("button", { name: "Remove from library…", exact: true }).click();
  await page.getByRole("button", { name: "Keep it", exact: true }).click();
  await expect(modal).toHaveCount(0);
});

test("rounded status and main navigation selections keep every button and neighbor stationary", async ({ page }, info) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: page.viewportSize()!.width < 600 ? 320 : 1440, height: 900 });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.locator(".list-tabs > button").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  const measure = (selector: string) => page.locator(selector).evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { x: box.x + (element.closest(".list-tabs")?.scrollLeft || 0), y: box.y, width: box.width, height: box.height, weight: style.fontWeight, radius: parseFloat(style.borderTopLeftRadius) };
  }));
  const frames = (selector: string) => page.evaluate(async selector => {
    const samples = [];
    for (let index = 0; index < 10; index++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      samples.push([...document.querySelectorAll(selector)].map(element => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { x: box.x + (element.closest(".list-tabs")?.scrollLeft || 0), y: box.y, width: box.width, height: box.height, weight: style.fontWeight, radius: parseFloat(style.borderTopLeftRadius) };
      }));
    }
    return samples;
  }, selector);
  const navBaseline = await measure(".main-nav > button");
  expect(navBaseline.every(button => button.radius > 0)).toBe(true);
  for (const view of ["Library", "Discover"]) {
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: new RegExp("^" + view) }).click();
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: new RegExp("^" + view) })).toHaveAttribute("aria-current", "page");
    const baseline = await measure(".list-tabs > button");
    expect(baseline.every(button => button.radius > 0 && button.weight === "400")).toBe(true);
    for (let index = 0; index < baseline.length; index++) {
      const button = page.locator(".list-tabs > button").nth(index);
      await button.focus();
      await page.keyboard.press("Enter");
      await expect(button).toHaveAttribute("aria-pressed", "true");
      for (const sample of await frames(".list-tabs > button")) expect(sample).toEqual(baseline);
      const focus = await button.evaluate(element => {
        const style = getComputedStyle(element);
        return { visible: element.matches(":focus-visible"), inset: parseFloat(style.outlineOffset), width: parseFloat(style.outlineWidth), radius: parseFloat(style.borderTopLeftRadius) };
      });
      expect(focus).toMatchObject({ visible: true, inset: -2, width: 2 });
      expect(focus.radius).toBeGreaterThan(0);
    }
  }
  for (const view of ["Library", "Discover", "Library"]) {
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: new RegExp("^" + view) }).click();
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: new RegExp("^" + view) })).toHaveAttribute("aria-current", "page");
    for (const sample of await frames(".main-nav > button")) expect(sample).toEqual(navBaseline);
  }
  await page.keyboard.press("Tab");
  const focused = page.locator(".list-tabs > button").first();
  await focused.focus();
  await page.keyboard.press("Enter");
  expect(await focused.evaluate(element => element.matches(":focus-visible"))).toBe(true);
  await page.screenshot({ path: `test-results/rounded-status-focus-${info.project.name}.png`, animations: "disabled" });
});

async function recoverReadOnly(page: Page, controls: Awaited<ReturnType<typeof fixture>>) {
  controls.failBootstrap(false);
  controls.failInbox(false);
  await page.locator(".connection-notice").getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".connection-notice")).toHaveCount(0);
}

test("Editor create and update acknowledgements remain visible when bootstrap fails", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await expect(page.locator(".media-row")).toHaveCount(4);
  controls.failBootstrap();
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByRole("textbox", { name: "Title or URL", exact: true }).fill("Committed new title");
  await page.getByRole("button", { name: "Add to library", exact: true }).click();
  const modal = page.locator(".app-modal");
  await expect(modal).toHaveCount(0);
  const row = page.locator('.media-row[data-row-id="created-1"]');
  await expect(row).toContainText("Committed new title");
  await expect(page.locator(".media-row")).toHaveCount(5);
  await row.getByRole("button", { name: "Edit Committed new title", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Committed revised title");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(row).toContainText("Committed revised title");
  expect(controls.requests.mediaCreates).toBe(1);
  expect(controls.requests.mediaPatches).toBe(1);
  await recoverReadOnly(page, controls);
  await expect(row).toContainText("Committed revised title");
  expect(controls.requests.mediaCreates).toBe(1);
  expect(controls.requests.mediaPatches).toBe(1);
});

test("Editor deletion removes the acknowledged row, restores focus and invalidates old undo despite failed bootstrap", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await expect(page.locator(".media-row")).toHaveCount(4);
  controls.failBootstrap();
  await page.getByRole("checkbox", { name: "Mark done: An unavailable preview", exact: true }).click();
  await expect(page.getByText("Marked done. Undo returns to unfinished without restoring Up next.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit A landscape video", exact: true }).click();
  const modal = page.locator(".app-modal");
  await modal.getByRole("button", { name: "Remove", exact: true }).click();
  await modal.getByRole("button", { name: "Remove item", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(modal).toHaveCount(0);
  await expect(page.locator('.media-row[data-row-id="video-1"]')).toHaveCount(0);
  await expect(page.locator(".media-row")).toHaveCount(2);
  expect(await page.evaluate(() => document.activeElement?.closest("[data-row-id]")?.getAttribute("data-row-id"))).toMatch(/^video-[34]$/);
  await page.keyboard.press("u");
  expect(controls.requests.mediaPatches).toBe(1);
  expect(controls.requests.mediaDeletes).toBe(1);
  await recoverReadOnly(page, controls);
  await expect(page.getByRole("button", { name: "Edit A landscape video", exact: true })).toHaveCount(0);
  expect(controls.requests.mediaDeletes).toBe(1);
});

test("Library completion, review and their undo actions reconcile authoritative responses before refresh", async ({ page }) => {
  const controls = await fixture(page);
  controls.review("video-1");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await expect(page.locator(".media-row")).toHaveCount(4);
  controls.failBootstrap();
  await page.getByRole("checkbox", { name: "Mark done: A landscape video", exact: true }).click();
  await expect(page.getByText("Marked done. Undo returns to unfinished without restoring Up next.", { exact: true })).toBeVisible();
  await expect(page.locator('.media-row[data-row-id="video-1"]')).toHaveCount(0);
  await page.locator(".list-tabs").getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Mark to read/watch: A landscape video", exact: true })).toBeChecked();
  await page.keyboard.press("u");
  await expect(page.locator(".media-row")).toHaveCount(0);
  await page.locator(".list-tabs").getByRole("button", { name: "Unfinished", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Mark done: A landscape video", exact: true })).not.toBeChecked();
  await page.locator(".list-tabs").getByRole("button", { name: "Needs attention (1)", exact: true }).click();
  await page.getByRole("button", { name: "Mark reviewed: A landscape video", exact: true }).click();
  await expect(page.getByText("Marked reviewed.", { exact: true })).toBeVisible();
  await expect(page.locator(".media-row")).toHaveCount(0);
  await expect(page.locator(".list-tabs").getByRole("button", { name: "Needs attention (0)", exact: true })).toBeVisible();
  await page.keyboard.press("u");
  await expect(page.locator('.media-row[data-row-id="video-1"]')).toBeVisible();
  expect(controls.requests.mediaPatches).toBe(4);
  await recoverReadOnly(page, controls);
  expect(controls.requests.mediaPatches).toBe(4);
});

test("Discover Save reconciles Library and the current scoped count and cursor without a second write", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("http://margin.test/dashboard#discover");
  await expect(page.locator(".article-row")).toHaveCount(40);
  controls.failBootstrap();
  controls.failInbox();
  await page.locator('.article-row[data-row-id="inbox-0"]').getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved to library.", { exact: true })).toBeVisible();
  await expect(page.locator('.article-row[data-row-id="inbox-0"]')).toHaveCount(0);
  await expect(page.locator(".article-row")).toHaveCount(39);
  await expect(page.locator(".result-count")).toHaveText("41 articles");
  controls.failInbox(false);
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(page.locator(".article-row")).toHaveCount(41);
  expect(controls.requests.inbox.at(-1)).toContain("cursor=second-page");
  expect(await page.locator(".article-row").evaluateAll(elements => new Set(elements.map(element => element.getAttribute("data-row-id"))).size)).toBe(41);
  await page.locator(".main-nav > button").first().click();
  await expect(page.locator('.media-row[data-row-id="saved-inbox-0"]')).toContainText("A useful article 0");
  expect(controls.requests.inboxSaves).toBe(1);
  await recoverReadOnly(page, controls);
  expect(controls.requests.inboxSaves).toBe(1);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /Discover/ }).click();
  await page.locator(".list-tabs").getByRole("button", { name: "Saved", exact: true }).click();
  const saved = page.locator('.article-row[data-row-id="inbox-0"]');
  await expect(saved).toContainText("Saved to library");
  await expect(saved.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
});

test("a bootstrap that already read a delayed committed save is not decremented again on acknowledgement", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("http://margin.test/dashboard#discover");
  await expect(page.locator(".article-row")).toHaveCount(40);
  controls.holdInboxAck();
  await page.locator('.article-row[data-row-id="inbox-0"]').getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => controls.requests.inboxCommits).toBe(1);
  await page.getByRole("button", { name: "Check now", exact: true }).click();
  await expect(page.locator('.article-row[data-row-id="inbox-0"]')).toHaveCount(0);
  await expect(page.locator(".result-count")).toHaveText("41 articles");
  controls.failBootstrap();
  controls.failInbox();
  controls.releaseInboxAck();
  await expect(page.getByText("Saved to library.", { exact: true })).toBeVisible();
  await expect(page.locator(".result-count")).toHaveText("41 articles");
  expect(controls.requests.inboxSaves).toBe(1);
  await page.locator(".main-nav > button").first().click();
  await expect(page.locator('.media-row[data-row-id="saved-inbox-0"]')).toHaveCount(1);
});

for (const action of ["read", "dismiss"] as const) test(`Discover ${action} and undo retain acknowledged scoped state through failed reads`, async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("http://margin.test/dashboard#discover");
  await expect(page.locator(".article-row")).toHaveCount(40);
  controls.failBootstrap();
  controls.failInbox();
  await page.locator('.article-row[data-row-id="inbox-0"]').focus();
  await page.keyboard.press(action === "read" ? "r" : "x");
  await expect(page.getByText(action === "read" ? "Marked read." : "Dismissed.", { exact: true })).toBeVisible();
  await expect(page.locator('.article-row[data-row-id="inbox-0"]')).toHaveCount(0);
  await expect(page.locator(".result-count")).toHaveText("41 articles");
  await page.keyboard.press("u");
  await expect(page.locator('.article-row[data-row-id="inbox-0"]')).toBeVisible();
  await expect(page.locator(".article-row")).toHaveCount(40);
  await expect(page.locator(".result-count")).toHaveText("42 articles");
  expect(controls.requests.inboxPatches).toBe(2);
  await recoverReadOnly(page, controls);
  await expect(page.locator(".article-row")).toHaveCount(40);
  expect(controls.requests.inboxPatches).toBe(2);
});

for (const filter of ["source", "query"] as const) test(`an in-flight Discover acknowledgement cannot leak rows or counts into a changed ${filter} scope`, async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("http://margin.test/dashboard#discover");
  await expect(page.locator(".article-row")).toHaveCount(40);
  controls.failBootstrap();
  controls.holdInboxWrite();
  await page.locator('.article-row[data-row-id="inbox-0"]').getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => controls.requests.inboxSaves).toBe(1);
  if (filter === "source") {
    await page.getByRole("combobox", { name: "Filter source" }).click();
    await page.getByRole("option", { name: "Second source", exact: true }).click();
  } else await page.getByRole("searchbox", { name: "Search discoveries" }).fill("no-matching-article");
  await expect(page.locator(".result-count")).toHaveText("0 articles");
  controls.releaseInboxWrite();
  await expect(page.getByText("Saved to library.", { exact: true })).toBeVisible();
  await expect(page.locator(".article-row")).toHaveCount(0);
  await expect(page.locator(".result-count")).toHaveText("0 articles");
  await expect(page.getByRole("button", { name: "Show more", exact: true })).toHaveCount(0);
  expect(controls.requests.inboxSaves).toBe(1);
});

test("keyboard Unfollow focuses the next source and then the Follow field when none remain", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  await expect(page.locator(".source-row")).toHaveCount(2);
  controls.failBootstrap();
  for (const name of ["OpenAI", "Second source"]) {
    const row = page.locator(`.source-row[aria-label="${name}"]`);
    await row.getByRole("button", { name: "Remove " + name, exact: true }).click();
    await row.getByRole("button", { name: "Unfollow", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(row).toHaveCount(0);
    if (name === "OpenAI") await expect(page.getByRole("button", { name: "Pause Second source", exact: true })).toBeFocused();
    else await expect(page.getByRole("textbox", { name: "Follow a website or RSS/Atom feed", exact: true })).toBeFocused();
  }
  expect(controls.requests.sourceDeletes).toBe(2);
});

test("failed Unfollow preserves confirmation focus and removing the last row chooses the previous source", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  controls.failSourceDelete();
  const row = page.locator('.source-row[aria-label="Second source"]');
  await row.getByRole("button", { name: "Remove Second source", exact: true }).click();
  const unfollow = row.getByRole("button", { name: "Unfollow", exact: true });
  await unfollow.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Synthetic source removal unavailable", { exact: true })).toBeVisible();
  await expect(unfollow).toBeFocused();
  await expect(unfollow).toBeEnabled();
  controls.failSourceDelete(false);
  await page.keyboard.press("Enter");
  await expect(row).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pause OpenAI", exact: true })).toBeFocused();
  expect(controls.requests.sourceDeletes).toBe(2);
});

test("a late Unfollow does not steal focus moved elsewhere or after the panel closed", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  controls.holdSourceDelete();
  const first = page.locator('.source-row[aria-label="OpenAI"]');
  await first.getByRole("button", { name: "Remove OpenAI", exact: true }).click();
  await first.getByRole("button", { name: "Unfollow", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => controls.requests.sourceDeletes).toBe(1);
  const url = page.getByRole("textbox", { name: "Follow a website or RSS/Atom feed", exact: true });
  await url.focus();
  controls.releaseSourceDelete();
  await expect(first).toHaveCount(0);
  await expect(url).toBeFocused();
  controls.holdSourceDelete();
  const last = page.locator('.source-row[aria-label="Second source"]');
  await last.getByRole("button", { name: "Remove Second source", exact: true }).click();
  await last.getByRole("button", { name: "Unfollow", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => controls.requests.sourceDeletes).toBe(2);
  await page.locator(".app-modal").getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.locator(".app-modal")).toHaveCount(0);
  const search = page.getByRole("searchbox", { name: "Search library", exact: true });
  await search.focus();
  controls.releaseSourceDelete();
  await expect.poll(() => controls.requests.bootstrap).toBeGreaterThanOrEqual(3);
  await expect(search).toBeFocused();
});

test("narrow Library titles omit the orphan external icon while preserving their native destination", async ({ page }) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  const link = page.locator('.media-row[data-row-id="video-2"] .row-primary-action');
  await expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=AAAAAAAAAAA");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAccessibleName("An unavailable preview");
  await expect(link.locator("svg")).toHaveCount(0);
  const box = await link.evaluate(element => {
    const range = document.createRange(); range.selectNode(element.firstChild!);
    const lines = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).length;
    return { height: element.getBoundingClientRect().height, line: parseFloat(getComputedStyle(element).lineHeight), lines };
  });
  expect(box.height).toBeLessThanOrEqual(box.line * box.lines + 0.5);
});

test("Vim row focus clears outside the list and shortcut dialogs keep semantic heading focus without an outline", async ({ page }) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await expect(page.locator(".media-row")).toHaveCount(4);
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("k");
  const row = page.locator('.media-row[data-row-id="video-1"]');
  await expect(row).toBeFocused();
  await expect(page.locator('.media-row[data-keyboard-active="true"]')).toHaveCount(1);
  expect(await row.evaluate(element => ({ width: getComputedStyle(element).outlineWidth, style: getComputedStyle(element).outlineStyle }))).toEqual({ width: "2px", style: "solid" });
  await page.keyboard.press("g");
  await page.keyboard.press("s");
  const modal = page.getByRole("dialog", { name: "Your sources", exact: true });
  const heading = modal.getByRole("heading", { name: "Your sources", exact: true });
  await expect(heading).toBeFocused();
  expect(await heading.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("none");
  expect(await row.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("none");
  await expect(page.locator('.media-row[data-keyboard-active="true"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(row).toBeFocused();
  const sources = page.getByRole("button", { name: "Sources", exact: true });
  await sources.focus();
  expect(await sources.evaluate(element => ({ visible: element.matches(":focus-visible"), style: getComputedStyle(element).outlineStyle }))).toEqual({ visible: true, style: "solid" });
  expect(await row.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("none");
  await expect(page.locator('.media-row[data-keyboard-active="true"]')).toHaveCount(0);
  await page.keyboard.press("g");
  await page.keyboard.press("s");
  await expect(heading).toBeFocused();
  expect(await heading.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("none");
  await page.keyboard.press("Escape");
  await expect(sources).toBeFocused();
  await page.keyboard.press("j");
  await expect(page.locator('.media-row[data-row-id="video-2"]')).toBeFocused();
});

test("a shortcut dialog opened from BODY does not manufacture a Skip-link focus target", async ({ page }) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await expect(page.locator(".media-row")).toHaveCount(4);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await page.keyboard.press("g");
  await page.keyboard.press("s");
  const modal = page.getByRole("dialog", { name: "Your sources", exact: true });
  await expect(modal.getByRole("heading", { name: "Your sources", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  const skip = page.getByRole("link", { name: "Skip to content", exact: true });
  await expect(skip).not.toBeFocused();
  expect((await skip.boundingBox())!.y).toBeLessThan(0);
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  expect((await skip.boundingBox())!.y).toBeGreaterThanOrEqual(0);
});

test("Tab shows one Library title indicator and retains independent control focus", async ({ page }) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await expect(page.locator(".media-row")).toHaveCount(4);
  await page.keyboard.press("j");
  const row = page.locator('.media-row[data-row-id="video-1"]');
  await page.keyboard.press("Tab");
  const title = row.locator(".row-primary-action");
  await expect(title).toBeFocused();
  const indicators = await title.evaluate(element => ({
    title: getComputedStyle(element).outlineStyle,
    row: getComputedStyle(element.closest(".media-row")!).outlineStyle,
    outer: getComputedStyle(element, "::after").outlineStyle,
    width: getComputedStyle(element, "::after").outlineWidth,
    radius: parseFloat(getComputedStyle(element, "::after").borderTopLeftRadius),
  }));
  expect(indicators).toMatchObject({ title: "none", row: "none", outer: "solid", width: "2px" });
  expect(indicators.radius).toBeGreaterThan(0);
  await expect(page.locator('.media-row[data-keyboard-active="true"]')).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(row.getByRole("button", { name: "Filter channel Synthetic author", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(row.getByRole("checkbox")).toBeFocused();
  await page.keyboard.press("Tab");
  const edit = row.getByRole("button", { name: "Edit A landscape video", exact: true });
  await expect(edit).toBeFocused();
  expect(await edit.evaluate(element => ({ visible: element.matches(":focus-visible"), style: getComputedStyle(element).outlineStyle }))).toEqual({ visible: true, style: "solid" });
  expect(await row.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("none");
  expect(await title.evaluate(element => getComputedStyle(element, "::after").outlineStyle)).toBe("none");
  await page.keyboard.press("Tab");
  await expect(row.getByRole("button", { name: "Up next: A landscape video", exact: true })).toBeFocused();
  await page.getByRole("searchbox", { name: "Search library" }).focus();
  expect(await row.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("none");
  await expect(page.locator('.media-row[data-keyboard-active="true"]')).toHaveCount(0);
});

test("mixed-type Library routine controls stay centered with visible metadata and mobile targets", async ({ page }, info) => {
  const controls = await fixture(page);
  for (const [index, kind] of ["book", "manga", "anime", "video"].entries()) {
    controls.kind("video-" + (index + 1), kind);
    if (index < 3) controls.review("video-" + (index + 1));
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  const mobile = page.viewportSize()!.width < 600;
  await page.setViewportSize({ width: mobile ? 320 : 1440, height: 900 });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await expect(page.locator(".media-row")).toHaveCount(4);
  await page.evaluate(() => document.fonts.ready);
  const rows = await page.locator(".media-row").evaluateAll(elements => elements.map(element => {
    const box = (node: Element) => { const rect = node.getBoundingClientRect(); return { x: rect.x, right: rect.right, width: rect.width, height: rect.height, center: rect.y + rect.height / 2 }; };
    const group = element.querySelector(".row-controls")!;
    const type = element.querySelector(".item-meta .type-label")!;
    return { row: box(element), group: box(group), completion: box(group.querySelector('[role="checkbox"]')!), type: box(type), typeVisible: getComputedStyle(type).display !== "none", buttons: [...group.querySelectorAll("button")].map(box) };
  }));
  for (const row of rows) {
    for (const button of row.buttons) {
      expect(button.center).toBeCloseTo(row.completion.center, 0);
      expect(button.right).toBeLessThanOrEqual(row.row.right);
      if (mobile) { expect(button.height).toBeGreaterThanOrEqual(40); expect(button.width).toBeGreaterThanOrEqual(40); }
    }
    expect(row.typeVisible).toBe(true);
    const actions = row.buttons.slice(-2);
    for (const [index, button] of actions.entries()) {
      const first = rows[0].buttons.slice(-2)[index];
      expect(row.row.right - button.right).toBeCloseTo(rows[0].row.right - first.right, 0);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.keyboard.press("j");
  await page.screenshot({ path: `test-results/rethink-controls-${info.project.name}.png`, animations: "disabled" });
});
