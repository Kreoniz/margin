import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Media } from "../../src/types";
import { fixture } from "./synthetic-fixture";

type MotionSample = { at: number; scrollWidth: number; activeAnimations: number; rows: { id: string; left: number; right: number; top: number; documentLeft: number; translateX: number }[] };
type MotionWindow = Window & { __galleryMotion: Promise<MotionSample[]> };
const output = fileURLToPath(new URL("../../../.local/current-refinement/compatibility/implementation-round-2/", import.meta.url));
const makeMedia = (count = 12): Media[] => Array.from({ length: count }, (_, index) => ({
  id: `motion-${index}`, title: `Recognizable item ${index}`, kind: index % 2 ? "book" : "video",
  cover_url: `https://images.test/${index % 2 ? "book" : "wide"}.svg`, author: "Synthetic creator",
  url: `https://example.com/${index}`, description: "", notes: "", tags: [], status: "pending", visibility: "private",
  created_at: new Date(Date.parse("2026-10-30T00:00:00Z") - index * 1000).toISOString(), updated_at: "2026-10-30T00:00:00Z",
}));

async function observeChange(page: Page, change: { layout?: string; removedId?: string }) {
  await page.locator(".media-list").evaluate((list, change) => {
    (window as MotionWindow).__galleryMotion = new Promise<MotionSample[]>(resolve => {
      const observer = new MutationObserver(() => {
        if (change.layout && list.getAttribute("data-layout") !== change.layout) return;
        if (change.removedId && list.querySelector(`[data-row-id="${change.removedId}"]`)) return;
        observer.disconnect();
        const start = performance.now(), samples: MotionSample[] = [];
        const sample = () => {
          const rows = [...list.querySelectorAll<HTMLElement>(".media-row")];
          samples.push({
            at: performance.now() - start,
            scrollWidth: document.documentElement.scrollWidth,
            activeAnimations: rows.flatMap(row => row.getAnimations()).length,
            rows: rows.map(row => {
              const rect = row.getBoundingClientRect(), transform = getComputedStyle(row).transform;
              return { id: row.dataset.rowId!, left: rect.left, right: rect.right, top: rect.top + scrollY, documentLeft: rect.left + scrollX, translateX: transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41 };
            }),
          });
          if (performance.now() - start < 280) requestAnimationFrame(sample);
          else resolve(samples);
        };
        sample();
      });
      observer.observe(list, change.layout ? { attributes: true, attributeFilter: ["class", "data-layout"] } : { childList: true, subtree: true });
    });
  }, change);
}
async function observations(page: Page) {
  return page.evaluate(() => (window as MotionWindow).__galleryMotion);
}
function contained(samples: MotionSample[], viewportWidth = 900) {
  expect(samples.length).toBeGreaterThan(1);
  for (const sample of samples) {
    expect(sample.scrollWidth).toBeLessThanOrEqual(viewportWidth);
    for (const row of sample.rows) {
      expect(row.left).toBeGreaterThanOrEqual(0);
      expect(row.right).toBeLessThanOrEqual(viewportWidth);
    }
  }
}

for (const motion of ["no-preference", "reduce"] as const) {
  test(`Shelves/List presentation changes reset motion geometry and keep subsequent mutations correct (${motion})`, async ({ page }, info) => {
    test.setTimeout(60000);
    const controls = await fixture(page, makeMedia(8));
    await page.setViewportSize({ width: 900, height: 1000 });
    await page.emulateMedia({ reducedMotion: motion });
    const evidence = [];
    for (const theme of ["dark", "light"]) {
      await page.addInitScript(theme => {
        localStorage.setItem("margin-theme", theme);
        localStorage.setItem("margin-library-layout", "shelves");
      }, theme);
      await page.goto("http://margin.test/dashboard");
      await expect(page.locator(".media-row")).toHaveCount(theme === "dark" ? 8 : 6);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      for (const layout of ["List", "Shelves"]) {
        await observeChange(page, { layout: layout.toLowerCase() });
        await page.getByRole("button", { name: `${layout} view`, exact: true }).click();
        const switched = await observations(page);
        contained(switched);
        expect(switched.every(sample => sample.activeAnimations === 0)).toBe(true);
        const first = page.locator(".media-row").first(), removedId = (await first.getAttribute("data-row-id"))!;
        await first.focus();
        await observeChange(page, { removedId });
        await page.keyboard.press("Space");
        const mutated = await observations(page);
        contained(mutated);
        expect(mutated.some(sample => sample.activeAnimations > 0)).toBe(motion === "no-preference");
        if (layout === "List") for (const sample of mutated) for (const row of sample.rows) expect(Math.abs(row.translateX)).toBeLessThan(0.01);
        evidence.push({ theme, layout, switched, mutated });
      }
    }
    expect(controls.requests.mediaPatches).toBe(4);
    await mkdir(output, { recursive: true });
    await writeFile(`${output}/presentation-motion-${motion}-${info.project.name}.json`, JSON.stringify(evidence, null, 2));
  });
}

