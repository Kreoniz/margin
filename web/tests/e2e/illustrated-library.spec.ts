import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Media, Kind } from "../../src/types";
import { fixture } from "./synthetic-fixture";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("margin-library-layout", "list"));
});

const make = (index: number, kind: Kind, values: Partial<Media> = {}): Media => ({
  id: `art-${index}`, title: `Saved ${kind} ${index}`, kind, author: "Example creator", status: "pending",
  url: `https://example.com/item-${index}`, cover_url: "", description: "", notes: "", tags: [], visibility: "private",
  created_at: new Date(Date.parse("2026-10-30T00:00:00Z") - index * 1000).toISOString(), updated_at: "2026-10-30T00:00:00Z",
  ...values,
});
const mixed = () => [
  make(0, "video", { title: "A wide idea worth watching", cover_url: "https://images.test/wide.svg", visibility: "public" }),
  make(1, "book", { title: "Designing a reading life", cover_url: "https://images.test/book.svg", author: "Example author", tags: ["Design"] }),
  make(2, "game", { title: "An illustrated world", cover_url: "https://images.test/wide.svg", needs_review: true }),
  make(3, "video", { title: "An unavailable preview", cover_url: "https://images.test/missing.jpg" }),
  make(4, "article", { title: "An article to come back to", url: "https://openai.com/example", author: "OpenAI", visibility: "public" }),
  make(5, "paper", { title: "A useful research paper", metadata_state: "pending" }),
  make(6, "manga", { cover_url: "https://images.test/manga.svg" }),
  make(7, "anime", { cover_url: "https://images.test/wide.svg" }),
  make(8, "movie", { cover_url: "https://images.test/portrait.svg" }),
  make(9, "other"),
  make(10, "book", { title: "An adversarial title " + "unbroken".repeat(35), author: "A very long creator ".repeat(15), cover_url: "https://images.test/book.svg", visibility: "public", needs_review: true, metadata_state: "partial", metadata_warning: "Synthetic incomplete details", tags: ["A long tag ".repeat(12), "Another tag"] }),
];
const out = fileURLToPath(new URL("../../../.local/illustrated-library/", import.meta.url));

