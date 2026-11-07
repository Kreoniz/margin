import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Media, Kind } from "../../src/types";
import { fixture } from "./synthetic-fixture";

const make = (index: number, kind: Kind, values: Partial<Media> = {}): Media => ({
  id: `round-two-${index}`, kind, title: `An identifiable ${kind} ${index}`, author: "Example creator", status: "pending",
  url: `https://example.com/${index}`, cover_url: "", description: "", notes: "", tags: [], visibility: "private", needs_review: true,
  created_at: new Date(Date.parse("2026-10-30T00:00:00Z") - index * 1000).toISOString(), updated_at: "2026-10-30T00:00:00Z", ...values,
});
const output = fileURLToPath(new URL("../../../.local/gallery-library-2026-10-30/implementation-round-2/", import.meta.url));

test("phone List compacts only settled absence and retains large pending, loading and failed source geometry", async ({ page }, info) => {
  test.setTimeout(60000);
  const controls = await fixture(page, [
    make(0, "book", { title: "A title-only capture with enough identifying detail to read and review", author: "", url: "" }),
    make(1, "video", { title: "Длинное название сохранённого видео без обложки", cover_url: "javascript:unusable", author: "", url: "" }),
    make(2, "book", { metadata_state: "pending" }),
    make(3, "video", { cover_url: "https://images.test/missing.jpg" }),
    make(4, "video", { cover_url: "https://images.test/wide.svg" }),
  ]);
  await page.addInitScript(() => localStorage.setItem("margin-library-layout", "list"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await expect(page.locator(".media-row")).toHaveCount(5);
  await mkdir(output, { recursive: true });
  const evidence = [];
  for (const width of [320, 390]) for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => localStorage.setItem("margin-theme", theme), theme);
    await page.setViewportSize({ width, height: 1000 });
    controls.holdImage(); await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-appearance", theme);
    await expect(page.locator(".media-row")).toHaveCount(5);
    await page.evaluate(() => document.fonts.ready);
    await page.locator(".media-row").last().scrollIntoViewIfNeeded();
    const measure = () => page.locator(".media-row").evaluateAll(rows => rows.map(row => {
      const box = (node: Element) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height, right: r.right }; };
      const title = row.querySelector(".row-primary-action")!;
      return { row: box(row), art: box(row.querySelector(".mini-cover")!), title: box(title), titleClamped: getComputedStyle(title).webkitLineClamp,
        controls: [...row.querySelectorAll(".review-button, .row-controls > .u-choice, .row-actions button")].map(box) };
    }));
    const before = await measure();
    expect(before.slice(0, 2).map(row => [row.art.width, row.art.height])).toEqual([[40, 40], [40, 40]]);
    expect(before.slice(2).map(row => [row.art.width, row.art.height])).toEqual([[112, 96], [112, 96], [112, 96]]);
    expect(before[0].title.x).toBeLessThan(before[2].title.x);
    for (const row of before) {
      expect(row.titleClamped).toBe("none");
      for (const control of row.controls) {
        expect(control.height).toBeGreaterThanOrEqual(44); expect(control.width).toBeGreaterThanOrEqual(44);
        expect(control.right).toBeLessThanOrEqual(row.row.right);
      }
    }
    controls.releaseImage(); await expect(page.locator(".mini-cover[data-loading]")).toHaveCount(0);
    expect(await measure()).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    evidence.push({ width, theme, geometry: before });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${output}/phone-list-${theme}-${width}-${info.project.name}.png`, fullPage: true, animations: "disabled" });
  }
  await writeFile(`${output}/phone-list-${info.project.name}.json`, JSON.stringify(evidence, null, 2));
});

test("failed Gallery preview gains a legible mark and label within its unchanged reservation", async ({ page }, info) => {
  const controls = await fixture(page, [
    make(0, "book"),
    make(1, "video", { cover_url: "https://images.test/missing.jpg" }),
    make(2, "video", { metadata_state: "pending" }),
    make(3, "article", { url: "https://openai.com/example" }),
    make(4, "video", { cover_url: "https://images.test/wide.svg" }),
  ]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await expect(page.locator(".media-row")).toHaveCount(5);
  await mkdir(output, { recursive: true });
  const evidence = [];
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => localStorage.setItem("margin-theme", theme), theme);
    controls.failImage(false); controls.holdImage(); await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-appearance", theme);
    await expect(page.locator(".media-row")).toHaveCount(5);
    await page.evaluate(() => document.fonts.ready);
    const row = (index: number) => page.locator(`[data-row-id="round-two-${index}"]`);
    await row(4).scrollIntoViewIfNeeded();
    const measure = () => row(4).evaluate(row => {
      const r = row.getBoundingClientRect(), art = row.querySelector(".mini-cover")!.getBoundingClientRect(), title = row.querySelector(".row-primary-action")!.getBoundingClientRect();
      return { y: r.y + scrollY, height: r.height, artHeight: art.height, titleY: title.y + scrollY };
    });
    const before = await measure();
    const absentMark = await row(0).locator(".mini-cover > svg").evaluate(icon => icon.getBoundingClientRect().width);
    const pendingMark = await row(2).locator(".mini-cover > svg").evaluate(icon => icon.getBoundingClientRect().width);
    await expect(row(4).locator(".gallery-art-fallback")).not.toBeVisible();
    await expect(row(0).locator(".gallery-art-fallback")).toHaveText("No preview");
    await expect(row(2).locator(".gallery-art-fallback")).toHaveText("Finding preview…");
    await expect(row(3).locator(".gallery-art-fallback")).not.toBeVisible();
    await expect(row(3).locator("img")).toHaveAttribute("src", "/brands/openai.svg");
    controls.failImage(); controls.releaseImage();
    await expect(row(4).locator(".mini-cover")).toHaveAttribute("data-empty", "true");
    await expect(row(4).locator(".gallery-art-fallback")).toHaveText("Preview unavailable");
    await expect(row(4).locator(".gallery-art-fallback")).toBeVisible();
    expect(await row(4).locator(".mini-cover > svg").evaluate(icon => icon.getBoundingClientRect().width)).toBe(32);
    expect(await row(4).locator(".gallery-art-fallback").evaluate(label => getComputedStyle(label).fontSize)).toBe("13px");
    expect(await row(0).locator(".mini-cover > svg").evaluate(icon => icon.getBoundingClientRect().width)).toBe(absentMark);
    expect(await row(2).locator(".mini-cover > svg").evaluate(icon => icon.getBoundingClientRect().width)).toBe(pendingMark);
    expect(await measure()).toEqual(before); expect(before.artHeight).toBeGreaterThan(120);
    evidence.push({ theme, before, after: await measure() });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${output}/gallery-failure-${theme}-${info.project.name}.png`, fullPage: true, animations: "disabled" });
  }
  await writeFile(`${output}/gallery-failure-${info.project.name}.json`, JSON.stringify(evidence, null, 2));
});