for (const [layout, from, to, motion] of [
  ["Shelves", 1440, 900, "no-preference"],
  ["List", 1440, 900, "no-preference"],
  ["Shelves", 900, 390, "no-preference"],
  ["List", 900, 390, "no-preference"],
  ["Shelves", 900, 900, "no-preference"],
  ["Shelves", 1440, 900, "reduce"],
] as const) {
  test(`responsive geometry rebase keeps ${layout} ${from} to ${to} and its next mutation contained (${motion})`, async ({ page }, info) => {
    const controls = await fixture(page, makeMedia());
    await page.addInitScript(layout => localStorage.setItem("margin-library-layout", layout.toLowerCase()), layout);
    await page.setViewportSize({ width: from, height: 1000 });
    await page.emulateMedia({ reducedMotion: motion });
    await page.goto("http://margin.test/dashboard");
    await expect(page.locator(".media-row")).toHaveCount(12);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: to, height: 1000 });
    await page.waitForTimeout(300);
    const frames = [];
    for (const index of [0, 1]) {
      await page.locator(`[data-row-id="motion-${index}"]`).focus();
      const nextId = await page.locator(".media-row").evaluateAll((rows, id) => { const ids = rows.map(row => row.getAttribute("data-row-id")!); const at = ids.indexOf(id); return ids[at + 1] || ids[at - 1]; }, `motion-${index}`);
      await observeChange(page, { removedId: `motion-${index}` });
      await page.keyboard.press("Space");
      const samples = await observations(page);
      contained(samples, to);
      const expectedAnimation = motion === "no-preference" && (index === 1 || from === to);
      expect(samples.some(sample => sample.activeAnimations > 0)).toBe(expectedAnimation);
      await expect(page.locator(`[data-row-id="${nextId}"]`)).toBeFocused();
      frames.push(samples);
    }
    expect(controls.requests.mediaPatches).toBe(2);
    await mkdir(output, { recursive: true });
    await writeFile(`${output}/resize-${layout.toLowerCase()}-${from}-${to}-${motion}-${info.project.name}.json`, JSON.stringify({ layout, from, to, motion, frames }, null, 2));
  });
}

for (const layout of ["Shelves", "List"]) {
  test(`content-only metadata reflow rebases ${layout} before a later native mutation`, async ({ page }, info) => {
    const media = makeMedia(); media[0].metadata_state = "pending";
    const controls = await fixture(page, media);
    await page.addInitScript(layout => localStorage.setItem("margin-library-layout", layout.toLowerCase()), layout);
    await page.setViewportSize({ width: 900, height: 1000 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("http://margin.test/dashboard");
    await expect(page.locator(".media-row")).toHaveCount(12);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    const watched = page.locator(`[data-row-id="motion-${layout === "Shelves" ? 6 : 2}"]`);
    const top = () => watched.evaluate(row => row.getBoundingClientRect().top + scrollY);
    const originalTop = await top();
    const enrichedTitle = "A newly enriched title with substantial identifying detail and several contextual clauses. ".repeat(12);
    controls.enrichMedia("motion-0", { title: enrichedTitle, metadata_state: "ready" });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator('[data-row-id="motion-0"] .row-primary-action')).toHaveText(enrichedTitle);
    await page.waitForTimeout(300);
    await page.locator('[data-row-id="motion-11"]').focus();
    const reflowedTop = await top();
    expect(reflowedTop - originalTop).toBeGreaterThan(100);
    await observeChange(page, { removedId: "motion-11" });
    await page.keyboard.press("Space");
    const unchangedRows = await observations(page);
    contained(unchangedRows);
    for (const sample of unchangedRows) expect(Math.abs(sample.rows.find(row => row.id === `motion-${layout === "Shelves" ? 6 : 2}`)!.top - reflowedTop)).toBeLessThan(1);
    await page.locator('[data-row-id="motion-0"]').focus();
    await observeChange(page, { removedId: "motion-0" });
    await page.keyboard.press("Space");
    const ordinaryMutation = await observations(page);
    contained(ordinaryMutation);
    expect(ordinaryMutation.some(sample => sample.activeAnimations > 0)).toBe(true);
    expect(controls.requests.mediaPatches).toBe(2);
    await mkdir(output, { recursive: true });
    await writeFile(`${output}/content-reflow-${layout.toLowerCase()}-${info.project.name}.json`, JSON.stringify({ originalTop, reflowedTop, unchangedRows, ordinaryMutation }, null, 2));
  });
}

test("centered constant-width resize rebases document origin without moving earlier Shelves rows", async ({ page }, info) => {
  const controls = await fixture(page, makeMedia());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("http://margin.test/dashboard");
  await expect(page.locator(".media-row")).toHaveCount(12);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const initialWidth = (await page.locator(".media-list").boundingBox())!.width;
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(300);
  expect((await page.locator(".media-list").boundingBox())!.width).toBe(initialWidth);
  await page.locator('[data-row-id="motion-11"]').focus();
  const before = await page.locator(".media-row").evaluateAll(rows => Object.fromEntries(rows.map(row => {
    const r = row.getBoundingClientRect(); return [row.getAttribute("data-row-id"), { left: r.left + scrollX, top: r.top + scrollY }];
  })));
  await observeChange(page, { removedId: "motion-11" });
  await page.keyboard.press("Space");
  const frames = await observations(page);
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/centered-origin-${process.env.MARGIN_MOTION_PHASE || "verified"}-${info.project.name}.json`, JSON.stringify({ initialWidth, before, frames }, null, 2));
  contained(frames, 1600);
  for (const frame of frames) for (const row of frame.rows.filter(row => Number(row.id.slice(7)) < 9)) {
    expect(Math.abs(row.documentLeft - before[row.id].left)).toBeLessThan(1);
    expect(Math.abs(row.top - before[row.id].top)).toBeLessThan(1);
  }
  await page.locator('[data-row-id="motion-0"]').focus();
  await observeChange(page, { removedId: "motion-0" });
  await page.keyboard.press("Space");
  const ordinary = await observations(page);
  contained(ordinary, 1600);
  expect(ordinary.some(frame => frame.activeAnimations > 0)).toBe(true);
  expect(controls.requests.mediaPatches).toBe(2);
});
