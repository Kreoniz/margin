import { test, expect, type Locator, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fixture } from "./synthetic-fixture";
import type { Media } from "../../src/types";

const output = fileURLToPath(new URL("../../../.local/preview-refinement/editor/", import.meta.url));
const dialog = (page: Page) => page.locator(".editor-modal");

for (const mode of ["create", "update"] as const) test(`held ${mode} freezes the submitted draft through closing and restores editing after failure`, async ({ page }) => {
  const controls = await fixture(page);
  controls.review("video-1");
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  if (mode === "create") {
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    await dialog(page).getByRole("textbox", { name: "Title or URL", exact: true }).fill("Submitted capture");
  } else await page.getByRole("button", { name: "Edit A landscape video", exact: true }).click();
  const editor = dialog(page);
  await editor.getByText("Details, image & note", { exact: true }).click();
  const title = editor.getByRole("textbox", { name: mode === "create" ? "Title or URL" : "Title", exact: true });
  await title.fill("Submitted title");
  await editor.getByRole("textbox", { name: "Tags (optional)", exact: true }).fill("First tag");
  await editor.getByRole("textbox", { name: "Private note", exact: true }).fill("Submitted private note");
  const visibility = await editor.getByRole("combobox", { name: "Visibility", exact: true }).textContent();
  controls.holdMediaWrite(); controls.failMedia();
  await page.keyboard.press(await primaryKey(page, "Enter"));
  await expect.poll(() => controls.requests.mediaWrites.length).toBe(1);
  await expect(editor.locator(".editor-fields")).toHaveAttribute("disabled", "");
  for (const control of await editor.locator(".editor-fields input, .editor-fields textarea").all()) await expect(control).toBeDisabled();
  for (const label of ["Type", "Visibility", ...(mode === "update" ? ["Status"] : [])]) await expect(editor.getByRole("combobox", { name: label, exact: true })).toBeDisabled();
  if (mode === "update") await expect(editor.getByRole("checkbox")).toBeDisabled();
  await page.keyboard.type(" this text must not be accepted");
  await editor.locator("form").evaluate(form => { form.tabIndex = -1; form.focus(); });
  await page.keyboard.press(await primaryKey(page, "Shift+D"));
  await page.keyboard.press(await primaryKey(page, "Shift+L"));
  await expect(title).toHaveValue("Submitted title");
  await expect(editor.locator("details")).toHaveAttribute("open", "");
  expect(await editor.getByRole("combobox", { name: "Visibility", exact: true }).textContent()).toBe(visibility);
  expect(controls.requests.mediaWrites).toHaveLength(1);
  controls.releaseMediaWrite();
  await expect(editor.getByRole("alert")).toContainText("Synthetic save unavailable");
  await expect(title).toBeEnabled();
  await expect(editor.getByRole("combobox", { name: "Type", exact: true })).toBeEnabled();
  await expect(editor.getByRole("textbox", { name: "Private note", exact: true })).toHaveValue("Submitted private note");
  await title.fill("Retried title");
  controls.failMedia(false); controls.holdMediaWrite();
  await title.press(await primaryKey(page, "Enter"));
  await expect.poll(() => controls.requests.mediaWrites.length).toBe(2);
  await expect(title).toBeDisabled();
  await editor.evaluate(element => {
    const state = window as Window & { closingDraftLocked?: boolean };
    new MutationObserver(() => {
      if (element.hasAttribute("data-ending-style")) state.closingDraftLocked = element.querySelector<HTMLFieldSetElement>(".editor-fields")!.disabled;
    }).observe(element, { attributes: true, attributeFilter: ["data-ending-style"] });
  });
  controls.releaseMediaWrite();
  await expect(editor).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { closingDraftLocked?: boolean }).closingDraftLocked)).toBe(true);
  await expect(page.locator(".media-row").filter({ hasText: "Retried title" })).toHaveCount(1);
  expect(controls.requests.mediaWrites[1]).toMatchObject({ title: "Retried title", notes: "Submitted private note", tags: ["First tag"] });
});

