import { test, expect, type Page } from "@playwright/test";
import type { Media } from "../../src/types";
import { fixture } from "./synthetic-fixture";

const make = (id: string, values: Partial<Media> = {}): Media => ({
  id, title: id, kind: "book", author: "Synthetic writer", url: "", cover_url: "", description: "", notes: "", tags: [],
  status: "pending", visibility: "private", created_at: "2026-10-30T00:00:00Z", updated_at: "2026-10-30T00:00:00Z", ...values,
});
const items = () => [
  make("working", { title: "Working book", tags: ["Work"], notes: "Working library query" }),
  make("other", { title: "Other book" }),
  make("done", { title: "A finished source", status: "done", kind: "paper", tags: ["Research"], notes: "uniquenoteterm private body", description: "Synthetic summaryterm", selected_text: "Private excerptterm", selected_text_source_url: "https://example.com/paper.pdf#page=12", url: "https://example.com/paper.pdf#page=12" }),
  make("automatic", { title: "Hidden automatic source", auto_added: true, notes: "uniquenoteterm hidden body", url: "https://example.org/automatic#section" }),
  make("title-only", { title: "A title-only thought", notes: "titlenoteterm" }),
];
const quickFind = (page: Page) => page.getByRole("dialog", { name: "Quick Find", exact: true });
const query = (page: Page) => quickFind(page).getByRole("combobox", { name: "Search all saved items", exact: true });
const editor = (page: Page) => page.locator(".editor-modal");
const draft = (page: Page) => page.getByRole("region", { name: "Unfinished draft", exact: true });
async function primaryKey(page: Page, key: string) {
  return await page.evaluate(() => (navigator.platform + navigator.userAgent).toLowerCase().includes("mac") ? "Meta" : "Control") + "+" + key;
}
async function setup(page: Page, media = items()) {
  const controls = await fixture(page, media);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("margin-hide-auto-added", "on");
    const state = window as Window & { opened: unknown[][]; copied: string[] };
    state.opened = []; state.copied = [];
    window.open = (...args: Parameters<typeof window.open>) => { state.opened.push(args); return null; };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value: string) => { state.copied.push(value); },
    } });
  });
  await page.goto("http://margin.test/dashboard");
  await expect(page.getByRole("heading", { name: "Your library." })).toBeVisible();
  return controls;
}
async function selectFilter(page: Page, group: string, label: string) {
  await page.getByRole("button", { name: `Filter ${group}`, exact: true }).click();
  await page.locator(".library-filter-panel").getByRole("checkbox", { name: label, exact: true }).check();
  await page.locator(".library-filter-panel").getByRole("button", { name: "Done", exact: true }).click();
}

