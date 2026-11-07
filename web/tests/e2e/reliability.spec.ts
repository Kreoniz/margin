import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";

const test = base.extend({ request: async ({ context }, use) => { await use(context.request); } });

let ownerState: Awaited<ReturnType<APIRequestContext["storageState"]>> | undefined;
const ids = new Set<string>();
const dialog = (page: Page) => page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Close dialog", exact: true }) });
test.beforeEach(async ({ context, request }) => {
  ids.clear();
  if (ownerState) await context.addCookies(ownerState.cookies);
  else {
    const session = await (await request.get("/api/session")).json();
    const login = await request.post(session.setup_required ? "/api/setup" : "/api/login", { data: { password: process.env.E2E_OWNER_PASSWORD || "qa-only-owner-password" } });
    expect(login.ok()).toBeTruthy();
    ownerState = await request.storageState();
  }
});
test.afterEach(async ({ request }) => {
  for (const id of ids) await request.delete("/api/media/" + id);
});
async function create(request: APIRequestContext, values: Record<string, unknown>) {
  const response = await request.post("/api/media", { data: { title: "[Test] Reliability " + Date.now(), ...values } });
  expect(response.status()).toBe(201);
  const item = await response.json();
  ids.add(item.id);
  return item;
}

test("stale editor preserves newer privacy, completion and notes and reconciles overlapping edits", async ({ page, request, playwright }) => {
  const item = await create(request, { title: "[Test] Stale privacy", visibility: "public", notes: "Old notes" });
  await page.goto(`/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Edit " + item.title, exact: true }).click();
  await request.patch("/api/media/" + item.id, { data: { visibility: "private", status: "done", notes: "New notes" } });
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("[Test] Independent title edit");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  let current = (await (await request.get("/api/media")).json()).find((m: { id: string }) => m.id === item.id);
  expect([current.visibility, current.status, current.notes]).toEqual(["private", "done", "New notes"]);
  const anonymous = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  expect((await anonymous.get("/api/public/media/" + item.id)).status()).toBe(404);
  await anonymous.dispose();

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Edit " + current.title, exact: true }).click();
  await request.patch("/api/media/" + item.id, { data: { title: "[Test] Newer title" } });
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("[Test] Stale title");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("changed elsewhere");
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("[Test] Stale title");
  await page.getByRole("button", { name: "Discard changes and reload" }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("[Test] Newer title");
  current = (await (await request.get("/api/media")).json()).find((m: { id: string }) => m.id === item.id);
  expect(current.visibility).toBe("private");
});

test("Vim completion, undo and dd removal are distinct and row removal works", async ({ page, request }) => {
  const item = await create(request, { title: "[Test] Vim removal" });
  await page.goto(`/dashboard?test=${Date.now()}#library`);
  const row = page.locator(`[data-row-id="${item.id}"]`);
  await row.focus();
  await page.keyboard.press("d");
  expect((await (await request.get("/api/media")).json()).find((m: { id: string }) => m.id === item.id).status).toBe("pending");
  await page.keyboard.press("d");
  await expect(dialog(page)).toContainText("Remove from library?");
  await expect(page.getByRole("button", { name: "Keep it", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toHaveCount(0);
  await expect(row).toBeVisible();
  await expect(row).toBeFocused();
  await page.keyboard.press("d");
  await page.keyboard.press("d");
  await expect(page.getByRole("button", { name: "Keep it", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(row).toBeFocused();
  await row.focus();
  await page.keyboard.press("Space");
  await expect(row).toHaveCount(0);
  await page.locator("main").focus();
  await page.keyboard.press("u");
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Remove " + item.title, exact: true }).click();
  await expect(dialog(page)).toContainText("Remove from library?");
  await page.getByRole("button", { name: "Remove item", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(row).toHaveCount(0);
});

test("a keyboard save failure exposes recovery and the expanded editor fits at 320px", async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  for (const theme of ["dark", "light"]) {
    const item = await create(request, { title: "[Test] Narrow editor " + theme, kind: "article", description: "Details worth keeping. ".repeat(50) });
    await page.goto(`/dashboard?test=${Date.now()}#library`);
    await page.evaluate(value => localStorage.setItem("margin-theme", value), theme);
    await page.reload();
    await page.getByRole("button", { name: "Edit " + item.title, exact: true }).click();
    await dialog(page).locator("summary").filter({ hasText: "Details, image & note" }).click();
    const bounds = await dialog(page).evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
    const upload = (await page.getByLabel("Upload image").boundingBox())!;
    const modal = (await dialog(page).boundingBox())!;
    expect(upload.x + upload.width).toBeLessThanOrEqual(modal.x + modal.width);
    await request.patch("/api/media/" + item.id, { data: { title: item.title + " updated elsewhere" } });
    const note = page.getByRole("textbox", { name: "Private note", exact: true });
    await note.fill("An unrelated unsaved private note");
    const title = page.getByRole("textbox", { name: "Title", exact: true });
    await title.fill(item.title + " draft");
    const modifier = await page.evaluate(() => /mac/i.test(navigator.platform + " " + navigator.userAgent) ? "Meta" : "Control");
    await page.keyboard.press(modifier + "+Enter");
    const alert = dialog(page).getByRole("alert");
    await expect(alert).toContainText("changed elsewhere");
    await expect(alert).toBeFocused();
    await expect(alert).toContainText("discards all unsaved changes, including notes");
    const recovery = (await page.getByRole("button", { name: "Discard changes and reload" }).boundingBox())!;
    expect(recovery.y).toBeGreaterThanOrEqual(modal.y);
    expect(recovery.y + recovery.height).toBeLessThanOrEqual(modal.y + modal.height);
    await expect(title).toHaveValue(item.title + " draft");
    await expect(note).toHaveValue("An unrelated unsaved private note");
    await page.getByRole("button", { name: "Discard changes and reload" }).click();
    await expect(title).toHaveValue(item.title + " updated elsewhere");
    await expect(title).toBeFocused();
    await expect(note).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
  }
});

test("automatic additions can be hidden persistently and source logos replace empty article previews", async ({ page, request }) => {
  const manual = await create(request, { title: "[Test] Manual addition" });
  const automatic = await create(request, { title: "[Test] Automatic addition", kind: "article", url: "https://openai.com/index/test", author: "", description: "", cover_url: "" });
  // Model a source-created record at the bootstrap boundary; backend tests
  // separately verify persisted auto-save provenance and deletion semantics.
  await page.route("**/api/bootstrap", async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.media = body.media.map((m: { id: string }) => m.id === automatic.id ? { ...m, auto_added: true } : m);
    await route.fulfill({ response, json: body });
  });
  await page.goto(`/dashboard?test=${Date.now()}#library`);
  const row = page.locator(`[data-row-id="${automatic.id}"]`);
  await expect(row.locator(".mini-cover img")).toHaveAttribute("src", "/brands/openai.svg");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await dialog(page).getByText("Library · automatic additions", { exact: true }).click();
  await page.getByText("Hide automatic additions", { exact: true }).click();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(page.locator(`[data-row-id="${manual.id}"]`)).toBeVisible();
  await page.reload();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Show all additions", exact: true }).click();
  await expect(row).toBeVisible();
});

test("direct public details expose full text and valid long passwords can be entered", async ({ page, request }) => {
  const description = "A complete description with details worth reading. ".repeat(80);
  const item = await create(request, { title: "[Test] Complete public detail", description, visibility: "public" });
  await page.goto("/shared/" + item.id);
  const dimensions = await page.locator(".shared-description").evaluate(el => ({ height: el.clientHeight, scroll: el.scrollHeight }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.height + 1);
  expect((await page.locator(".shared-description").boundingBox())!.width).toBeGreaterThanOrEqual(Math.min(page.viewportSize()!.width - 100, 500));
  await expect(page.locator(".shared-description")).toHaveText(description.trim());
  await page.route("**/api/session", route => route.fulfill({ json: { authenticated: false, setup_required: false } }));
  await page.route("**/api/login", async route => {
    expect(route.request().postDataJSON().password).toBe("x".repeat(129));
    await route.fulfill({ status: 401, json: { error: "Test login received" } });
  });
  await page.goto(`/dashboard?test=${Date.now()}#library`);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("x".repeat(129));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Test login received");
});

test("a final Show more keyboard activation focuses the first new row", async ({ page, request }) => {
  const items = [];
  for (let i = 0; i < 41; i++) items.push(await create(request, { title: "[Test] Final batch " + i }));
  await page.goto(`/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Show more", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Show more", exact: true })).toHaveCount(0);
  await expect(page.locator(".media-row").nth(40)).toBeFocused();
});

test("Discover fetches additional server pages and searches outside bootstrap history", async ({ page }) => {
  const entries = Array.from({ length: 41 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12,"0")}`, source_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", source_name: "Quiet source", title: i === 40 ? "Older unread article" : "Recent article " + i, author: "", url: "https://example.com/article-" + i, cover_url: "", description: "", published_at: "2026-10-01T00:00:00Z", discovered_at: "2026-10-01T00:00:00Z", state: "new" }));
  await page.route("**/api/bootstrap", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), inbox: [], inbox_counts: { new: 41 } } });
  });
  await page.route("**/api/inbox?*", route => {
    const params = new URL(route.request().url()).searchParams;
    const searched = params.get("q")?.includes("older");
    return route.fulfill({ json: searched ? { items: [entries[40]], total: 1 } : params.has("cursor") ? { items: [entries[40]], total: 41 } : { items: entries.slice(0,40), total: 41, next_cursor: "next" } });
  });
  await page.goto("/dashboard#discover");
  await expect(page.locator(".article-row")).toHaveCount(40);
  await expect(page.locator(".result-count")).toHaveText("41 articles");
  await page.locator(".article-row").last().focus();
  await page.keyboard.press("j");
  await expect(page.locator(".article-row")).toHaveCount(41);
  await expect(page.locator(".article-row").last()).toBeFocused();
  await page.getByRole("searchbox").fill("older");
  await expect(page.locator(".article-row")).toHaveCount(1);
  await expect(page.locator(".article-row")).toContainText("Older unread article");
  await expect(page.locator(".result-count")).toHaveText("1 article");
});

test("empty Discover distinguishes paused, failed and initial source collection", async ({ page }) => {
  let phase = "paused";
  await page.route("**/api/bootstrap", async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.sources = [{ ...body.sources[0], enabled: phase !== "paused", last_sync: phase === "initial" ? null : "2026-10-01T00:00:00Z", last_error: phase === "failed" ? "Publisher unavailable" : "" }];
    await route.fulfill({ response, json: body });
  });
  await page.route("**/api/inbox?*", route => route.fulfill({ json: { items: [], total: 0 } }));
  for (const [state, heading] of [["paused", "Collection is paused."], ["failed", "Sources need attention."], ["initial", "Checking your sources…"]]) {
    phase = state;
    await page.goto("/dashboard?health=" + state + "#discover");
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "You’re all caught up.", exact: true })).toHaveCount(0);
  }
});

