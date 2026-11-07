import { test, expect, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Media, Kind } from "../../src/types";
import { fixture } from "./synthetic-fixture";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("margin-library-layout", "list"));
});

const item = (id: string, kind: Kind, cover: string): Media => ({
  id, kind, title: `Natural ${id} artwork`, url: `https://example.com/${id}`, cover_url: cover,
  author: "Example creator", status: "pending", description: "", notes: "", tags: [], visibility: "public",
  created_at: "2026-10-30T00:00:00Z", updated_at: "2026-10-30T00:00:00Z",
});
const media = () => [
  item("four-three", "video", "https://images.test/video.svg"),
  item("wide", "video", "https://images.test/wide.svg"),
  item("portrait", "video", "https://images.test/portrait.svg"),
  item("book", "book", "https://images.test/book.svg"),
  item("square-book", "book", "https://images.test/square.svg"),
  item("landscape-book", "book", "https://images.test/wide.svg"),
  item("missing", "video", "https://images.test/missing.jpg"),
];
const output = fileURLToPath(new URL("../../../.local/preview-refinement/", import.meta.url));
type HintTiming = { elapsed: number | null; earlyLabels: string[]; label: string | null };
type HintTimingWindow = Window & { __marginHintTiming: Promise<HintTiming> };

test("natural Library artwork hugs mixed source aspects without colored gutters or cropped content", async ({ page }, info) => {
  await fixture(page, media());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mkdir(output, { recursive: true });
  const evidence = [];
  for (const width of [320, 390, 768, 1440]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(theme => localStorage.setItem("margin-theme", theme), theme);
    await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
    const rows = page.locator(".media-row");
    await expect(rows).toHaveCount(7);
    for (const image of await page.locator('.media-row:not([data-row-id="missing"]) img').all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    }
    await rows.last().scrollIntoViewIfNeeded();
    await expect(rows.last().locator(".mini-cover")).toHaveAttribute("data-empty", "true");
    const geometry = await rows.evaluateAll(elements => elements.map(element => {
      const frame = element.querySelector(".mini-cover")!;
      const image = frame.querySelector("img");
      const box = (node: Element) => { const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height }; };
      return { id: element.getAttribute("data-row-id"), frame: box(frame), background: getComputedStyle(frame).backgroundColor,
        image: image ? { ...box(image), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, radius: getComputedStyle(image).borderRadius } : null,
      };
    }));
    const maxWidth = width < 600 ? 112 : width < 900 ? 128 : 160;
    const maxHeight = width < 600 ? 96 : 108;
    for (const current of geometry) {
      expect(current.frame).toEqual({ width: maxWidth, height: maxHeight });
      expect(current.background).toBe("rgba(0, 0, 0, 0)");
      if (!current.image) continue;
      const image = current.image;
      expect(image.width).toBeLessThanOrEqual(maxWidth);
      expect(image.height).toBeLessThanOrEqual(maxHeight);
      expect(image.width / image.height).toBeCloseTo(image.naturalWidth / image.naturalHeight, 2);
      const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
      expect(image.width).toBeCloseTo(image.naturalWidth * scale, 1);
      expect(image.height).toBeCloseTo(image.naturalHeight * scale, 1);
      expect(parseFloat(image.radius)).toBeGreaterThan(0);
    }
    // The supplied 4:3 source includes black bars. Preserve those source pixels;
    // only the application's colored pillarboxes disappear.
    expect(geometry[0].image!.width).toBeCloseTo(Math.min(maxWidth, maxHeight * 4 / 3), 1);
    expect(geometry[3].image!.height).toBe(maxHeight);
    expect(geometry[4].image!.width).toBe(maxHeight);
    await expect(rows.locator(".row-primary-action svg")).toHaveCount(0);
    await expect(rows.first().locator(".row-primary-action")).toHaveAttribute("href", "https://example.com/four-three");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.evaluate(() => scrollTo(0, 0));
    evidence.push({ width, theme, geometry });
    await page.screenshot({ path: `${output}/natural-${theme}-${width}-${info.project.name}.png`, animations: "disabled" });
  }
  await writeFile(`${output}/natural-${info.project.name}.json`, JSON.stringify(evidence, null, 2));
});

