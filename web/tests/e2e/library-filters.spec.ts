import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fixture } from "./synthetic-fixture";
import type { Media } from "../../src/types";

const make = (id: string, values: Partial<Media>): Media => ({
  id, title: id, kind: "book", author: "A writer", url: "", cover_url: "", description: "", notes: "", tags: [],
  status: "pending", visibility: "private", created_at: "2026-10-30T00:00:00Z", updated_at: "2026-10-30T00:00:00Z", ...values,
});
const items = () => [
  make("book", { title: "A design book", tags: ["Design"] }),
  make("one", { title: "A code video", kind: "video", author: "Channel One", tags: ["Code"], url: "https://www.youtube.com/watch?v=NBCM_ZoWZo8" }),
  make("two", { title: "Another code video", kind: "video", author: "Channel Two", tags: ["Code"], url: "https://youtu.be/AAAAAAAAAAA" }),
  make("article", { title: "A design article", kind: "article", tags: ["Design", "Code"] }),
  make("done", { title: "A finished video", kind: "video", author: "Channel One", url: "https://youtu.be/BBBBBBBBBBB", status: "done" }),
];
async function open(page: Page, group: string) {
  await page.locator(`#library-filter-${group}`).click();
  return page.locator(".library-filter-panel");
}
async function close(page: Page) { await page.locator(".library-filter-panel").getByRole("button", { name: "Done", exact: true }).click(); }
const rows = (page: Page) => page.locator(".media-row");