test("retrying metadata preserves an explicit Article type", async ({ page, request }) => {
  const item = await create(request, { title: "[Test] Explicit article", kind: "article", url: "https://publisher.example/type", author: "", description: "", cover_url: "" });
  await page.route("**/api/metadata", route => route.fulfill({ json: { title: "Fetched video", author: "Channel", kind: "video", description: "A fetched description", cover_url: "", url: item.url } }));
  await page.goto(`/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Edit " + item.title, exact: true }).click();
  const metadata = page.waitForResponse(r => new URL(r.url()).pathname === "/api/metadata");
  await page.getByRole("button", { name: "Find missing details", exact: true }).click();
  await metadata;
  await expect(dialog(page).getByRole("combobox", { name: "Type", exact: true })).toHaveText("Article");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  const current = (await (await request.get("/api/media")).json()).find((m: { id: string }) => m.id === item.id);
  expect(current.kind).toBe("article");
  expect(current.kind_explicit).toBe(true);
});

test("session expiry hides private UI and restores the in-memory draft after sign-in", async ({ page, request }) => {
  const item = await create(request, { title: "[Test] Reauthentication", notes: "Stored note" });
  await page.goto(`/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Edit " + item.title, exact: true }).click();
  await dialog(page).locator("summary").filter({ hasText: "Details, image & note" }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(item.title + " edited");
  const secretDraft = "An unsaved private note for the session-expiry test";
  await page.getByRole("textbox", { name: "Private note", exact: true }).fill(secretDraft);
  expect((await request.post("/api/logout")).ok()).toBeTruthy();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toContain(secretDraft);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(secretDraft);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(process.env.E2E_OWNER_PASSWORD || "qa-only-owner-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Private note", exact: true })).toHaveValue(secretDraft);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(item.title + " edited");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect((await (await request.get("/api/media")).json()).find((value: { id: string }) => value.id === item.id).notes).toBe(secretDraft);
  ownerState = await request.storageState();
});