test("illustrated Library has meaningful contained art and usable controls in both themes and viewport sizes", async ({ page }, info) => {
  await fixture(page, mixed());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mkdir(out, { recursive: true });
  const metrics = [];
  for (const width of [320, 390, 768, 1440]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem("margin-theme", theme), theme);
    await page.goto("http://margin.test/dashboard");
    await expect(page.locator(".media-row")).toHaveCount(11);
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.locator('.media-row[data-row-id="art-0"] img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await expect.poll(() => page.locator('.media-row[data-row-id="art-1"] img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    const geometry = await page.locator(".media-row").evaluateAll(elements => elements.map(element => {
      const box = (node: Element) => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }; };
      const art = element.querySelector(".library-art .mini-cover")!;
      const image = art.querySelector("img");
      const artBox = box(art);
      const scale = image?.naturalWidth ? Math.min(artBox.width / image.naturalWidth, artBox.height / image.naturalHeight) : 0;
      return { id: element.getAttribute("data-row-id"), row: box(element), art: artBox,
        rendered: image?.naturalWidth ? { width: image.naturalWidth * scale, height: image.naturalHeight * scale, fit: getComputedStyle(image).objectFit } : null,
        controls: [...element.querySelectorAll(".row-controls .u-choice, .row-controls .row-actions button")].map(box),
        typeVisible: getComputedStyle(element.querySelector(".item-meta .type-label")!).display !== "none",
        public: [...element.querySelectorAll(".public-marker")].map(box),
      };
    }));
    const artWidth = width < 600 ? 112 : width < 900 ? 128 : 160;
    const bookWidth = width < 600 ? 64 : 72;
    const bookHeight = width < 600 ? 96 : 108;
    expect(geometry[0].art.width).toBe(artWidth);
    expect(geometry[0].art.height).toBe(bookHeight);
    expect(geometry[0].rendered!.width).toBeCloseTo(artWidth, 3);
    expect(geometry[0].rendered!.height).toBeCloseTo(artWidth * 9 / 16, 3);
    expect(geometry[0].rendered!.fit).toBe("contain");
    expect(geometry[1].art.width).toBe(artWidth);
    expect(geometry[1].art.height).toBe(bookHeight);
    expect(geometry[1].rendered!.width).toBeCloseTo(bookWidth, 3);
    expect(geometry[1].rendered!.height).toBeCloseTo(bookHeight, 3);
    expect(geometry[1].rendered!.fit).toBe("contain");
    expect(geometry[4].art.width).toBeLessThanOrEqual(48);
    expect(geometry[4].row.height).toBeLessThan(geometry[1].row.height);
    for (const item of geometry) {
      expect(item.typeVisible).toBe(true);
      expect(item.controls).toHaveLength(3);
      for (const control of item.controls) {
        expect(control.width).toBeGreaterThanOrEqual(44);
        expect(control.height).toBeGreaterThanOrEqual(44);
        expect(control.right).toBeLessThanOrEqual(item.row.right + 0.1);
      }
      const centers = item.controls.map(control => control.y + control.height / 2);
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(0.5);
      expect(item.controls.map(control => control.x)).toEqual(geometry[0].controls.map(control => control.x));
      for (const marker of item.public) { expect(marker.width).toBeGreaterThan(30); expect(marker.right).toBeLessThanOrEqual(item.row.right); }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(await page.locator(".page-heading h1").evaluate(element => getComputedStyle(element).fontSize)).toBe("26px");
    await expect(page.locator(".page-heading p")).toHaveCount(0);
    const visible = geometry.filter(item => item.row.bottom <= 900 && item.row.y >= 0).length;
    metrics.push({ width, theme, firstRowY: geometry[0].row.y, fullyVisibleRows: visible, geometry });
    await page.screenshot({ path: `${out}/library-${theme}-${width}-${info.project.name}.png`, animations: "disabled" });
  }
  await writeFile(`${out}/geometry-${info.project.name}.json`, JSON.stringify(metrics, null, 2));
});

test("Library image loading and failure keep kind-specific frames and neighboring text stationary", async ({ page }) => {
  const data = mixed().slice(0, 2);
  const controls = await fixture(page, data);
  await page.emulateMedia({ reducedMotion: "reduce" });
  controls.holdImage();
  await page.goto("http://margin.test/dashboard");
  await expect(page.locator(".media-row")).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  const measure = () => page.locator(".media-row").evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect(); const art = element.querySelector(".library-art .mini-cover")!.getBoundingClientRect(); const title = element.querySelector(".row-primary-action")!.getBoundingClientRect();
    return { rowY: rect.y, rowHeight: rect.height, artWidth: art.width, artHeight: art.height, titleY: title.y };
  }));
  const before = await measure();
  controls.failImage(); controls.releaseImage();
  await expect(page.locator(".library-art [data-empty='true']")).toHaveCount(2);
  expect(await measure()).toEqual(before);
});

test("populated Library chrome stays stable across filters and other image consumers retain their dimensions", async ({ page }) => {
  await fixture(page, mixed());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("http://margin.test/dashboard");
  await expect(page.locator(".media-row")).toHaveCount(11);
  const before = await page.locator(".page-heading").boundingBox();
  await page.locator(".list-tabs").getByRole("button", { name: "Done", exact: true }).click();
  expect(await page.locator(".page-heading").boundingBox()).toEqual(before);
  await expect(page.locator(".page-heading p")).toHaveCount(0);
  await page.locator(".list-tabs").getByRole("button", { name: "To read/watch", exact: true }).click();
  await page.getByRole("button", { name: "Edit A wide idea worth watching", exact: true }).click();
  await page.getByText("Details, image & note", { exact: true }).click();
  expect(await page.locator(".editor-image .mini-video").evaluate(element => { const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height }; })).toEqual({ width: 80, height: 45 });
  await page.locator(".app-modal").getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.locator(".main-nav > button").nth(1).click();
  await page.locator(".article-row").first().waitFor();
  expect(await page.locator(".article-row .mini-cover").first().evaluate(element => element.getBoundingClientRect().width)).toBe(page.viewportSize()!.width < 600 ? 48 : 72);
  await page.goto("http://margin.test/shared/art-0");
  const shared = page.locator(".shared-detail .mini-video");
  await shared.waitFor();
  expect(await shared.evaluate(element => { const rect = element.getBoundingClientRect(); return rect.width / rect.height; })).toBeCloseTo(16 / 9, 2);
});

