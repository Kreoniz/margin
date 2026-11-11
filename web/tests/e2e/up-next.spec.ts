import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./synthetic-fixture";
import type { LibraryData, Media } from "../../src/types";

const media: Media[] = ["book", "video", "game"].map((kind, index) => ({
  id: kind, title: "Chosen " + kind, kind: kind as Media["kind"], status: "pending", author: "Synthetic author", url: "https://example.com/" + kind,
  cover_url: "https://images.test/" + (kind === "book" ? "book.svg" : "wide.svg"), description: "", notes: "", tags: ["selected"], visibility: "private", created_at: `2026-10-${30-index}T00:00:00Z`, updated_at: "2026-10-30T00:00:00Z",
}));
test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "reduce" }); });

const rows = (page: Page) => page.locator(".media-row");
const row = (page: Page, id: string) => page.locator(`[data-row-id="${id}"]`);
const tab = (page: Page) => page.locator(".list-tabs").getByRole("button", { name: "Up next", exact: true });
async function actions(page: Page, id: string) {
  await row(page, id).locator(".priority-trigger").click();
  return page.locator(".priority-panel");
}
async function list(page: Page) { await page.getByRole("button", { name: "List view", exact: true }).click(); }

test("default Library keeps compact layouts; Up next is a secondary empty filter and explicit choice", async ({ page }) => {
  await fixture(page, media);
  await page.goto("http://margin.test/app");
  await expect(page.getByRole("heading", { name: "Your library." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mixed view", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Up next", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Move earlier", exact: true })).toHaveCount(0);
  await tab(page).click();
  await expect(page.getByRole("heading", { name: "Nothing in Up next yet." })).toBeVisible();
  expect((await page.locator(".priority-empty").boundingBox())!.height).toBeLessThan(180);
  await page.getByRole("button", { name: "Show unfinished", exact: true }).click();
  for (const id of ["game", "book", "video"]) {
    const panel = await actions(page, id);
    await panel.getByRole("button", { name: "Add to Up next", exact: true }).click();
    await expect(row(page, id).locator(".priority-membership")).toContainText("Up next · #");
  }
  await tab(page).click();
  for (const label of ["Mixed", "Shelves", "List"]) {
    await page.getByRole("button", { name: label + " view", exact: true }).click();
    await expect(rows(page)).toHaveCount(3);
    await expect(row(page, "game").locator(".priority-membership")).toHaveText("Up next · #1");
    await expect(row(page, "book").locator(".priority-membership")).toHaveText("Up next · #2");
  }
  await expect(rows(page).locator(".item-title")).toHaveText(["Chosen game", "Chosen book", "Chosen video"]);
  const art = row(page, "book").locator(".mini-cover img").first();
  await expect(art).toBeVisible(); await expect(art).toHaveCSS("object-fit", "contain");
  const artwork = (await art.boundingBox())!, content = (await row(page, "book").locator(".row-content").boundingBox())!;
  expect(artwork.y).toBeLessThan(content.y + content.height); expect(content.y).toBeLessThan(artwork.y + artwork.height);
  await expect(page.locator("#library-filter-types")).toHaveAccessibleName("All types, filter types");
  await expect(page.locator("#library-filter-tags")).toHaveAccessibleName("All tags, filter tags");
  await page.reload();
  await expect(tab(page)).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page).locator(".item-title")).toHaveText(["Chosen game", "Chosen book", "Chosen video"]);
  for (const hash of ["", "#unknown"]) {
    await page.goto("http://margin.test/app?fresh=" + Date.now() + hash);
    await expect(page.locator(".list-tabs").getByRole("button", { name: "Unfinished", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "List view", exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await page.keyboard.press("g"); await page.keyboard.press("n"); await expect(tab(page)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Margin library", exact: true }).click();
  await expect(tab(page)).toHaveAttribute("aria-pressed", "false");
});

test("first-run opens the Library empty state, not a priority dashboard", async ({ page }) => {
  await fixture(page, []); await page.goto("http://margin.test/app");
  await expect(page.getByRole("heading", { name: "Your library." })).toBeVisible();
  await expect(page.locator(".priority-empty")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add item", exact: true }).first()).toBeVisible();
});

test("native keyboard moves retain row focus; Escape restores trigger and removal keeps the saved item", async ({ page }) => {
  const f = await fixture(page, media); f.queue(["book", "video", "game"]);
  await page.goto("http://margin.test/app#next"); await list(page);
  await actions(page, "book"); await page.keyboard.press("Escape");
  await expect(row(page, "book").locator(".priority-trigger")).toBeFocused();
  let panel = await actions(page, "book");
  await panel.getByRole("button", { name: "Move later", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(rows(page).locator(".item-title")).toHaveText(["Chosen video", "Chosen book", "Chosen game"]);
  await expect(row(page, "book")).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Chosen book moved. Position 2 of 3." })).toBeVisible();
  panel = await actions(page, "book");
  await panel.getByRole("button", { name: "Remove from Up next", exact: true }).focus(); await page.keyboard.press("Space");
  await expect(rows(page).locator(".item-title")).toHaveText(["Chosen video", "Chosen game"]);
  await expect(row(page, "game")).toBeFocused();
  await page.locator(".list-tabs").getByRole("button", { name: "Unfinished", exact: true }).click();
  panel = await actions(page, "book"); await expect(panel.getByRole("button", { name: "Add to Up next", exact: true })).toBeEnabled();
});

test("grouped layouts keep truthful global ranks and move across types; filters disable ambiguous moves", async ({ page }) => {
  const f = await fixture(page, media); f.queue(["game", "book", "video"]);
  await page.goto("http://margin.test/app#next");
  let panel = await actions(page, "book");
  await expect(panel).toContainText("Position 2 of 3 across your library");
  await panel.getByRole("button", { name: "Move earlier", exact: true }).click();
  await expect(row(page, "book").locator(".priority-membership")).toHaveText("Up next · #1");
  await expect(row(page, "game").locator(".priority-membership")).toHaveText("Up next · #2");
  await page.getByRole("searchbox", { name: "Search library" }).fill("Chosen");
  panel = await actions(page, "game");
  await expect(panel.getByRole("button", { name: "Move later", exact: true })).toBeDisabled();
  await expect(panel).toContainText("Clear search and filters to reorder.");
  await page.keyboard.press("Escape");
  await expect(page.locator(".priority-context")).toContainText("Reordering is disabled");
  await page.getByRole("searchbox", { name: "Search library" }).fill("absent");
  await expect(page.getByRole("heading", { name: "No Up next items match." })).toBeVisible();
  await page.locator(".priority-empty").getByRole("button", { name: "Clear filters" }).click();
  await expect(rows(page)).toHaveCount(3);
});

test("failed writes keep order, stale writes show latest order and Done undo does not reprioritize", async ({ page }) => {
  const f = await fixture(page, media); f.queue(["book", "video", "game"]);
  await page.goto("http://margin.test/app#next"); await list(page);
  f.failQueue();
  await (await actions(page, "book")).getByRole("button", { name: "Move later", exact: true }).click();
  await expect(page.getByText("Synthetic queue unavailable", { exact: true }).first()).toBeVisible();
  await expect(rows(page).locator(".item-title")).toHaveText(["Chosen book", "Chosen video", "Chosen game"]);
  f.failQueue(false); f.conflictQueue();
  await (await actions(page, "book")).getByRole("button", { name: "Move later", exact: true }).click();
  await expect(rows(page).locator(".item-title")).toHaveText(["Chosen game", "Chosen video", "Chosen book"]);
  await expect(page.getByText(/Up next changed in another tab/).first()).toBeVisible();
  await page.getByRole("checkbox", { name: "Mark done: Chosen video", exact: true }).click();
  await expect(rows(page).locator(".item-title")).toHaveText(["Chosen game", "Chosen book"]);
  await expect(page.getByText("Marked done. Undo returns to unfinished without restoring Up next.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(rows(page).locator(".item-title")).toHaveText(["Chosen game", "Chosen book"]);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Library", exact: true }).click();
  await expect((await actions(page, "video")).getByRole("button", { name: "Add to Up next", exact: true })).toBeEnabled();
});

test("last removal focuses content and a delayed removal never takes focus from search", async ({ page }) => {
  const f = await fixture(page, media); f.queue(["book"]);
  await page.goto("http://margin.test/app#next");
  await (await actions(page, "book")).getByRole("button", { name: "Remove from Up next", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Nothing in Up next yet." })).toBeVisible();
  await expect(page.locator("#content")).toBeFocused();
  f.queue(["book"]); await page.reload();
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/up-next", async route => { await gate; await route.fallback(); });
  await (await actions(page, "book")).getByRole("button", { name: "Remove from Up next", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search library" }); await search.focus(); release();
  await expect(rows(page)).toHaveCount(0); await expect(search).toBeFocused();
});

test("priority actions fit 320px and are reachable without pointer hover in every layout", async ({ page }) => {
  const f = await fixture(page, media); f.queue(["game", "book", "video"]);
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto("http://margin.test/app#next");
  for (const label of ["Mixed", "Shelves", "List"]) {
    await page.getByRole("button", { name: label + " view", exact: true }).click();
    const trigger = row(page, "book").locator(".priority-trigger");
    await expect(page.getByRole("button", { name: "Books 1, jump to Books & manga", exact: true })).toHaveCount(label === "List" ? 0 : 1);
    const box = (await trigger.boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    await trigger.focus(); await page.keyboard.press("Enter");
    const panel = page.locator(".priority-panel");
    const bounds = (await panel.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(568);
    for (const button of await panel.getByRole("button").all()) {
      await button.scrollIntoViewIfNeeded();
      const target = (await button.boundingBox())!;
      expect(Math.round(target.height)).toBeGreaterThanOrEqual(44);
      expect(target.y).toBeGreaterThanOrEqual(0); expect(target.y + target.height).toBeLessThanOrEqual(568);
    }
    await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  }
});

test("delete from contextual actions cleans up membership and restores focus after cancellation", async ({ page }) => {
  const f = await fixture(page, media); f.queue(["book", "game"]);
  await page.goto("http://margin.test/app#next");
  await (await actions(page, "book")).getByRole("button", { name: "Remove from library…", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Remove from library?", exact: true });
  await confirmation.getByRole("button", { name: "Keep it", exact: true }).click();
  await expect(row(page, "book")).toBeFocused();
  await (await actions(page, "book")).getByRole("button", { name: "Remove from library…", exact: true }).click();
  await confirmation.getByRole("button", { name: "Remove item", exact: true }).click();
  await expect(row(page, "book")).toHaveCount(0); await expect(row(page, "game")).toBeFocused();
});

test("attention and hidden automatic subsets cannot reorder unseen queue neighbors", async ({ page }) => {
  const f = await fixture(page, media.map(item => ({ ...item, needs_review: item.id === "book", auto_added: item.id === "game" })));
  f.queue(["game", "book", "video"]);
  await page.addInitScript(() => localStorage.setItem("margin-hide-auto-added", "on"));
  await page.goto("http://margin.test/app");
  let panel = await actions(page, "book");
  await expect(panel.getByRole("button", { name: "Move earlier", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Show Up next", exact: true }).click();
  await expect(rows(page)).toHaveCount(3);
  panel = await actions(page, "book");
  await expect(panel.getByRole("button", { name: "Move earlier", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.locator(".list-tabs").getByRole("button", { name: "Needs attention (1)", exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  panel = await actions(page, "book");
  await expect(panel.getByRole("button", { name: "Move earlier", exact: true })).toBeDisabled();
});

test("Quick Find reaches unqueued items and returns to the priority filter", async ({ page }) => {
  const f = await fixture(page, media); f.queue(["book"]);
  await page.goto("http://margin.test/app#next");
  await page.getByRole("button", { name: "Quick Find", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Quick Find", exact: true });
  await dialog.getByRole("combobox", { name: "Search all saved items", exact: true }).fill("Chosen game");
  await expect(dialog.getByRole("option")).toContainText("Chosen game");
  await page.keyboard.press("Escape");
  await expect(tab(page)).toHaveAttribute("aria-pressed", "true"); await expect(rows(page)).toHaveCount(1);
});

for (const conflict of [false, true]) test(`delayed ${conflict ? "conflict" : "successful"} queue response cannot replace a newer completion snapshot`, async ({ page }) => {
  const f = await fixture(page, media); f.queue(["book", "video", "game"]);
  await page.goto("http://margin.test/app#next"); await list(page);
  f.holdQueueAck(); if (conflict) f.conflictQueue();
  await (await actions(page, "video")).getByRole("button", { name: "Move earlier", exact: true }).click();
  await expect.poll(() => f.requests.queueCommits).toBe(1);
  const completed = conflict ? "game" : "book";
  await row(page, completed).getByRole("checkbox").click();
  await expect(page.getByText("Marked done. Undo returns to unfinished without restoring Up next.", { exact: true })).toBeVisible();
  const remaining = conflict ? ["video", "book"] : ["video", "game"];
  for (const [index, id] of remaining.entries()) await expect(row(page, id).locator(".priority-membership")).toHaveText(`Up next · #${index + 1}`);
  f.failBootstrap(); f.releaseQueueAck();
  await expect(page.getByText("Synthetic bootstrap unavailable", { exact: false }).first()).toBeVisible();
  await expect(row(page, completed)).toHaveCount(0);
  for (const [index, id] of remaining.entries()) await expect(row(page, id).locator(".priority-membership")).toHaveText(`Up next · #${index + 1}`);
});

for (const removal of ["done and undo", "delete"]) test(`delayed queue response cannot undo local ${removal} when refreshes fail`, async ({ page }) => {
  const f = await fixture(page, media); f.queue(["book", "video", "game"]);
  await page.goto("http://margin.test/app#next"); await list(page);
  f.holdQueueAck();
  await (await actions(page, "video")).getByRole("button", { name: "Move earlier", exact: true }).click();
  await expect.poll(() => f.requests.queueCommits).toBe(1);
  f.failBootstrap();
  if (removal === "delete") {
    await (await actions(page, "book")).getByRole("button", { name: "Remove from library…", exact: true }).click();
    await page.getByRole("dialog", { name: "Remove from library?", exact: true }).getByRole("button", { name: "Remove item", exact: true }).click();
  } else {
    await row(page, "book").getByRole("checkbox").click();
    await expect(page.getByText("Marked done. Undo returns to unfinished without restoring Up next.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => f.requests.mediaPatches).toBe(2);
  }
  await expect(row(page, "book")).toHaveCount(0);
  const bootstraps = f.requests.bootstrap;
  f.releaseQueueAck();
  await expect.poll(() => f.requests.bootstrap).toBeGreaterThan(bootstraps);
  await expect(page.getByText("Synthetic bootstrap unavailable", { exact: false }).first()).toBeVisible();
  await expect(row(page, "book")).toHaveCount(0);
  await expect(row(page, "game").locator(".priority-membership")).toHaveText("Up next · #2");
});

for (const newerTime of ["2026-11-07T10:02:00Z", "2026-11-07T10:01:00.000002Z"]) test(`an older Done response cannot erase restored priority (${newerTime})`, async ({ page }) => {
  const f = await fixture(page, media); f.queue(["book", "video", "game"]);
  let snapshot: LibraryData | undefined;
  let failRefresh = false;
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const done: Media = { ...media[0], status: "done", updated_at: "2026-11-07T10:01:00.000001Z" };
  await page.route("**/api/bootstrap", async route => {
    if (failRefresh) return route.fulfill({ status: 503, json: { error: "Synthetic bootstrap unavailable" } });
    return snapshot ? route.fulfill({ json: snapshot }) : route.fallback();
  });
  await page.route("**/api/media/book", async route => {
    snapshot = { media: [done, ...media.slice(1)], up_next: { version: 2, ids: ["video", "game"] }, inbox: [], inbox_counts: { new: 0, saved: 0, read: 0, dismissed: 0 }, sources: [], legacy_sample_count: 0 };
    await gate;
    await route.fulfill({ json: done });
  });
  await page.goto("http://margin.test/app#next"); await list(page);
  await row(page, "book").getByRole("checkbox").click();
  await expect.poll(() => snapshot?.up_next?.version).toBe(2);
  // Another owner returns the item to unfinished and deliberately appends it.
  snapshot = { ...snapshot!, media: [{ ...media[0], updated_at: newerTime }, ...media.slice(1)], up_next: { version: 3, ids: ["video", "game", "book"] } };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(row(page, "book").locator(".priority-membership")).toHaveText("Up next · #3");
  failRefresh = true; release();
  await expect(page.getByText("Synthetic bootstrap unavailable", { exact: false }).first()).toBeVisible();
  await expect(row(page, "book").locator(".priority-membership")).toHaveText("Up next · #3");
  await expect(row(page, "book").getByRole("checkbox")).not.toBeChecked();
  await expect(page.getByText("Marked done. Undo returns to unfinished without restoring Up next.", { exact: true })).toHaveCount(0);
});