test("browser-token mutations wait for a known status and failed reads can be retried", async ({ page }) => {
  let phase = "pending", mutations = 0;
  let release = () => {};
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/integration/browser-token", async route => {
    if (route.request().method() !== "GET") { mutations++; return route.fulfill({ json: { token: "synthetic-token" } }); }
    if (phase === "pending") await wait;
    return route.fulfill(phase === "failed" ? { status: 503, json: { error: "Status unavailable" } } : { json: { configured: true } });
  });
  await page.goto(`/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByText("Helium / browser capture", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Checking browser token…", exact: true })).toBeDisabled();
  expect(mutations).toBe(0);
  phase = "known"; release();
  await page.getByRole("button", { name: "Replace browser token", exact: true }).click();
  await expect(page.getByText("Replace the browser token? The extension will need the new token.", { exact: true })).toBeVisible();
  expect(mutations).toBe(0);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  phase = "failed";
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByText("Helium / browser capture", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry token status", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Browser token status unavailable", exact: true })).toBeDisabled();
  phase = "known";
  await page.getByRole("button", { name: "Retry token status", exact: true }).click();
  await expect(page.getByRole("button", { name: "Replace browser token", exact: true })).toBeEnabled();
  expect(mutations).toBe(0);
});

test("Ctrl+d/u keep search focus and a new URL capture has one URL authority", async ({ page, request }) => {
  await create(request, { title: "[Test] Input focus" });
  await page.goto(`/dashboard?test=${Date.now()}#library`);
  const search = page.getByRole("searchbox");
  for (const query of ["", "Input"]) {
    await search.fill(query);
    for (const key of ["Control+d", "Control+u"]) { await page.keyboard.press(key); await expect(search).toBeFocused(); }
  }
  let release = () => {};
  const oldPage = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/metadata", async route => {
    const old = route.request().postDataJSON().url.endsWith("/a");
    if (old) await oldPage;
    await route.fulfill({ json: { title: old ? "Article A" : "Article B", author: old ? "Writer A" : "Writer B", description: "Page summary", kind: "article", cover_url: "" } }).catch(() => {});
  });
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  const capture = page.getByRole("textbox", { name: "Title or URL", exact: true });
  const oldRequest = page.waitForRequest(request => request.url().endsWith("/api/metadata"));
  await capture.fill("https://publisher.example/a"); await oldRequest;
  await dialog(page).locator("summary").filter({ hasText: "Details, image & note" }).click();
  await expect(page.getByRole("textbox", { name: "URL (optional)", exact: true })).toHaveCount(0);
  await capture.fill("https://publisher.example/b");
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Article B");
  release();
  const saved = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/media");
  await page.getByRole("button", { name: "Add to library", exact: true }).click();
  const result = await (await saved).json(); ids.add(result.id);
  expect([result.url, result.title, result.author]).toEqual(["https://publisher.example/b", "Article B", "Writer B"]);
});

