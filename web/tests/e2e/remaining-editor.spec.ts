import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./synthetic-fixture";
import type { Media } from "../../src/types";

const editor = (page: Page) => page.locator(".editor-modal");
const stored = (): Media => ({
  id: "enriched-a", title: "Original work A", author: "Original creator A", kind: "article",
  url: "https://example.com/work-a#section", cover_url: "https://images.test/wide.svg",
  description: "Original description A", notes: "Stored private note", tags: ["Personal"],
  status: "pending", visibility: "private", metadata_state: "ready",
  created_at: "2026-10-30T00:00:00Z", updated_at: "2026-10-30T00:00:00Z",
});

test("a different existing URL requires an explicit metadata choice before saving", async ({ page }) => {
  const controls = await fixture(page, [stored()]);
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Edit Original work A", exact: true }).click();
  await editor(page).getByRole("textbox", { name: "URL (optional)", exact: true }).fill("https://example.com/work-b");
  await editor(page).getByRole("button", { name: "Save changes", exact: true }).click();
  expect(controls.requests.mediaWrites).toEqual([]);
  await expect(editor(page).getByRole("alert")).toContainText("Choose whether to keep or replace");
  await editor(page).getByRole("button", { name: "Keep details · link correction", exact: true }).click();
  await editor(page).getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  expect(controls.requests.mediaWrites[0]).toMatchObject({
    url: "https://example.com/work-b", title: stored().title, author: stored().author,
    description: stored().description, cover_url: stored().cover_url, fetch_metadata: false,
    expected_url: stored().url,
  });
  for (const key of ["notes", "tags", "status", "visibility"]) expect(controls.requests.mediaWrites[0]).not.toHaveProperty(key);
});

test("replacement details require explicit application and preserve private fields and chosen type", async ({ page }) => {
  const item = { ...stored(), kind: "book" as const, kind_explicit: true, selected_text: "Private original excerpt", selected_text_source_url: stored().url };
  const controls = await fixture(page, [item]);
  let requests = 0;
  await page.route("**/api/metadata", async route => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ url: "https://example.com/work-b#new" });
    await route.fulfill({ json: { title: "New work B", author: "New creator B", kind: "video", description: "New description B", cover_url: "https://images.test/video.svg" } });
  });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Edit Original work A", exact: true }).click();
  const modal = editor(page);
  await modal.getByText("Details, image & note", { exact: true }).click();
  await modal.getByRole("textbox", { name: "Private note", exact: true }).fill("Deliberate new note");
  await modal.getByRole("textbox", { name: "URL (optional)", exact: true }).fill("https://example.com/work-b#new");
  expect(requests).toBe(0);
  await modal.getByRole("button", { name: "Fetch replacement details", exact: true }).click();
  await expect(modal.getByRole("region", { name: "Replacement details preview", exact: true })).toContainText("New work B");
  await expect(modal.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Original work A");
  await modal.getByRole("button", { name: "Use fetched details", exact: true }).click();
  await expect(modal.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("New work B");
  await expect(modal.getByRole("combobox", { name: "Type", exact: true })).toContainText("Book");
  await expect(modal.getByRole("region", { name: "Saved selection (private)", exact: true })).toContainText("Private original excerpt");
  await expect(modal.getByRole("link", { name: "Selection source:", exact: false })).toHaveAttribute("href", stored().url);
  await modal.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(controls.requests.mediaWrites[0]).toMatchObject({
    title: "New work B", author: "New creator B", description: "New description B", cover_url: "https://images.test/video.svg",
    kind: "book", infer_kind: false, notes: "Deliberate new note", url: "https://example.com/work-b#new", fetch_metadata: false,
  });
  for (const key of ["tags", "status", "visibility", "selected_text", "selected_text_source_url"]) expect(controls.requests.mediaWrites[0]).not.toHaveProperty(key);
});