test("Quick Find ignores scoped Pending/type/tag/hide-auto filters and retains the stored fragment", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await selectFilter(page, "types", "Book");
  await selectFilter(page, "tags", "Work");
  const scoped = page.getByRole("searchbox", { name: "Search library", exact: true });
  await scoped.fill("Working library");
  await expect(page.locator(".media-row")).toHaveCount(1);
  await scoped.press(await primaryKey(page, "k"));
  await expect(query(page)).toBeFocused();
  await query(page).fill("uniquenoteterm");
  await expect(quickFind(page).getByRole("option")).toHaveCount(2);
  await expect(quickFind(page).getByRole("option").first()).toContainText("A finished source");
  await expect(quickFind(page)).not.toContainText("private body");
  await query(page).press("ArrowDown");
  await expect(quickFind(page).getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  await query(page).press("ArrowUp");
  await query(page).press("Enter");
  await expect(quickFind(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { opened: unknown[][] }).opened)).toEqual([
    ["https://example.com/paper.pdf#page=12", "_blank", "noopener,noreferrer"],
  ]);
  await expect(scoped).toBeFocused();
  await expect(scoped).toHaveValue("Working library");
  await expect(page.locator(".media-list")).toHaveAttribute("data-layout", "list");
  await expect(page.getByRole("button", { name: "Remove type filter Book", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove tag filter Work", exact: true })).toBeVisible();
  await expect(page.locator(".list-tabs > button").first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".media-row")).toHaveCount(1);
});

test("Library and Discover keep independent working contexts through Quick Find, navigation and saves", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Shelves view", exact: true }).click();
  await selectFilter(page, "types", "Paper");
  await page.locator(".list-tabs > button").filter({ hasText: /^Done$/ }).click();
  await page.getByRole("searchbox", { name: "Search library" }).fill("finished");
  await page.getByRole("button", { name: /^Discover/ }).click();
  const source = page.getByRole("combobox", { name: "Filter source", exact: true });
  await source.click(); await page.getByRole("option", { name: "OpenAI", exact: true }).click();
  await page.locator(".list-tabs > button").filter({ hasText: /^Read$/ }).click();
  const scoped = page.getByRole("searchbox", { name: "Search discoveries" });
  await scoped.fill("useful article 5");
  await page.getByRole("button", { name: "Quick Find", exact: true }).click();
  await query(page).fill("uniquenoteterm");
  await expect(quickFind(page).getByRole("option")).toHaveCount(2);
  await query(page).fill("A useful article");
  await expect(quickFind(page).getByRole("option")).toHaveCount(0);
  await query(page).press("Escape");
  await expect(page.getByRole("button", { name: "Quick Find", exact: true })).toBeFocused();
  await expect(scoped).toHaveValue("useful article 5");
  await expect(source).toContainText("OpenAI");
  await expect(page.locator(".list-tabs > button").filter({ hasText: /^Read$/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search library" })).toHaveValue("finished");
  await expect(page.getByRole("button", { name: "Remove type filter Paper", exact: true })).toBeVisible();
  await expect(page.locator(".media-list")).toHaveAttribute("data-layout", "shelves");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await editor(page).getByRole("textbox", { name: "Title or URL", exact: true }).fill("Outside this working set");
  await page.keyboard.press(await primaryKey(page, "Enter"));
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Search library" })).toHaveValue("finished");
  await expect(page.locator(".list-tabs > button").filter({ hasText: /^Done$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Remove type filter Paper", exact: true })).toBeVisible();
  await expect(page.locator(".media-row")).toHaveCount(1);
  await page.locator(".u-toast").getByRole("button", { name: "Edit item", exact: true }).click();
  await expect(editor(page).getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Outside this working set");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Discover/ }).click();
  await expect(scoped).toHaveValue("useful article 5");
  await expect(source).toContainText("OpenAI");
  await expect(page.locator(".list-tabs > button").filter({ hasText: /^Read$/ })).toHaveAttribute("aria-pressed", "true");
});

test("title-only fallback, copy and edit are accessible and empty results cannot activate an old match", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Quick Find", exact: true }).click();
  await query(page).fill("uniquenoteterm");
  await query(page).press("Tab");
  await expect(quickFind(page).getByRole("button", { name: "Copy original URL" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(quickFind(page).getByRole("status").last()).toHaveText("Original URL copied.");
  expect(await page.evaluate(() => (window as Window & { copied: string[] }).copied)).toEqual(["https://example.com/paper.pdf#page=12"]);
  await query(page).fill("no such saved item");
  await expect(quickFind(page).getByRole("option")).toHaveCount(0);
  await expect(query(page)).not.toHaveAttribute("aria-activedescendant");
  await query(page).press("Enter");
  await expect(quickFind(page)).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { opened: unknown[][] }).opened)).toHaveLength(0);
  await query(page).fill("titlenoteterm");
  await expect(quickFind(page).getByRole("button", { name: "Copy original URL" })).toHaveCount(0);
  await query(page).dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(quickFind(page)).toBeVisible();
  await query(page).press("Enter");
  await expect(quickFind(page)).toHaveCount(0);
  await expect(editor(page).getByRole("textbox", { name: "Title", exact: true })).toHaveValue("A title-only thought");
  await page.keyboard.press(await primaryKey(page, "k"));
  await expect(quickFind(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator('.media-row[tabindex="0"]')).toBeFocused();
});

test("Quick Find reuses saved-field matching and scoped slash search stays separate", async ({ page }) => {
  await setup(page);
  await page.locator("main").focus();
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Search library" })).toBeFocused();
  await expect(quickFind(page)).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search library" }).fill("scoped query stays here");
  await page.getByRole("button", { name: "Quick Find", exact: true }).click();
  for (const term of ["finished", "Synthetic writer Research", "example.com", "summaryterm", "uniquenoteterm Research", "excerptterm"]) {
    await query(page).fill(term);
    await expect(quickFind(page).getByRole("option")).toHaveCount(1);
    await expect(quickFind(page).getByRole("option")).toContainText("A finished source");
  }
  await expect(quickFind(page)).not.toContainText("Private excerptterm");
  await quickFind(page).getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.getByRole("button", { name: "Quick Find", exact: true })).toBeFocused();
  await expect(page.getByRole("searchbox", { name: "Search library" })).toHaveValue("scoped query stays here");
});

test("bounded results expose further matches and the overlay fits a narrow viewport", async ({ page }) => {
  await setup(page, Array.from({ length: 43 }, (_, index) => make(`saved-${index}`, { title: `Saved title ${index}` })));
  await page.setViewportSize({ width: 320, height: 812 });
  await page.getByRole("button", { name: "Quick Find", exact: true }).click();
  await expect(query(page)).toBeFocused();
  await expect(quickFind(page).getByRole("option")).toHaveCount(20);
  await quickFind(page).getByRole("button", { name: "Show more", exact: true }).click();
  await expect(quickFind(page).getByRole("option")).toHaveCount(40);
  await expect(query(page)).toBeFocused();
  await quickFind(page).getByRole("button", { name: "Show more", exact: true }).click();
  await expect(quickFind(page).getByRole("option")).toHaveCount(43);
  await expect(quickFind(page).getByRole("button", { name: "Show more", exact: true })).toHaveCount(0);
  await expect(query(page)).toBeFocused();
  const bounds = await quickFind(page).boundingBox();
  expect(bounds).toBeTruthy(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  expect(await quickFind(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await query(page).press("Tab");
  await expect(quickFind(page).getByRole("button", { name: "Edit item", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editor(page).getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Saved title 40");
});

test("Quick Find excludes recorded fixtures without hiding same-named real items from Library", async ({ page }) => {
  const media = [make("recorded-fixture", { title: "Shared title" }), make("real-item", { title: "Shared title" })];
  await fixture(page, media);
  await page.route("**/api/bootstrap", route => route.fulfill({ json: {
    media, inbox: [], sources: [], inbox_counts: { new: 0, read: 0, saved: 0, dismissed: 0 },
    legacy_sample_count: 0, dev_fixture_ids: ["recorded-fixture"],
  } }));
  await page.goto("http://margin.test/dashboard");
  await expect(page.getByRole("button", { name: "Edit Shared title", exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Quick Find", exact: true }).click();
  await query(page).fill("Shared title");
  await expect(quickFind(page).getByRole("option")).toHaveCount(1);
});

test("dismissed drafts remain explicit and never restore into another item's editor", async ({ page }) => {
  const controls = await setup(page);
  await page.getByRole("button", { name: "Edit Working book", exact: true }).click();
  await editor(page).getByRole("textbox", { name: "Title", exact: true }).fill("Unfinished first title");
  await editor(page).getByText("Details, image & note", { exact: true }).click();
  await editor(page).getByRole("textbox", { name: "Private note", exact: true }).fill("Private in-memory draft");
  await page.keyboard.press("Escape");
  await expect(draft(page)).toBeVisible();
  await draft(page).getByRole("button", { name: "Resume draft", exact: true }).click();
  await expect(editor(page).getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Unfinished first title");
  await expect(editor(page).getByRole("textbox", { name: "Private note", exact: true })).toHaveValue("Private in-memory draft");
  await editor(page).getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(draft(page)).toBeVisible();
  await page.getByRole("button", { name: "Edit Other book", exact: true }).click();
  const choice = page.getByRole("dialog", { name: "Unfinished draft", exact: true });
  await expect(choice).toBeVisible(); await expect(editor(page)).toHaveCount(0);
  await choice.getByRole("button", { name: "Keep draft", exact: true }).click();
  await expect(choice).toHaveCount(0); await expect(draft(page)).toBeVisible();
  await page.getByRole("button", { name: "Quick Find", exact: true }).click();
  await query(page).fill("Other book");
  await query(page).press("Enter");
  await choice.getByRole("button", { name: "Discard draft and continue", exact: true }).click();
  await expect(editor(page).getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Other book");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0); await expect(draft(page)).toHaveCount(0);
  expect(controls.requests.mediaWrites).toHaveLength(0);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("Private in-memory draft");
});

test("new drafts can resume after navigation; save and explicit discard clear the retained draft", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await editor(page).getByRole("textbox", { name: "Title or URL", exact: true }).fill("Unfinished capture");
  await page.mouse.click(1, 1);
  await expect(draft(page)).toBeVisible();
  await page.getByRole("button", { name: /^Discover/ }).click();
  await draft(page).getByRole("button", { name: "Resume draft", exact: true }).click();
  await expect(editor(page).getByRole("textbox", { name: "Title or URL", exact: true })).toHaveValue("Unfinished capture");
  await page.keyboard.press(await primaryKey(page, "Enter"));
  await expect(editor(page)).toHaveCount(0); await expect(draft(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Discover." })).toBeVisible();
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await editor(page).getByRole("textbox", { name: "Title or URL", exact: true }).fill("Another capture");
  await page.keyboard.press("Escape");
  await draft(page).getByRole("button", { name: "Discard draft", exact: true }).click();
  await expect(draft(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(editor(page).getByRole("textbox", { name: "Title or URL", exact: true })).toHaveValue("");
});