test("Discover End survives refresh and hidden error rows have no shortcut actions", async ({ page }) => {
  const entries = Array.from({ length: 81 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, title: "Discovery " + i, source_name: "Synthetic source", url: "https://example.com/" + i, author: "", description: "", cover_url: "", state: "new", published_at: "2026-10-01T00:00:00Z" }));
  let failed = false, reads = 0, mutations = 0;
  await page.route("**/api/inbox?*", route => {
    reads++;
    if (failed) return route.fulfill({ status: 503, json: { error: "Discovery refresh failed" } });
    const start = Number(new URL(route.request().url()).searchParams.get("cursor") || 0);
    return route.fulfill({ json: { items: entries.slice(start, start + 40), total: 81, ...(start + 40 < 81 ? { next_cursor: String(start + 40) } : {}) } });
  });
  await page.route("**/api/inbox/*", route => { mutations++; return route.fulfill({ status: 204 }); });
  await page.goto("/dashboard#discover");
  await page.locator(".article-row").first().focus();
  await page.keyboard.press("End");
  await expect(page.locator(".article-row")).toHaveCount(81);
  await expect(page.locator(".article-row").last()).toBeFocused();
  const before = reads;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads).toBeGreaterThanOrEqual(before + 3);
  await expect(page.locator(".article-row")).toHaveCount(81);
  await expect(page.locator(".article-row").last()).toBeFocused();
  failed = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText("Discovery refresh failed");
  await expect(page.locator(".article-row")).toHaveCount(0);
  for (const key of ["s", "x", "r", "Enter"]) await page.keyboard.press(key);
  expect(mutations).toBe(0);
  failed = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".article-row")).toHaveCount(81);
});