test("replacement failure keeps owner text and permits an explicit keep or retry", async ({ page }) => {
  const controls = await fixture(page, [stored()]);
  let fail = true;
  await page.route("**/api/metadata", route => route.fulfill(fail
    ? { status: 503, json: { error: "Synthetic publisher unavailable" } }
    : { json: { title: "Recovered B", author: "", kind: "paper", description: "", cover_url: "" } }));
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Edit Original work A", exact: true }).click();
  const modal = editor(page);
  await modal.getByRole("textbox", { name: "URL (optional)", exact: true }).fill("https://example.com/work-b");
  await modal.getByRole("button", { name: "Fetch replacement details", exact: true }).click();
  await expect(modal.getByText("Replacement details are unavailable.", { exact: false })).toBeVisible();
  await expect(modal.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Original work A");
  await modal.getByRole("button", { name: "Save changes", exact: true }).click();
  expect(controls.requests.mediaWrites).toEqual([]);
  fail = false;
  await modal.getByRole("button", { name: "Retry replacement details", exact: true }).click();
  await modal.getByRole("button", { name: "Use fetched details", exact: true }).click();
  await expect(modal.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Recovered B");
  await modal.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(controls.requests.mediaWrites[0]).toMatchObject({ title: "Recovered B", author: "", description: "", cover_url: "", kind: "paper", fetch_metadata: false });
});

test("held B replacement cannot apply to C or silently start another lookup", async ({ page }) => {
  const controls = await fixture(page, [stored()]);
  const lookedUp: string[] = [];
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/metadata", async route => {
    lookedUp.push(route.request().postDataJSON().url);
    await gate;
    await route.fulfill({ json: { title: "Late work B", author: "Late creator B", description: "Late B", cover_url: "", kind: "video" } });
  });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Edit Original work A", exact: true }).click();
  const modal = editor(page);
  const url = modal.getByRole("textbox", { name: "URL (optional)", exact: true });
  await url.fill("https://example.com/work-b");
  await modal.getByRole("button", { name: "Fetch replacement details", exact: true }).click();
  await expect.poll(() => lookedUp).toEqual(["https://example.com/work-b"]);
  await url.fill("https://example.com/work-c#position");
  release();
  await modal.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("Choose whether to keep or replace");
  await expect(modal.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Original work A");
  await expect(modal.getByRole("button", { name: "Use fetched details", exact: true })).toHaveCount(0);
  expect(lookedUp).toEqual(["https://example.com/work-b"]);
  expect(controls.requests.mediaWrites).toEqual([]);
  await modal.getByRole("button", { name: "Keep details · link correction", exact: true }).click();
  await modal.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(controls.requests.mediaWrites[0]).toMatchObject({ url: "https://example.com/work-c#position", title: "Original work A", fetch_metadata: false });
});

test("ordinary anchor corrections retain details without a replacement prompt", async ({ page }) => {
  const controls = await fixture(page, [stored()]);
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Edit Original work A", exact: true }).click();
  await editor(page).getByRole("textbox", { name: "URL (optional)", exact: true }).fill("https://example.com/work-a#another-section");
  await expect(editor(page).getByRole("region", { name: "New link details", exact: true })).toHaveCount(0);
  await editor(page).getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  expect(controls.requests.mediaWrites[0]).toMatchObject({ url: "https://example.com/work-a#another-section" });
  for (const key of ["title", "author", "description", "cover_url", "kind", "fetch_metadata", "metadata_warning"])
    expect(controls.requests.mediaWrites[0]).not.toHaveProperty(key);
});

test("a pending fragment correction preserves enrichment and omits unchanged metadata", async ({ page }) => {
  const item = { ...stored(), title: "paper.pdf", author: "", url: "https://example.com/paper.pdf#page=2", metadata_state: "pending" as const };
  const controls = await fixture(page, [item]);
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Edit paper.pdf", exact: true }).click();
  await editor(page).getByRole("textbox", { name: "URL (optional)", exact: true }).fill("https://example.com/paper.pdf#page=12");
  await expect(editor(page).getByRole("region", { name: "New link details", exact: true })).toHaveCount(0);
  await editor(page).getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  expect(controls.requests.mediaWrites[0]).toEqual({
    url: "https://example.com/paper.pdf#page=12", expected: { url: item.url },
  });
});

test("neutral duplicates retain a new note until explicit discard and navigation", async ({ page }) => {
  const controls = await fixture(page, [stored()]);
  let attempts = 0;
  await page.route("**/api/media", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    attempts++;
    return route.fulfill({ status: 409, json: { error: "Duplicate error must not be shown", existing_id: stored().id } });
  });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await editor(page).getByRole("textbox", { name: "Title or URL", exact: true }).fill(stored().url);
  await editor(page).getByText("Details, image & note", { exact: true }).click();
  await editor(page).getByRole("textbox", { name: "Private note", exact: true }).fill("New private thought to keep");
  await editor(page).getByRole("button", { name: "Add to library", exact: true }).click();
  await expect(editor(page).getByText("Already saved", { exact: true })).toBeVisible();
  await expect(editor(page).getByRole("alert")).toHaveCount(0);
  await expect(editor(page).getByRole("textbox", { name: "Private note", exact: true })).toHaveValue("New private thought to keep");
  await page.keyboard.press("Escape");
  await expect(editor(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Resume draft", exact: true }).click();
  await expect(editor(page).getByRole("textbox", { name: "Private note", exact: true })).toHaveValue("New private thought to keep");
  await editor(page).getByRole("button", { name: "Add to library", exact: true }).click();
  await editor(page).getByRole("button", { name: "Discard draft and open existing item", exact: true }).click();
  await expect(editor(page).getByRole("textbox", { name: "Title", exact: true })).toHaveValue(stored().title);
  await editor(page).getByText("Details, image & note", { exact: true }).click();
  await expect(editor(page).getByRole("textbox", { name: "Private note", exact: true })).toHaveValue(stored().notes);
  await editor(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume draft", exact: true })).toHaveCount(0);
  expect(attempts).toBe(2);
  expect(controls.requests.mediaWrites).toEqual([]);
});

test("a dismissed dirty note is resumable, discardable and never stored in browser storage", async ({ page }) => {
  await fixture(page, [stored()]);
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Edit Original work A", exact: true }).click();
  await editor(page).getByText("Details, image & note", { exact: true }).click();
  await editor(page).getByRole("textbox", { name: "Private note", exact: true }).fill("Unsaved recovery note");
  for (const dismiss of ["Cancel", "Escape", "Close dialog", "Outside"]) {
    if (dismiss === "Cancel") await editor(page).getByRole("button", { name: "Cancel", exact: true }).click();
    else if (dismiss === "Escape") await page.keyboard.press("Escape");
    else if (dismiss === "Close dialog") await editor(page).getByRole("button", { name: "Close dialog", exact: true }).click();
    else await page.locator(".u-dialog-viewport").click({ position: { x: 4, y: 4 } });
    await expect(editor(page)).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("Unsaved recovery note");
    await page.getByRole("button", { name: "Resume draft", exact: true }).click();
    await expect(editor(page).getByRole("textbox", { name: "Private note", exact: true })).toHaveValue("Unsaved recovery note");
  }
  await editor(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Discard draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume draft", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit Original work A", exact: true }).click();
  await editor(page).getByText("Details, image & note", { exact: true }).click();
  await expect(editor(page).getByRole("textbox", { name: "Private note", exact: true })).toHaveValue(stored().notes);
});

test("a failed save retains its draft on dismissal and clears recovery after a successful retry", async ({ page }) => {
  const controls = await fixture(page, [stored()]);
  controls.failMedia();
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Edit Original work A", exact: true }).click();
  await editor(page).getByRole("textbox", { name: "Title", exact: true }).fill("Retried owner title");
  await editor(page).getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor(page).getByRole("alert")).toContainText("Synthetic save unavailable");
  await editor(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Resume draft", exact: true }).click();
  await expect(editor(page).getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Retried owner title");
  controls.failMedia(false);
  await editor(page).getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resume draft", exact: true })).toHaveCount(0);
});

test("new Save as Done stays private and does not wait for held metadata or accept A results for B", async ({ page }) => {
  const controls = await fixture(page, [stored()]);
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const lookedUp: string[] = [];
  await page.route("**/api/metadata", async route => {
    lookedUp.push(route.request().postDataJSON().url);
    await gate;
    await route.fulfill({ json: { title: "Stale metadata A", author: "Stale author A", kind: "video", description: "Stale A", cover_url: "" } });
  });
  await page.setViewportSize({ width: 320, height: 812 });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  const capture = editor(page).getByRole("textbox", { name: "Title or URL", exact: true });
  await capture.fill("https://example.com/capture-a");
  await expect.poll(() => lookedUp.length).toBe(1);
  await capture.fill("https://example.com/capture-b#original");
  await expect.poll(() => lookedUp.length).toBe(2);
  const saveDone = editor(page).getByRole("button", { name: "Save as Done", exact: true });
  await saveDone.scrollIntoViewIfNeeded();
  expect(await saveDone.evaluate(element => { const bounds = element.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth; })).toBe(true);
  await saveDone.click();
  await expect(editor(page)).toHaveCount(0);
  expect(controls.requests.mediaWrites[0]).toMatchObject({ url: "https://example.com/capture-b#original", title: "example.com", status: "done", visibility: "private", author: "", description: "", fetch_metadata: true });
  release();
});

test("session expiry hides a private draft and restores it after sign-in", async ({ page }) => {
  await fixture(page, [stored()]);
  let authenticated = true;
  await page.route("**/api/session", route => route.fulfill({ json: { authenticated, setup_required: false } }));
  await page.route("**/api/login", route => { authenticated = true; return route.fulfill({ json: { authenticated: true, setup_required: false } }); });
  await page.route("**/api/media/enriched-a", route => {
    authenticated = false;
    return route.fulfill({ status: 401, json: { error: "Session expired" } });
  });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Edit Original work A", exact: true }).click();
  await editor(page).getByText("Details, image & note", { exact: true }).click();
  await editor(page).getByRole("textbox", { name: "Private note", exact: true }).fill("Private expiry recovery");
  await editor(page).getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain("Private expiry recovery");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("synthetic-owner-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(editor(page).getByRole("textbox", { name: "Private note", exact: true })).toHaveValue("Private expiry recovery");
});

test("a new capture keeps B metadata when held A finishes and keyboard Save stays Pending", async ({ page }) => {
  const controls = await fixture(page, [stored()]);
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let aStarted = false, aReturned = false;
  await page.route("**/api/metadata", async route => {
    const old = route.request().postDataJSON().url.endsWith("/a");
    if (old) { aStarted = true; await gate; }
    await route.fulfill({ json: { title: old ? "Work A" : "Work B", author: old ? "Writer A" : "Writer B", kind: "article", description: "Fetched description", cover_url: "" } });
    if (old) aReturned = true;
  });
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  const capture = editor(page).getByRole("textbox", { name: "Title or URL", exact: true });
  await capture.fill("https://example.com/a");
  await expect.poll(() => aStarted).toBe(true);
  await capture.fill("https://example.com/b#position");
  const title = editor(page).getByRole("textbox", { name: "Title", exact: true });
  await expect(title).toHaveValue("Work B");
  release();
  await expect.poll(() => aReturned).toBe(true);
  await expect(title).toHaveValue("Work B");
  const modifier = await page.evaluate(() => /mac/i.test(navigator.platform + navigator.userAgent) ? "Meta" : "Control");
  await title.press(`${modifier}+Enter`);
  await expect(editor(page)).toHaveCount(0);
  expect(controls.requests.mediaWrites[0]).toMatchObject({ title: "Work B", author: "Writer B", url: "https://example.com/b#position", status: "pending", visibility: "private" });
});

test("conflicts retain the expected baseline through dismissal until explicit reload", async ({ page }) => {
  const controls = await fixture(page, [stored()]);
  controls.conflictMedia();
  await page.route("**/api/media", route => route.request().method() === "GET"
    ? route.fulfill({ json: [{ ...stored(), title: "Latest owner title" }] })
    : route.fallback());
  await page.goto(`http://margin.test/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Edit Original work A", exact: true }).click();
  await editor(page).getByRole("textbox", { name: "Title", exact: true }).fill("Conflicting owner draft");
  await editor(page).getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editor(page).getByRole("alert")).toContainText("Synthetic conflicting edit");
  await editor(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Resume draft", exact: true }).click();
  await expect(editor(page).getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Conflicting owner draft");
  await editor(page).getByRole("button", { name: "Save changes", exact: true }).click();
  expect(controls.requests.mediaWrites[1]).toMatchObject({ title: "Conflicting owner draft", expected: { title: "Original work A" } });
  await editor(page).getByRole("button", { name: "Discard changes and reload", exact: true }).click();
  await expect(editor(page).getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Latest owner title");
  await editor(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume draft", exact: true })).toHaveCount(0);
});
