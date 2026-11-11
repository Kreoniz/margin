import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Media, Kind } from "../../src/types";
import { fixture } from "./synthetic-fixture";

const make = (index: number, kind: Kind, values: Partial<Media> = {}): Media => ({
  id: `gallery-${index}`, kind, title: `A useful ${kind} ${index}`, author: "Example creator", status: "pending",
  url: `https://example.com/item-${index}`, cover_url: "", description: "", notes: "", tags: [], visibility: "private",
  created_at: new Date(Date.parse("2026-10-30T00:00:00Z") - index * 1000).toISOString(), updated_at: "2026-10-30T00:00:00Z", ...values,
});
const mixed = () => [
  make(0, "video", { title: "Айти рынка больше не существует. Куда идти работать?", cover_url: "https://images.test/video.svg", visibility: "public" }),
  make(1, "book", { title: "Refactoring UI", cover_url: "https://images.test/book.svg", needs_review: true, tags: ["Design"] }),
  make(2, "article", { title: "An updated Model Spec for more capable and beneficial AI", url: "https://openai.com/example", description: "A closer look at sound judgment, human agency, and the choices behind a useful model.", visibility: "public" }),
  make(3, "video", { title: "A landscape idea", cover_url: "https://images.test/wide.svg" }),
  make(4, "paper", { title: "The bitter lesson", description: "General methods that can use more computation have repeatedly proved effective." }),
  make(5, "movie", { title: "An unavailable preview", cover_url: "https://images.test/missing.jpg", metadata_state: "partial" }),
  make(6, "book", { title: "An unbroken title " + "longword".repeat(30), author: "An unusually verbose creator ".repeat(10), cover_url: "https://images.test/square.svg", tags: ["A very long tag ".repeat(8)], needs_review: true, visibility: "public" }),
];
const output = fileURLToPath(new URL("../../../.local/current-refinement/compatibility/implementation-initial/", import.meta.url));

test("switching Shelves and List preserves item identities, filters and browser preference", async ({ page }) => {
  await fixture(page, mixed());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  const gallery = page.getByRole("button", { name: "Shelves view", exact: true });
  const list = page.getByRole("button", { name: "List view", exact: true });
  await gallery.click();
  await expect(gallery).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".media-list")).toHaveAttribute("data-layout", "shelves");
  await expect(page.locator(".media-row")).toHaveCount(7);
  const order = await page.locator(".media-row").evaluateAll(rows => rows.map(row => row.getAttribute("data-row-id")));
  await list.click();
  await expect(list).toHaveAttribute("aria-pressed", "true");
  expect((await page.locator(".media-row").evaluateAll(rows => rows.map(row => row.getAttribute("data-row-id")))).sort()).toEqual(order.sort());
  const search = page.getByRole("searchbox", { name: "Search library", exact: true });
  await search.fill("Refactoring");
  await expect(page.locator(".media-row")).toHaveCount(1);
  await gallery.click();
  await expect(search).toHaveValue("Refactoring");
  await expect(page.locator(".media-row")).toHaveCount(1);
  await search.fill("");
  await page.locator(".list-tabs").getByRole("button", { name: "Needs attention (2)", exact: true }).click();
  await list.click();
  await expect(page.locator(".media-row")).toHaveCount(2);
  await expect(page.locator(".list-tabs").getByRole("button", { name: "Needs attention (2)", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(list).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".media-row")).toHaveCount(7);
  expect(await page.evaluate(() => localStorage.getItem("margin-library-layout"))).toBe("list");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /Discover/ }).click();
  await expect(page.locator(".article-row")).toHaveCount(40);
  await expect(page.getByRole("group", { name: "Library view", exact: true })).toHaveCount(0);
  await page.goto("http://margin.test/shared");
  await expect(page.locator(".collection-card").first()).toBeVisible();
  await expect(page.getByRole("group", { name: "Library view", exact: true })).toHaveCount(0);
});