test("public collection times out, retries transient reads and preserves genuine 404 messaging", async ({ page }) => {
  await page.addInitScript(() => {
    const deadlines: AbortController[] = [];
    AbortSignal.timeout = () => { const controller = new AbortController(); deadlines.push(controller); return controller.signal; };
    Object.assign(window, { expireCollection: () => deadlines.splice(0).forEach(controller => controller.abort(new DOMException("Test deadline", "TimeoutError"))) });
  });
  let phase = "hang", release = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/public/media", async route => {
    if (phase === "hang") { await waiting; await route.abort().catch(() => {}); return; }
    await route.fulfill(phase === "failed" ? { status: 503, json: { error: "Temporary collection failure" } } : { json: [] });
  });
  const pending = page.waitForRequest(request => new URL(request.url()).pathname === "/api/public/media");
  await page.goto("/"); await pending;
  await page.evaluate("window.expireCollection()");
  await expect(page.getByRole("alert")).toContainText("Could not reach Margin");
  phase = "ready"; release();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nothing shared yet.", exact: true })).toBeVisible();
  phase = "failed"; await page.reload();
  await expect(page.getByRole("alert")).toContainText("Temporary collection failure");
  phase = "ready";
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nothing shared yet.", exact: true })).toBeVisible();
  await page.route("**/api/public/media/*", route => route.fulfill({ status: 404, json: { error: "Missing" } }));
  await page.goto("/shared/00000000-0000-4000-8000-000000000001");
  await expect(page.getByRole("alert")).toContainText("This item is not shared.");
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
});

test("public detail links identify their item", async ({ page, request }) => {
  const items = [];
  for (const title of ["[Test] Detail one", "[Test] Detail two"]) items.push(await create(request, { title, kind: "article", author: "Writer", description: "Summary", cover_url: "", url: "https://publisher.example/" + title.endsWith("one"), visibility: "public" }));
  await page.goto("/");
  for (const item of items) {
    await expect(page.getByRole("link", { name: "View details: " + item.title, exact: true })).toHaveAttribute("href", "/shared/" + item.id);
  }
});

test("submission-token status has truthful failure and retry with mutations gated", async ({ page }) => {
  let phase = "failed", mutations = 0, release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/integration/token", async route => {
    if (route.request().method() !== "GET") { mutations++; return route.fulfill({ json: { token: "synthetic-submission-token" } }); }
    if (phase === "pending") await pending;
    return route.fulfill(phase === "failed" ? { status: 503, json: { error: "Status temporarily unavailable" } } : { json: { configured: true } });
  });
  await page.goto(`/dashboard?test=${Date.now()}#library`);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByText("Telegram & Hermes", { exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Submission token status unavailable");
  await expect(page.getByRole("button", { name: "Create submission token", exact: true })).toHaveCount(0);
  phase = "pending";
  await page.getByRole("button", { name: "Retry submission token status", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Loading integration status");
  expect(mutations).toBe(0);
  phase = "known"; release();
  await page.getByRole("button", { name: "Replace token", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
  expect(mutations).toBe(0);
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(() => mutations).toBe(1);
});