test("late book and metadata results cannot change an in-flight submitted draft", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const lookup of ["book", "metadata"] as const) {
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let started = false;
    await page.route(lookup === "book" ? "**/api/books/search" : "**/api/metadata", async route => {
      started = true; await gate;
      const result = { title: "Late unwanted title", author: "Late author", kind: lookup === "book" ? "book" : "video", cover_url: "https://images.test/wide.svg", url: "https://example.com/late" };
      await route.fulfill({ json: lookup === "book" ? { items: [result] } : result });
    });
    await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    const editor = dialog(page);
    await editor.getByRole("textbox", { name: "Title or URL", exact: true }).fill(lookup === "book" ? "9780132350884" : "https://example.com/metadata");
    await expect.poll(() => started).toBe(true);
    const title = editor.getByRole("textbox", { name: "Title", exact: true });
    await title.fill("Deliberate submitted title");
    controls.holdMediaWrite(); controls.failMedia();
    const before = controls.requests.mediaWrites.length;
    await title.press(await primaryKey(page, "Enter"));
    await expect.poll(() => controls.requests.mediaWrites.length).toBe(before + 1);
    release();
    await page.waitForTimeout(100);
    await expect(title).toHaveValue("Deliberate submitted title");
    controls.releaseMediaWrite();
    await expect(editor.getByRole("alert")).toContainText("Synthetic save unavailable");
    await expect(title).toBeEnabled();
    await expect(title).toHaveValue("Deliberate submitted title");
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  }
});

test("image upload applies its own successful result, then is unavailable during a held save", async ({ page }) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  let uploads = 0;
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/images", async route => { uploads++; await gate; await route.fulfill({ json: { url: "https://images.test/wide.svg" } }); });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  const editor = dialog(page);
  await editor.getByRole("textbox", { name: "Title or URL", exact: true }).fill("Uploaded artwork");
  await editor.getByText("Details, image & note", { exact: true }).click();
  const base64 = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 4; canvas.height = 4; return canvas.toDataURL("image/png").split(",")[1]; });
  const file = { name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
  const upload = editor.getByLabel("Upload image", { exact: true });
  await upload.setInputFiles(file);
  await expect.poll(() => uploads).toBe(1);
  await expect(editor.getByRole("button", { name: "Add to library", exact: true })).toBeDisabled();
  release();
  await expect(editor.getByRole("textbox", { name: "Image URL (optional)", exact: true })).toHaveValue("https://images.test/wide.svg");
  await expect(upload).toBeEnabled();
  controls.holdMediaWrite();
  await editor.getByRole("button", { name: "Add to library", exact: true }).click();
  await expect.poll(() => controls.requests.mediaCreates).toBe(1);
  await expect(upload).toBeDisabled();
  await upload.setInputFiles({ ...file, name: "must-not-upload.png" });
  expect(uploads).toBe(1);
  controls.releaseMediaWrite();
  await expect(editor).toHaveCount(0);
  expect(controls.requests.mediaWrites[0].cover_url).toBe("https://images.test/wide.svg");
});

test("old receipts cannot intercept narrow Editor controls and Sources errors remain above their dialog", async ({ page }, info) => {
  const controls = await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 812 });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await dialog(page).getByRole("textbox", { name: "Title or URL", exact: true }).fill("First quick capture");
  await page.keyboard.press(await primaryKey(page, "Enter"));
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator(".u-toast-title")).toContainText("Added to library.");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  const editor = dialog(page);
  await editor.getByRole("textbox", { name: "Title or URL", exact: true }).fill("Second quick capture");
  await editor.getByText("Details, image & note", { exact: true }).click();
  const save = editor.getByRole("button", { name: "Add to library", exact: true });
  await save.scrollIntoViewIfNeeded();
  await expect(page.locator(".u-toast")).toHaveCount(1);
  expect(await centerHits(save)).toBe(true);
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: `${output}/receipt-editor-hit-${info.project.name}.png` });
  await save.click();
  await expect(editor).toHaveCount(0);
  expect(await page.locator(".u-toast").count()).toBeGreaterThan(0);
  // An Undo receipt remains usable after cancelling the next Editor.
  await page.locator('.media-row[data-row-id="video-1"]').getByRole("checkbox").click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('.media-row[data-row-id="video-1"]')).toBeVisible();
  // Error feedback in Sources retains the original toast layer.
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  controls.failSourceDelete();
  const sources = page.getByRole("dialog", { name: "Your sources", exact: true });
  await sources.getByRole("button", { name: "Remove OpenAI", exact: true }).click();
  await sources.getByRole("button", { name: "Unfollow", exact: true }).click();
  const error = page.locator(".u-toast").filter({ hasText: "Synthetic source removal unavailable" });
  await expect(error).toBeVisible();
  expect(await centerHits(error)).toBe(true);
});

const artwork = (): Media[] => ["video.svg", "wide.svg", "portrait.svg", "square.svg", "book.svg"].map((name, index) => ({
  id: `shared-${index}`, title: `Shared art ${index}`, kind: index > 2 ? "book" : "video", cover_url: `https://images.test/${name}`,
  url: `https://example.com/shared-${index}`, author: "Synthetic creator", status: "pending", notes: "PRIVATE NOTE MUST NOT RENDER", description: index === 0 ? "Visible public description" : index === 1 ? "   " : "", tags: index === 0 ? ["Public tag"] : [], visibility: "public", created_at: "2026-10-30T00:00:00Z", updated_at: "2026-10-30T00:00:00Z",
}));