test("invalid or unavailable browser storage leaves both layouts usable", async ({ page }) => {
  await fixture(page, mixed());
  await page.addInitScript(() => { try { localStorage.setItem("margin-library-layout", "masonry"); } catch { /* Later navigation also probes unavailable storage. */ } });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await expect(page.getByRole("button", { name: "Mixed view", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.addInitScript(() => {
    const originalGet = Storage.prototype.getItem, originalSet = Storage.prototype.setItem;
    Storage.prototype.getItem = function(key) { if (key === "margin-library-layout") throw new DOMException("Storage unavailable", "SecurityError"); return originalGet.call(this, key); };
    Storage.prototype.setItem = function(key, value) { if (key === "margin-library-layout") throw new DOMException("Storage unavailable", "SecurityError"); return originalSet.call(this, key, value); };
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Mixed view", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await expect(page.locator(".media-list")).toHaveAttribute("data-layout", "list");
  await page.getByRole("button", { name: "Shelves view", exact: true }).click();
  await expect(page.locator(".media-row")).toHaveCount(7);
});

test("retained List keeps ordered Vim actions, native Tab, modal return and the forty-item boundary", async ({ page }) => {
  const data = Array.from({ length: 55 }, (_, index) => make(index, index % 2 ? "book" : "article", { cover_url: index % 2 ? "https://images.test/book.svg" : "" }));
  const controls = await fixture(page, data);
  await page.addInitScript(() => localStorage.setItem("margin-library-layout", "list"));
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await expect(page.locator(".media-row")).toHaveCount(40);
  await page.keyboard.press("j"); await page.keyboard.press("j");
  const selected = page.locator('[data-row-id="gallery-1"]'); await expect(selected).toBeFocused();
  await page.keyboard.press("Tab"); await expect(selected.locator(".row-primary-action")).toBeFocused();
  await page.keyboard.press("Tab"); await expect(selected.getByRole("checkbox")).toBeFocused();
  await selected.focus(); await page.keyboard.press("e");
  await expect(page.getByRole("dialog", { name: "Edit item", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(selected).toBeFocused();
  await page.keyboard.press("d"); await page.keyboard.press("d");
  await expect(page.getByRole("dialog", { name: "Remove from library?", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Keep it", exact: true }).click(); await expect(selected).toBeFocused();
  expect(controls.requests.mediaDeletes).toBe(0);
  await page.locator('[data-row-id="gallery-39"]').focus(); await page.keyboard.press("j");
  await expect(page.locator(".media-row")).toHaveCount(55);
  await expect(page.locator('[data-row-id="gallery-40"]')).toBeFocused();
  await page.keyboard.press("End"); await expect(page.locator('[data-row-id="gallery-54"]')).toBeFocused();
  await page.keyboard.press("Space"); await expect(page.locator('[data-row-id="gallery-54"]')).toHaveCount(0);
  expect(controls.requests.mediaPatches).toBe(1);
  await page.keyboard.press("]"); await expect(page.locator('[data-row-id="gallery-54"]')).toBeVisible();
  await expect(page.locator('[data-row-id="gallery-54"]').getByRole("checkbox")).toBeChecked();
});

test("gallery artwork, text and actions remain contained in both themes and narrow and wide screens", async ({ page }, info) => {
  test.setTimeout(90000);
  await fixture(page, mixed());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mkdir(output, { recursive: true });
  const evidence = [];
  for (const width of [320, 390, 768, 1440]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(theme => localStorage.setItem("margin-theme", theme), theme);
    await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
    await expect(page.locator(".media-row")).toHaveCount(7);
    await page.evaluate(() => document.fonts.ready);
    for (const image of await page.locator('.media-row:not([data-row-id="gallery-5"]) img').all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
    }
    const geometry = await page.locator(".media-row").evaluateAll(rows => rows.map(row => {
      const box = (node: Element) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      const image = row.querySelector("img"), art = row.querySelector(".mini-cover")!;
      return { id: row.getAttribute("data-row-id"), row: box(row), art: box(art),
        radius: parseFloat(getComputedStyle(row).borderRadius),
        image: image ? { ...box(image), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, fit: getComputedStyle(image).objectFit, radius: getComputedStyle(image).borderRadius } : null,
        controls: [...row.querySelectorAll(".row-controls .u-choice, .row-actions button")].map(box),
        review: [...row.querySelectorAll(".review-button")].map(box),
      };
    }));
    for (const item of geometry) {
      expect(item.radius).toBeGreaterThanOrEqual(item.id === "gallery-2" || item.id === "gallery-4" ? 6 : 12);
      expect(item.row.right).toBeLessThanOrEqual(width);
      for (const control of [...item.controls, ...item.review]) {
        expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44);
        expect(control.right).toBeLessThanOrEqual(item.row.right);
      }
      const centers = item.controls.map(control => control.y + control.height / 2);
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(1);
      if (item.image && item.id !== "gallery-2") {
        expect(item.image.width / item.image.height).toBeCloseTo(item.image.naturalWidth / item.image.naturalHeight, 2);
        expect(item.image.width).toBeLessThanOrEqual(item.art.width);
        expect(item.image.height).toBeLessThanOrEqual(item.art.height);
        expect(parseFloat(item.image.radius)).toBeGreaterThan(0);
      }
    }
    expect(geometry.find(item => item.id === "gallery-0")!.image!.width).toBeGreaterThanOrEqual(180);
    const book = geometry.find(item => item.id === "gallery-1")!;
    expect(book.image!.height).toBeLessThanOrEqual(book.art.height);
    expect(book.art.height).toBe(144);
    expect(geometry.find(item => item.id === "gallery-2")!.art.width).toBeLessThanOrEqual(32);
    const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")].filter(node => node.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(node => ({ tag: node.tagName, class: node.className, width: node.getBoundingClientRect().width, right: node.getBoundingClientRect().right })));
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), JSON.stringify({ width, theme, overflow })).toBe(false);
    await page.evaluate(() => scrollTo(0, 0));
    evidence.push({ width, theme, geometry });
    await page.screenshot({ path: `${output}/gallery-${theme}-${width}-${info.project.name}.png`, animations: "disabled" });
  }
  await writeFile(`${output}/geometry-${info.project.name}.json`, JSON.stringify(evidence, null, 2));
});

test("gallery image success and failure leave neighboring content stationary and retain a useful fallback", async ({ page }) => {
  const controls = await fixture(page, mixed().slice(0, 2));
  await page.emulateMedia({ reducedMotion: "reduce" });
  controls.holdImage();
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await expect(page.locator(".mini-cover[data-loading]")).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  const measure = () => page.locator(".media-row").evaluateAll(rows => rows.map(row => {
    const r = row.getBoundingClientRect(), title = row.querySelector(".row-primary-action")!.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, titleY: title.y };
  }));
  const before = await measure();
  controls.releaseImage(); await expect(page.locator(".mini-cover[data-loading]")).toHaveCount(0);
  expect(await measure()).toEqual(before);
  controls.failImage(); await page.reload();
  await expect(page.locator(".mini-cover[data-empty]")).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  expect(await measure()).toEqual(before);
  await expect(page.locator(".gallery-art-fallback").first()).toBeVisible();
});
