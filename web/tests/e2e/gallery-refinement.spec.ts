import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Media, Kind } from "../../src/types";
import { fixture } from "./synthetic-fixture";

const make = (index: number, kind: Kind, values: Partial<Media> = {}): Media => ({
  id: `refined-${index}`, kind, title: `A useful ${kind} ${index}`, author: "Example creator", status: "pending",
  url: `https://example.com/item-${index}`, cover_url: "", description: "", notes: "", tags: [], visibility: "private",
  created_at: new Date(Date.parse("2026-10-30T00:00:00Z") - index * 1000).toISOString(), updated_at: "2026-10-30T00:00:00Z", ...values,
});
const output = fileURLToPath(new URL("../../../.local/current-refinement/compatibility/implementation-round-1/", import.meta.url));

test("visual shelves reserve uniform artwork geometry through missing, loading and failed sources", async ({ page }, info) => {
  const controls = await fixture(page, [
    make(0, "video", { author: "", url: "" }),
    make(1, "book", { author: "", url: "", cover_url: "javascript:invalid" }),
    make(2, "video", { cover_url: "https://images.test/wide.svg" }),
    make(3, "book", { cover_url: "https://images.test/book.svg" }),
    make(4, "video", { metadata_state: "pending" }),
    make(5, "article", { url: "https://openai.com/example", description: "A compact editorial card with useful reading context." }),
  ]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  controls.holdImage();
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await expect(page.locator(".media-row")).toHaveCount(6);
  await page.evaluate(() => document.fonts.ready);
  const measure = () => page.locator(".media-row").evaluateAll(rows => rows.map(row => {
    const r = row.getBoundingClientRect(), art = row.querySelector(".library-art")!.getBoundingClientRect(), title = row.querySelector(".row-primary-action")!.getBoundingClientRect(), actions = row.querySelector(".row-controls")!.getBoundingClientRect();
    return { id: row.getAttribute("data-row-id"), x: r.x, y: r.y, width: r.width, height: r.height, artHeight: art.height, titleY: title.y, actionsY: actions.y };
  }));
  const before = await measure();
  const item = (index: number) => before.find(row => row.id === `refined-${index}`)!;
  expect(item(0).artHeight).toBeCloseTo(item(2).artHeight, 1);
  expect(item(1).artHeight).toBeCloseTo(item(3).artHeight, 1);
  expect(item(4).artHeight).toBeCloseTo(item(2).artHeight, 1);
  expect(item(5).height).toBeLessThan(item(3).height);
  await expect(page.locator('[data-row-id="refined-4"]')).not.toHaveAttribute("data-art-absent");
  await expect(page.locator('[data-row-id="refined-4"] .gallery-art-fallback')).toHaveText("Finding preview…");
  await expect(page.locator('[data-row-id="refined-5"] img')).toHaveAttribute("src", "/brands/openai.svg");
  await expect(page.locator('[data-row-id="refined-5"] .gallery-art-fallback')).not.toBeVisible();
  await expect(page.locator('[data-row-id="refined-0"] .item-creator')).toHaveCount(0);
  await expect(page.locator('[data-row-id="refined-1"] .item-creator')).toHaveCount(0);
  await expect(page.locator('[data-row-id="refined-0"] .type-label')).toHaveText("Video");
  controls.failImage(); controls.releaseImage();
  await expect(page.locator(".mini-cover[data-loading]")).toHaveCount(0);
  await expect(page.locator('[data-row-id="refined-2"] .mini-cover')).toHaveAttribute("data-empty", "true");
  expect(await measure()).toEqual(before);
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/absent-vs-failed-${info.project.name}.json`, JSON.stringify({ before, after: await measure() }, null, 2));
  await page.screenshot({ path: `${output}/absent-vs-failed-${info.project.name}.png`, animations: "disabled", fullPage: true });
});

test("complete similar-prefix and unbroken titles wrap in both views and phone Shelves retains its headline sizes", async ({ page }, info) => {
  test.setTimeout(60000);
  const prefix = "Почему важен дизайн интерфейса и как выбирать, что читать дальше — ".repeat(3);
  const media = [
    make(0, "video", { title: prefix + "FIRST DISTINCT ENDING", cover_url: "https://images.test/wide.svg" }),
    make(1, "video", { title: prefix + "SECOND DISTINCT ENDING", cover_url: "https://images.test/wide.svg" }),
    make(2, "book", { title: "unbroken".repeat(35) + "COMPLETE ENDING", cover_url: "https://images.test/book.svg" }),
    make(3, "article", { title: prefix + "ARTICLE ENDING" }),
  ];
  await fixture(page, media);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mkdir(output, { recursive: true });
  const evidence = [];
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
    await expect(page.locator(".media-row")).toHaveCount(4);
    await page.evaluate(() => document.fonts.ready);
    for (const layout of ["Shelves", "List"]) {
      await page.getByRole("button", { name: `${layout} view`, exact: true }).click();
      const metrics = await page.locator(".row-primary-action").evaluateAll(titles => titles.map(title => {
        const node = title.firstChild!; const range = document.createRange(); range.setStart(node, Math.max(0, node.textContent!.length - 16)); range.setEnd(node, node.textContent!.length);
        const r = title.getBoundingClientRect(), end = range.getBoundingClientRect(), css = getComputedStyle(title);
        return { title: title.textContent, height: r.height, bottom: r.bottom, right: r.right, endBottom: end.bottom, endRight: end.right, fontSize: css.fontSize, lineHeight: css.lineHeight, clamp: css.webkitLineClamp, clientHeight: title.clientHeight, scrollHeight: title.scrollHeight };
      }));
      expect(metrics.map(item => item.title)).toEqual(media.map(item => item.title));
      for (const item of metrics) {
        expect(item.clamp).toBe("none");
        expect(item.scrollHeight).toBeLessThanOrEqual(item.clientHeight + 1);
        expect(item.endBottom).toBeLessThanOrEqual(item.bottom + 1);
        expect(item.endRight).toBeLessThanOrEqual(item.right + 1);
      }
      if (layout === "Shelves") {
        expect(metrics[0].fontSize).toBe("14px"); expect(metrics[0].lineHeight).toBe("20px");
        expect(metrics[3].fontSize).toBe("14px"); expect(metrics[3].lineHeight).toBe("22px");
      }
      await expect(page.locator('.media-row[data-row-id="refined-0"] .row-primary-action')).toHaveAttribute("href", "https://example.com/item-0");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      if (width === 320) {
        const heading = await page.locator(".page-heading h1").boundingBox(), toggle = await page.locator(".library-layout-switch").boundingBox();
        expect(heading!.y + heading!.height).toBeLessThanOrEqual(toggle!.y);
        for (const button of await page.locator(".library-layout-switch button").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      evidence.push({ width, layout, metrics });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${output}/full-titles-${layout.toLowerCase()}-${width}-${info.project.name}.png`, animations: "disabled" });
    }
  }
  await writeFile(`${output}/full-titles-${info.project.name}.json`, JSON.stringify(evidence, null, 2));
});