test("reserved natural-art footprint holds rows and text stationary through success and failure", async ({ page }) => {
  const data = media().slice(0, 2);
  const controls = await fixture(page, data);
  await page.emulateMedia({ reducedMotion: "reduce" });
  controls.holdImage();
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await expect(page.locator(".mini-cover[data-loading]")).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  const measure = () => page.locator(".media-row").evaluateAll(elements => elements.map(element => {
    const row = element.getBoundingClientRect(), art = element.querySelector(".library-art")!.getBoundingClientRect(), title = element.querySelector(".row-primary-action")!.getBoundingClientRect();
    return { rowY: row.y, rowHeight: row.height, artWidth: art.width, artHeight: art.height, titleX: title.x, titleY: title.y };
  }));
  const before = await measure();
  controls.releaseImage();
  await expect(page.locator(".mini-cover[data-loading]")).toHaveCount(0);
  expect(await measure()).toEqual(before);
  controls.failImage();
  await page.reload();
  await expect(page.locator(".mini-cover[data-empty]")).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  expect(await measure()).toEqual(before);
});

test("400ms mouse hints dwell on entry, sibling handoff and reentry while focus and touch stay useful", async ({ page }, info) => {
  await fixture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  const row = page.locator(".media-row").first();
  const edit = row.getByRole("button", { name: /^Edit / });
  const remove = row.getByRole("button", { name: /^Remove / });
  const hints = page.getByRole("tooltip");
  if (info.project.name === "desktop") {
    await row.waitFor();
    await page.evaluate(() => document.fonts.ready);
    const observations: HintTiming[] = [];
    const dwell = async (trigger: Locator, label: string) => {
      await trigger.evaluate((element, expectedLabel) => {
        (window as HintTimingWindow).__marginHintTiming = new Promise<HintTiming>(resolve => {
          element.addEventListener("pointerover", () => {
            const started = performance.now();
            let earlyLabels: string[] | undefined;
            let firstVisible: { elapsed: number; label: string } | undefined;
            const tick = () => {
              const elapsed = performance.now() - started;
              const visible = [...document.querySelectorAll<HTMLElement>('[role="tooltip"]')].filter(hint => {
                const css = getComputedStyle(hint);
                return Number(css.opacity) > 0 && css.visibility !== "hidden" && hint.getBoundingClientRect().width > 0;
              });
              if (elapsed >= 180 && earlyLabels === undefined) earlyLabels = visible.map(hint => hint.textContent?.trim() || "");
              const expected = visible.find(hint => hint.textContent?.includes(expectedLabel));
              if (expected && !firstVisible) firstVisible = { elapsed, label: expected.textContent?.trim() || "" };
              if (earlyLabels !== undefined && firstVisible) return resolve({ ...firstVisible, earlyLabels });
              if (elapsed > 1500) return resolve({ elapsed: null, earlyLabels: earlyLabels || [], label: null });
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }, { once: true });
        });
      }, label);
      await trigger.hover();
      const observation = await page.evaluate(() => (window as HintTimingWindow).__marginHintTiming);
      expect(observation.earlyLabels).toEqual([]);
      expect(observation.elapsed).not.toBeNull();
      expect(observation.elapsed!).toBeLessThan(650);
      expect(observation.label).toContain(label);
      await expect(hints).toContainText(label, { timeout: 450 });
      await expect(hints).toBeVisible();
      observations.push(observation);
    };
    await dwell(edit, "Edit item");
    await dwell(remove, "Remove from library");
    await page.mouse.move(0, 0);
    await page.waitForTimeout(60);
    await dwell(edit, "Edit item");
    await hints.hover();
    await page.waitForTimeout(180);
    await expect(hints).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(hints).toHaveCount(0);
    await remove.hover();
    await page.waitForTimeout(120);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(450);
    await expect(hints).toHaveCount(0);
    const timingOutput = fileURLToPath(new URL("../../../.local/gallery-library-2026-10-30/implementation-round-1/", import.meta.url));
    await mkdir(timingOutput, { recursive: true });
    await writeFile(`${timingOutput}/tooltip-mouse-timing.json`, JSON.stringify({ method: "Actual browser pointerover to expected positive-opacity tooltip, with animation-frame observation at 180ms", observations }, null, 2));
  } else {
    await edit.tap();
    await expect(page.getByRole("dialog", { name: "Edit item", exact: true })).toBeVisible();
    await expect(hints).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel", exact: true }).tap();
  }
  await keyboardFocus(page, row, edit);
  await expect(hints).toContainText("Edit item");
  await page.keyboard.press("Escape");
  await expect(hints).toHaveCount(0);
  await expect(edit).toBeFocused();
  await expect(edit).not.toHaveAttribute("aria-describedby");
});

async function keyboardFocus(page: Page, row: Locator, target: Locator) {
  await row.focus();
  for (let step = 0; step < 6; step++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate(element => element === document.activeElement)) return;
  }
  throw new Error("Edit control was not reached through the native Tab order");
}
