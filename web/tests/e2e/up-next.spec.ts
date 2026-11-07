import { expect, test } from "@playwright/test";
import { fixture } from "./synthetic-fixture";
import type { Media } from "../../src/types";

const media: Media[] = ["book", "video", "game"].map((kind, index) => ({
  id: kind, title: "Chosen " + kind, kind: kind as Media["kind"], status: "pending", author: "Synthetic author", url: "https://example.com/" + kind,
  cover_url: "https://images.test/" + (kind === "book" ? "book.svg" : "wide.svg"), description: "", notes: "", tags: ["selected"], visibility: "private", created_at: `2026-10-${30-index}T00:00:00Z`, updated_at: "2026-10-30T00:00:00Z",
}));
const rows = (page: import("@playwright/test").Page) => page.locator(".media-row");

test("default empty shortlist invites explicit library choices, saves mixed order and keeps artwork", async ({ page }) => {
  await fixture(page, media);
  await page.goto("http://margin.test/dashboard");
  await expect(page.getByRole("heading", { name: "Up next." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What would you like to start next?" })).toBeVisible();
  await page.locator(".queue-empty").getByRole("button", { name: "Browse library" }).click();
  await page.getByRole("button", { name: "Add to Up next: Chosen game", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add to Up next: Chosen game", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Add to Up next: Chosen book", exact: true }).click();
  await page.getByRole("button", { name: "Add to Up next: Chosen video", exact: true }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Up next", exact: true }).click();
  await expect(rows(page).locator(".item-title")).toHaveText(["Chosen game", "Chosen book", "Chosen video"]);
  await expect(page.getByRole("group", { name: "Library view" })).toHaveCount(0);
  const art = rows(page).filter({ hasText: "Chosen book" }).locator(".mini-cover img").first();
  await expect(art).toBeVisible();
  await expect(art).toHaveCSS("object-fit", "contain");
  await page.reload();
  await expect(rows(page).locator(".item-title")).toHaveText(["Chosen game", "Chosen book", "Chosen video"]);
});

test("native keyboard moves retain row focus; removal picks next row and keeps the saved item", async ({ page }) => {
  const f = await fixture(page, media); f.queue(["book", "video", "game"]);
  await page.goto("http://margin.test/dashboard");
  const down = page.getByRole("button", { name: "Move down: Chosen book", exact: true });
  await down.focus(); await page.keyboard.press("Enter");
  await expect(rows(page).locator(".item-title")).toHaveText(["Chosen video", "Chosen book", "Chosen game"]);
  await expect(page.locator('[data-row-id="book"]')).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Chosen book moved. Position 2 of 3." })).toBeVisible();
  await page.getByRole("button", { name: "Remove from Up next: Chosen book", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(rows(page).locator(".item-title")).toHaveText(["Chosen video", "Chosen game"]);
  await expect(page.locator('[data-row-id="game"]')).toBeFocused();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add to Up next: Chosen book", exact: true })).toBeEnabled();
});

test("filters preserve order, disable moves with explanation and distinguish filtered empty", async ({ page }) => {
  const f = await fixture(page, media); f.queue(["game", "book", "video"]);
  await page.goto("http://margin.test/dashboard");
  await page.getByRole("searchbox", { name: "Search Up next" }).fill("Chosen");
  await expect(page.getByRole("button", { name: "Move down: Chosen game", exact: true })).toBeDisabled();
  await expect(page.locator("#queue-filter-explanation")).toContainText("Reordering is disabled");
  await expect(rows(page).locator(".item-title")).toHaveText(["Chosen game", "Chosen book", "Chosen video"]);
  await page.getByRole("searchbox", { name: "Search Up next" }).fill("absent");
  await expect(page.getByRole("heading", { name: "No Up next items match." })).toBeVisible();
  await page.locator(".queue-empty").getByRole("button", { name: "Clear filters" }).click();
  await expect(rows(page)).toHaveCount(3);
});

test("failed writes keep order, stale writes show latest order and Done undo does not reprioritize", async ({ page }) => {
  const f = await fixture(page, media); f.queue(["book", "video", "game"]);
  await page.goto("http://margin.test/dashboard");
  f.failQueue();
  await page.getByRole("button", { name: "Move down: Chosen book", exact: true }).click();
  await expect(page.getByText("Synthetic queue unavailable", { exact: true }).first()).toBeVisible();
  await expect(rows(page).locator(".item-title")).toHaveText(["Chosen book", "Chosen video", "Chosen game"]);
  f.failQueue(false); f.conflictQueue();
  await page.getByRole("button", { name: "Move down: Chosen book", exact: true }).click();
  await expect(rows(page).locator(".item-title")).toHaveText(["Chosen game", "Chosen video", "Chosen book"]);
  await expect(page.getByText(/Up next changed in another tab/).first()).toBeVisible();
  await page.getByRole("checkbox", { name: "Mark done: Chosen video", exact: true }).click();
  await expect(rows(page).locator(".item-title")).toHaveText(["Chosen game", "Chosen book"]);
  await expect(page.getByText("Marked done. Undo returns to unfinished without restoring Up next.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(rows(page).locator(".item-title")).toHaveText(["Chosen game", "Chosen book"]);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Library", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add to Up next: Chosen video", exact: true })).toBeEnabled();
});

test("last removal focuses content and a delayed removal never takes focus from search", async ({ page }) => {
  const f = await fixture(page, media); f.queue(["book"]);
  await page.goto("http://margin.test/dashboard");
  await page.getByRole("button", { name: "Remove from Up next: Chosen book", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "What would you like to start next?" })).toBeVisible();
  await expect(page.locator("#content")).toBeFocused();
  f.queue(["book"]); await page.reload();
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/up-next", async route => { await gate; await route.fallback(); });
  await page.getByRole("button", { name: "Remove from Up next: Chosen book", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search Up next" });
  await search.focus();
  release();
  await expect(rows(page)).toHaveCount(0);
  await expect(search).toBeFocused();
});