for (const layout of ["Shelves", "List"]) {
  test(`${layout} hands native review focus to its row without stealing later focus or pointer selection`, async ({ page }) => {
    const controls = await fixture(page, Array.from({ length: 5 }, (_, index) => make(index, "book", { needs_review: true })));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
    await page.getByRole("button", { name: `${layout} view`, exact: true }).click();
    const row = (index: number) => page.locator(`[data-row-id="refined-${index}"]`);
    const review = (index: number) => row(index).getByRole("button", { name: `Mark reviewed: A useful book ${index}`, exact: true });
    controls.holdMediaWrite(); await review(0).focus(); await page.keyboard.press("Enter");
    await expect(row(0)).toBeFocused();
    controls.releaseMediaWrite(); await expect(review(0)).toHaveCount(0); await expect(row(0)).toBeFocused();
    controls.holdMediaWrite(); await review(1).focus(); await page.keyboard.press("Enter");
    await expect(row(1)).toBeFocused();
    const search = page.getByRole("searchbox", { name: "Search library", exact: true });
    await search.focus(); controls.releaseMediaWrite(); await expect(review(1)).toHaveCount(0); await expect(search).toBeFocused();
    await review(2).click(); await expect(review(2)).toHaveCount(0);
    await expect(row(2)).not.toBeFocused(); await expect(row(2)).not.toHaveAttribute("data-keyboard-active", "true");
    await page.locator(".list-tabs").getByRole("button", { name: "Needs attention (2)", exact: true }).click();
    await review(3).focus(); await page.keyboard.press("Enter");
    await expect(row(3)).toHaveCount(0); await expect(row(4)).toBeFocused();
    expect(controls.requests.mediaPatches).toBe(4);
  });

  test(`${layout} Clear filters consistently focuses search with fresh and previously focused rows`, async ({ page }) => {
    await fixture(page, [make(0, "book"), make(1, "article")]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const history of [false, true]) {
      await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
      await page.getByRole("button", { name: `${layout} view`, exact: true }).click();
      await expect(page.locator(".media-row")).toHaveCount(2);
      if (history) await page.locator(".media-row").first().focus();
      const search = page.getByRole("searchbox", { name: "Search library", exact: true });
      await search.fill("no matching item anywhere");
      const clear = page.getByRole("button", { name: "Clear filters", exact: true });
      await clear.focus(); await page.keyboard.press("Enter");
      await expect(search).toBeFocused(); await expect(search).toHaveValue("");
      await expect(page.locator(".media-row")).toHaveCount(2);
      await expect(page.locator('[data-keyboard-active="true"]')).toHaveCount(0);
    }
  });
}