test("Editor and public artwork retain reserved geometry with rounded natural content and omit empty public slots", async ({ page }, info) => {
  test.setTimeout(90_000);
  const data = artwork();
  const controls = await fixture(page, data);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const records = [];
  await mkdir(output, { recursive: true });
  for (const width of [320, 1440]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem("margin-theme", theme), theme);
    controls.failImage(false);
    await page.goto("http://margin.test/");
    await expect(page.locator(".collection-card")).toHaveCount(5);
    for (const image of await page.locator(".collection-card img").all()) { await image.scrollIntoViewIfNeeded(); await expect.poll(() => image.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0); }
    await expect(page.locator(".shared-description")).toHaveCount(1);
    await expect(page.locator(".shared-tags")).toHaveCount(1);
    await expect(page.locator(".shared-description")).toHaveText("Visible public description");
    await expect(page.locator(".shared-tags")).toHaveText("Public tag");
    await expect(page.getByText("PRIVATE NOTE MUST NOT RENDER", { exact: true })).toHaveCount(0);
    if (width === 1440) {
      const heights = await page.locator(".collection-card").evaluateAll(elements => elements.slice(0, 4).map(element => element.getBoundingClientRect().height));
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.5);
    }
    records.push({ width, theme, collection: await naturalGeometry(page.locator(".collection-card .mini-cover")) });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${output}/collection-${theme}-${width}-${info.project.name}.png` });
    for (const current of data) {
      await page.goto(`http://margin.test/shared/${current.id}`);
      const cover = page.locator(".shared-detail .mini-cover");
      await expect(cover.locator("img")).toBeVisible();
      await expect.poll(() => cover.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
      records.push({ width, theme, id: current.id, detail: await naturalGeometry(cover) });
      await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
      await page.getByRole("button", { name: `Edit ${current.title}`, exact: true }).click();
      await dialog(page).getByText("Details, image & note", { exact: true }).click();
      const previews = dialog(page).locator(".editor-metadata > .mini-cover, .editor-image > .mini-cover");
      await expect(previews).toHaveCount(2);
      records.push({ width, theme, id: current.id, editor: await naturalGeometry(previews) });
      await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
    }
    // Reserve detail/editor footprints while requests are held and after 404.
    for (const context of ["detail", "editor"] as const) {
      controls.holdImage();
      await page.goto(context === "detail" ? "http://margin.test/shared/shared-4" : "http://margin.test/dashboard#library");
      if (context === "editor") { await page.getByRole("button", { name: "Edit Shared art 4", exact: true }).click(); await dialog(page).getByText("Details, image & note", { exact: true }).click(); }
      const frames = context === "detail" ? page.locator(".shared-detail .mini-cover") : dialog(page).locator(".editor-metadata > .mini-cover, .editor-image > .mini-cover");
      await expect(frames.first()).toHaveAttribute("data-loading", "true");
      const before = await frames.evaluateAll(elements => elements.map(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
      controls.failImage(); controls.releaseImage();
      for (const frame of await frames.all()) await expect(frame).toHaveAttribute("data-empty", "true");
      expect(await frames.evaluateAll(elements => elements.map(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })))).toEqual(before);
      controls.failImage(false);
      if (context === "editor") await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
    }
  }
  await writeFile(`${output}/public-editor-geometry-${info.project.name}.json`, JSON.stringify(records, null, 2));
});

async function centerHits(locator: Locator) {
  return locator.evaluate(element => { const rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)); });
}
async function naturalGeometry(frames: Locator) {
  for (const frame of await frames.all()) await expect.poll(() => frame.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  const geometry = await frames.evaluateAll(elements => elements.map(element => {
    const frame = element.getBoundingClientRect(), image = element.querySelector("img")!, bounds = image.getBoundingClientRect();
    return { width: frame.width, height: frame.height, background: getComputedStyle(element).backgroundColor,
      image: { width: bounds.width, height: bounds.height, ratio: image.naturalWidth / image.naturalHeight, radius: getComputedStyle(image).borderRadius } };
  }));
  for (const frame of geometry) {
    expect(frame.background).toBe("rgba(0, 0, 0, 0)");
    expect(frame.image.width / frame.image.height).toBeCloseTo(frame.image.ratio, 2);
    expect(frame.image.width).toBeLessThanOrEqual(frame.width + 0.1);
    expect(frame.image.height).toBeLessThanOrEqual(frame.height + 0.1);
    expect(parseFloat(frame.image.radius)).toBeGreaterThan(0);
  }
  return geometry;
}

async function primaryKey(page: Page, key: string) {
  return await page.evaluate(() => (navigator.platform + navigator.userAgent).toLowerCase().includes("mac") ? "Meta" : "Control") + "+" + key;
}