test("empty channel controls stay out of the toolbar without trapping filter shortcuts", async ({ page }) => {
  await fixture(page, [make("book", {})]);
  await page.goto("http://margin.test/app");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator("#library-filter-channels")).toHaveCount(0);
  await page.locator("main").focus();
  await page.keyboard.press("f"); await page.keyboard.press("c");
  await expect(page.locator(".library-filter-panel")).toHaveCount(0);
  await page.keyboard.press("]");
  await expect(page.locator(".list-tabs").getByRole("button", { name: "Done", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("an active channel remains clearable after its last option disappears", async ({ page }) => {
  const f = await fixture(page, [items()[1]]);
  await page.goto("http://margin.test/app");
  const panel = await open(page, "channels");
  await panel.getByRole("checkbox", { name: "Channel One", exact: true }).check();
  await close(page);
  f.enrichMedia("one", { author: "" });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator("#library-filter-channels")).toBeVisible();
  await page.getByRole("button", { name: "Remove channel filter channel one", exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator("#library-filter-channels")).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Search library", exact: true })).toBeFocused();
});

test("a disappearing empty channel picker restores focus and keyboard shortcuts", async ({ page }) => {
  const f = await fixture(page, [items()[1]]);
  await page.goto("http://margin.test/app");
  await open(page, "channels");
  f.enrichMedia("one", { author: "" });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".library-filter-panel")).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Search library", exact: true })).toBeFocused();
  await page.locator("main").focus();
  await page.keyboard.press("]");
  await expect(page.locator(".list-tabs").getByRole("button", { name: "Done", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("types and tags compose with OR inside each group and retain selections across views", async ({ page }) => {
  await fixture(page, items());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await expect(rows(page)).toHaveCount(4);
  let panel = await open(page, "types");
  await panel.getByRole("checkbox", { name: "Book", exact: true }).check();
  await expect(rows(page)).toHaveCount(1);
  await panel.getByRole("checkbox", { name: "Video", exact: true }).check();
  await expect(rows(page)).toHaveCount(3);
  await close(page);
  await expect(page.locator("#library-filter-types")).toBeFocused();
  panel = await open(page, "tags");
  await panel.getByRole("checkbox", { name: "Design", exact: true }).check();
  await expect(rows(page)).toHaveCount(1);
  await panel.getByRole("checkbox", { name: "Code", exact: true }).check();
  await expect(rows(page)).toHaveCount(3);
  await close(page);
  await page.locator("main").focus();
  await page.keyboard.press("v"); await page.keyboard.press("l");
  await expect(page.locator(".media-list")).toHaveAttribute("data-layout", "list");
  await expect(page.locator(".list-tabs > button").first()).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(3);
  await page.keyboard.press("v"); await page.keyboard.press("g");
  await expect(page.locator(".media-list")).toHaveAttribute("data-layout", "shelves");
  await page.getByRole("button", { name: "Remove tag filter Code", exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator("#library-filter-tags")).toBeFocused();
  await page.getByRole("button", { name: "Clear selections", exact: true }).click();
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByRole("searchbox", { name: "Search library", exact: true })).toBeFocused();
});

test("filter shortcuts focus searchable multi-selects and leave typing and status alone", async ({ page }) => {
  await fixture(page, items());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  for (const [key, group] of [["t", "types"], ["g", "tags"], ["c", "channels"]]) {
    await page.locator("main").focus();
    await page.keyboard.press("f"); await page.keyboard.press(key);
    const search = page.getByRole("searchbox", { name: `Search ${group}`, exact: true });
    await expect(search).toBeFocused();
    await search.fill("hlggvlfc");
    await expect(search).toHaveValue("hlggvlfc");
    await expect(page.locator(".media-list")).toHaveAttribute("data-layout", "split");
    await page.keyboard.press("Escape");
    await expect(page.locator(`#library-filter-${group}`)).toBeFocused();
  }
  const search = page.getByRole("searchbox", { name: "Search library", exact: true });
  await search.fill("vlfc");
  await expect(page.locator(".library-filter-panel")).toHaveCount(0);
  await expect(page.locator(".list-tabs > button").first()).toHaveAttribute("aria-pressed", "true");
  await search.fill("");
  await page.locator("main").focus();
  await page.keyboard.press("j"); await expect(rows(page).first()).toBeFocused();
});

test("Enter selects the first search match in every filter without closing or toggling it off", async ({ page }) => {
  await fixture(page, items());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  for (const [group, query, first] of [["types", "book", "Book"], ["tags", "e", "Code"], ["channels", "channel", "Channel One"]]) {
    const panel = await open(page, group);
    const search = panel.getByRole("searchbox", { name: `Search ${group}`, exact: true });
    await search.fill(query);
    await search.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
    await expect(panel.getByRole("checkbox", { name: first, exact: true })).not.toBeChecked();
    await search.press("Enter");
    await expect(panel.getByRole("checkbox", { name: first, exact: true })).toBeChecked();
    await expect(panel.getByRole("checkbox").first()).toHaveAccessibleName(first);
    await expect(panel.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(1);
    await expect(search).toBeFocused();
    await search.press("Enter");
    await expect(panel.getByRole("checkbox", { name: first, exact: true })).toBeChecked();
    await search.fill("no matching filter");
    await search.press("Enter");
    await expect(panel).toBeVisible();
    await search.fill(query);
    await expect(panel.getByRole("checkbox", { name: first, exact: true })).toBeChecked();
    await panel.getByRole("button", { name: `Clear ${group}`, exact: true }).click();
    await close(page);
  }
  await expect(rows(page)).toHaveCount(4);
});

test("clickable YouTube names filter without opening the video and allow several channels", async ({ page }) => {
  await fixture(page, items());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Filter channel Channel One", exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(page).toHaveURL(/\/dashboard\?test=\d+#library$/);
  expect(page.context().pages()).toHaveLength(1);
  const panel = await open(page, "channels");
  await panel.getByRole("checkbox", { name: "Channel Two", exact: true }).check();
  await expect(rows(page)).toHaveCount(2);
  await panel.getByRole("button", { name: "Clear channels", exact: true }).click();
  await expect(rows(page)).toHaveCount(4);
  await close(page);
});

test("book lookup can retry an empty result and explicitly select the recovered edition", async ({ page }) => {
  const controls = await fixture(page, items());
  let lookups = 0;
  await page.route("**/api/books/search", route => {
    lookups++;
    expect(route.request().postDataJSON().query).toBe("Designing data intensive applications");
    return route.fulfill({ json: { items: lookups === 1 ? [] : [{ title: "Designing Data-Intensive Applications", author: "Martin Kleppmann", kind: "book", url: "https://openlibrary.org/books/OL48030878M", cover_url: "https://images.test/book.svg" }] } });
  });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  const editor = page.locator(".editor-modal");
  await editor.getByRole("textbox", { name: "Title or URL", exact: true }).fill("Designing data intensive applications");
  await editor.getByRole("combobox", { name: "Type", exact: true }).click();
  await page.getByRole("option", { name: "Book", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Retry book lookup", exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Retry book lookup", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Book title, author, or ISBN", exact: true })).toBeFocused();
  await editor.getByRole("radio").first().check();
  await expect(editor.getByRole("textbox", { name: "Creator (optional)", exact: true })).toHaveValue("Martin Kleppmann");
  await editor.getByRole("button", { name: "Add to library", exact: true }).click();
  await expect.poll(() => controls.requests.mediaWrites.length).toBe(1);
  expect(controls.requests.mediaWrites[0]).toMatchObject({ title: "Designing Data-Intensive Applications", author: "Martin Kleppmann", kind: "book", url: "https://openlibrary.org/books/OL48030878M" });
});

test("filter controls and popup fit both themes at phone and desktop widths", async ({ page }) => {
  await fixture(page, items());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mkdir("../.local/filter-capture-2026-10-31", { recursive: true });
  for (const width of [320, 390, 900, 1440]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: 950 });
    await page.addInitScript(value => localStorage.setItem("margin-theme", value), theme);
    await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
    const panel = await open(page, "types");
    await panel.getByRole("checkbox", { name: "Book", exact: true }).check();
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of await page.locator(".library-filter-trigger").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if (width === 320 || width === 1440) await page.screenshot({ path: `../.local/filter-capture-2026-10-31/filters-${width}-${theme}.png`, fullPage: true });
  }
});


test("filter search and actions remain reachable on a short phone viewport", async ({ page }) => {
  await fixture(page, items());
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  const panel = await open(page, "types");
  const box = (await panel.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(568);
  await panel.getByRole("searchbox").fill("Video");
  await expect(panel.getByRole("checkbox")).toHaveCount(1);
  await panel.getByRole("checkbox", { name: "Video", exact: true }).check();
  await close(page);
  await expect(rows(page)).toHaveCount(2);
});