test("illustrated rows preserve native Tab order, distinct review, shortcuts and dialog return focus", async ({ page }) => {
  const data = mixed();
  const controls = await fixture(page, data);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("http://margin.test/dashboard");
  await expect(page.locator(".media-row")).toHaveCount(11);
  await page.keyboard.press("j");
  const first = page.locator('.media-row[data-row-id="art-0"]');
  await page.keyboard.press("Tab");
  await expect(first.locator(".row-primary-action")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first.getByRole("checkbox")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first.getByRole("button", { name: "Edit A wide idea worth watching", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first.getByRole("button", { name: "Remove A wide idea worth watching", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(first.getByRole("button", { name: "Edit A wide idea worth watching", exact: true })).toBeFocused();
  await first.focus();
  await page.keyboard.press("g"); await page.keyboard.press("s");
  const sources = page.getByRole("dialog", { name: "Your sources", exact: true });
  const heading = sources.getByRole("heading", { name: "Your sources", exact: true });
  await expect(heading).toBeFocused();
  expect(await heading.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("none");
  await page.keyboard.press("Escape"); await expect(first).toBeFocused();
  await page.keyboard.press("e");
  await expect(page.getByRole("dialog", { name: "Edit item", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(first).toBeFocused();
  await page.keyboard.press("d"); await page.keyboard.press("d");
  await expect(page.getByRole("dialog", { name: "Remove from library?", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Keep it", exact: true }).click(); await expect(first).toBeFocused();
  await page.keyboard.press("Space");
  await expect(first).toHaveCount(0);
  expect(controls.requests.mediaPatches).toBe(1);
  await page.keyboard.press("]");
  await expect(first).toBeVisible();
  await expect(first.getByRole("checkbox")).toBeChecked();
});

test("half-page navigation uses mixed row positions and can cross the forty-item Library boundary", async ({ page }) => {
  const data = Array.from({ length: 55 }, (_, index) => make(index, index % 2 ? "book" : "article", { title: `Mixed item ${index}`, cover_url: index % 2 ? "https://images.test/book.svg" : "" }));
  await fixture(page, data);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("http://margin.test/dashboard");
  await expect(page.locator(".media-row")).toHaveCount(40);
  await page.keyboard.press("j");
  const position = () => page.evaluate(() => { const element = document.activeElement!.closest(".media-row")!; return { id: element.getAttribute("data-row-id"), top: element.getBoundingClientRect().top + scrollY }; });
  const start = await position();
  await page.keyboard.press("Control+d");
  const down = await position();
  expect(down.top - start.top).toBeGreaterThan(innerHalf(page.viewportSize()!.height) - 140);
  expect(down.top - start.top).toBeLessThan(innerHalf(page.viewportSize()!.height) + 140);
  await page.keyboard.press("Control+u");
  expect((await position()).top).toBeCloseTo(start.top, -2);
  await page.locator('.media-row[data-row-id="art-39"]').focus();
  await page.keyboard.press("Control+d");
  await expect(page.locator(".media-row")).toHaveCount(55);
  await expect(page.locator('.media-row[data-row-id="art-40"]')).toBeFocused();
  await page.keyboard.press("End"); await expect(page.locator('.media-row[data-row-id="art-54"]')).toBeFocused();
  await page.keyboard.press("Home"); await expect(page.locator('.media-row[data-row-id="art-0"]')).toBeFocused();
  await page.getByRole("searchbox", { name: "Search library" }).focus();
  await page.keyboard.press("Control+d");
  await expect(page.getByRole("searchbox", { name: "Search library" })).toBeFocused();
});
function innerHalf(height: number) { return height / 2; }
