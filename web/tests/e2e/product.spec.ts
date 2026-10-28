import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
  type Locator,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const test = base.extend({
  request: async ({ context }, use) => {
    await use(context.request);
  },
});
let ownerState:
  | Awaited<ReturnType<APIRequestContext["storageState"]>>
  | undefined;
const password = process.env.E2E_OWNER_PASSWORD || "qa-only-owner-password";
const baseURL = process.env.BASE_URL || "http://127.0.0.1:5178";
const ownedTitles = new Set<string>();
const dialog = (page: Page) =>
  page.getByRole("dialog").filter({
    has: page.getByRole("button", { name: "Close dialog", exact: true }),
  });
const title = (label: string) => {
  const value = "[Test] " + label + " " + Date.now();
  ownedTitles.add(value);
  return value;
};
async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let step = 0; step < 160; step++) {
    if (
      await target.evaluate(
        (element) =>
          element === document.activeElement ||
          element.contains(document.activeElement),
      )
    )
      return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Control could not be reached using Tab: " + target);
}
async function modifier(page: Page) {
  return page.evaluate(() =>
    /mac/i.test(navigator.platform + " " + navigator.userAgent)
      ? "Meta"
      : "Control",
  );
}
async function login(request: APIRequestContext) {
  const session = await (await request.get("/api/session")).json();
  if (!session.authenticated) {
    const response = await request.post(
      session.setup_required ? "/api/setup" : "/api/login",
      { data: { password } },
    );
    expect(response.ok()).toBeTruthy();
  }
}
async function checkAccess(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
}
test.beforeEach(async ({ request, context }, info) => {
  ownedTitles.clear();
  if (!info.title.startsWith("access:")) {
    if (ownerState) await context.addCookies(ownerState.cookies);
    await login(request);
    ownerState = await request.storageState();
  }
});
test.afterEach(async ({ request }) => {
  if (!ownedTitles.size) return;
  await login(request);
  for (const item of await (await request.get("/api/media")).json())
    if (ownedTitles.has(item.title))
      await request.delete("/api/media/" + item.id);
});

test("access: first-run setup or login, private empty list and logout", async ({
  page,
  request,
}, info) => {
  const session = await (await request.get("/api/session")).json();
  await page.goto("/dashboard");
  if (session.setup_required) {
    await expect(
      page.getByRole("heading", { name: "Make it yours." }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Owner password", exact: true })
      .fill(password);
    await page
      .getByRole("textbox", { name: "Confirm password", exact: true })
      .fill(password);
    await checkAccess(page);
    await page.getByRole("button", { name: "Create private library" }).click();
  } else {
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Your library." }),
  ).toBeVisible();
  await expect(
    page.getByText("Something worth keeping?", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".media-row")).toHaveCount(0);
  await checkAccess(page);
  await page.screenshot({
    path: "test-results/empty-library-" + info.project.name + ".png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await dialog(page)
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  expect((await request.get("/api/bootstrap")).status()).toBe(401);
});

test("compact library supports title-only adding, two-state toggles, editing, search and persistence", async ({
  page,
  request,
}) => {
  const name = title("reading list");
  const edited = name + " edited";
  ownedTitles.add(edited);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await dialog(page).getByRole("textbox", { name: "Title or URL" }).fill(name);
  await dialog(page)
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  const row = page
    .locator(".media-row")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
  await expect(row).toBeVisible();
  await row
    .getByRole("checkbox", { name: "Mark done: " + name, exact: true })
    .click();
  await expect(row).not.toBeVisible();
  await page
    .locator(".list-tabs")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await expect(row).toBeVisible();
  await row
    .getByRole("checkbox", { name: "Mark to read/watch: " + name, exact: true })
    .click();
  await page
    .locator(".list-tabs")
    .getByRole("button", { name: "To read/watch", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit " + name, exact: true }).click();
  await dialog(page)
    .getByRole("textbox", { name: "Title", exact: true })
    .fill(edited);
  await dialog(page)
    .getByText("Details, image & note", { exact: true })
    .click();
  await dialog(page)
    .getByRole("textbox", { name: "Creator (optional)" })
    .fill("A test creator");
  await dialog(page)
    .getByRole("textbox", { name: "Tags (optional)" })
    .fill("Research, Later");
  await dialog(page)
    .getByRole("textbox", { name: "Private note" })
    .fill("Owner-only test note.");
  await dialog(page).getByRole("button", { name: "Save changes" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("searchbox", { name: "Search library" })
    .fill("test creator research");
  await expect(
    page.getByRole("button", { name: edited, exact: true }),
  ).toBeVisible();
  const stored = (await (await request.get("/api/media")).json()).find(
    (m: { title: string }) => m.title === edited,
  );
  expect(stored).toMatchObject({
    status: "pending",
    visibility: "private",
    notes: "Owner-only test note.",
    tags: ["Research", "Later"],
  });
  for (const key of ["progress", "total", "unit", "rating", "favorite"])
    expect(stored).not.toHaveProperty(key);
  await page
    .getByRole("button", { name: "Edit " + edited, exact: true })
    .click();
  await dialog(page)
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await dialog(page)
    .getByRole("button", { name: "Remove item", exact: true })
    .click();
  await expect(dialog(page)).not.toBeVisible();
  await expect(
    page.getByText("Nothing matches yet.", { exact: true }),
  ).toBeVisible();
});

test("URL capture extracts editable metadata and preserves chosen type", async ({
  page,
}) => {
  const name = title("URL capture");
  let calls = 0;
  await page.route("**/api/metadata", async (route) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({
      json: {
        title: name,
        author: "Test publisher",
        kind: "article",
        url: "https://example.com/qa-canonical-" + Date.now(),
        cover_url: "",
        description: "A synthetic test response, not library demo data.",
      },
    });
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await dialog(page)
    .getByRole("textbox", { name: "Title or URL" })
    .fill("https://example.com/qa-redirect");
  await expect(
    dialog(page).getByRole("button", { name: "Add to library", exact: true }),
  ).toBeEnabled();
  await dialog(page)
    .getByRole("combobox", { name: "Type", exact: true })
    .click();
  await page.getByRole("option", { name: "Video", exact: true }).click();
  await expect(
    dialog(page).getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue(name);
  await expect(
    dialog(page).getByRole("combobox", { name: "Type", exact: true }),
  ).toContainText("Video");
  await dialog(page)
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  expect(calls).toBe(1);
});

test("switching URL capture to a manual title clears fetched details and preserves explicit edits", async ({
  page,
  request,
}) => {
  const name = title("manual after URL");
  await page.route("**/api/metadata", (route) =>
    route.fulfill({
      json: {
        title: "Fetched test page",
        author: "Fetched author",
        kind: "article",
        url: "https://example.com/old-page",
        cover_url: "https://example.com/cover.jpg",
        description: "Fetched description",
      },
    }),
  );
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await dialog(page)
    .getByRole("textbox", { name: "Title or URL" })
    .fill("https://example.com/old-page");
  await expect(
    dialog(page).getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Fetched test page");
  await dialog(page)
    .getByText("Details, image & note", { exact: true })
    .click();
  await dialog(page)
    .getByRole("textbox", { name: "Creator (optional)" })
    .fill("My own creator");
  await dialog(page)
    .getByRole("textbox", { name: "Private note", exact: true })
    .fill("Keep my own note.");
  await dialog(page).getByRole("textbox", { name: "Title or URL" }).fill(name);
  await expect(
    dialog(page).getByRole("textbox", { name: "Description (optional)" }),
  ).toHaveValue("");
  await dialog(page)
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  const stored = (await (await request.get("/api/media")).json()).find(
    (m: { title: string }) => m.title === name,
  );
  expect(stored).toMatchObject({
    url: "",
    author: "My own creator",
    description: "",
    cover_url: "",
    notes: "Keep my own note.",
  });
});

test("private and public items have owner-only edits and notes never leak", async ({
  page,
  request,
  browser,
  playwright,
}) => {
  const privateTitle = title("private item"),
    publicTitle = title("public item");
  const privateItem = await (
    await request.post("/api/media", {
      data: { title: privateTitle, kind: "book", notes: "Private secret note" },
    })
  ).json();
  const publicItem = await (
    await request.post("/api/media", {
      data: {
        title: publicTitle,
        kind: "article",
        visibility: "public",
        notes: "Never publish this note",
      },
    })
  ).json();
  const guest = await playwright.request.newContext({ baseURL });
  try {
    const list = await (await guest.get("/api/public/media")).json();
    expect(list.map((m: { id: string }) => m.id)).toEqual([publicItem.id]);
    expect(list[0]).not.toHaveProperty("notes");
    expect(
      (await guest.get("/api/public/media/" + privateItem.id)).status(),
    ).toBe(404);
    expect((await guest.get("/api/media")).status()).toBe(401);
    expect(
      (
        await guest.patch("/api/media/" + publicItem.id, {
          data: { title: "Wrong" },
        })
      ).status(),
    ).toBe(401);
    const context = await browser.newContext();
    const publicPage = await context.newPage();
    await publicPage.goto(baseURL + "/shared");
    await expect(
      publicPage.getByRole("link", { name: publicTitle, exact: true }),
    ).toBeVisible();
    await expect(
      publicPage.getByText(privateTitle, { exact: true }),
    ).not.toBeVisible();
    await expect(
      publicPage.getByText("Never publish this note"),
    ).not.toBeVisible();
    await expect(publicPage.getByRole("button", { name: /Edit / })).toHaveCount(
      0,
    );
    await checkAccess(publicPage);
    await context.close();
    await page.goto("/dashboard");
    await page
      .getByRole("button", { name: "Edit " + publicTitle, exact: true })
      .click();
    await dialog(page)
      .getByRole("combobox", { name: "Visibility", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Private · only you", exact: true })
      .click();
    await dialog(page).getByRole("button", { name: "Save changes" }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(
      (await guest.get("/api/public/media/" + publicItem.id)).status(),
    ).toBe(404);
  } finally {
    await guest.dispose();
  }
});

test("submission token captures idempotently and cannot read, edit or publish", async ({
  request,
  playwright,
}) => {
  const name = title("integration capture");
  const token = (await (await request.post("/api/integration/token")).json())
    .token;
  const guest = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: "Bearer " + token },
  });
  try {
    const first = await guest.post("/api/integrations/items", {
      data: { title: name, notes: "Integration-private note" },
    });
    expect(first.status()).toBe(201);
    const receipt = await first.json();
    expect(Object.keys(receipt).sort()).toEqual(["created", "id"]);
    expect(receipt.created).toBe(true);
    expect(
      (
        await guest.post("/api/integrations/items", { data: { title: name } })
      ).status(),
    ).toBe(200);
    expect((await guest.get("/api/media")).status()).toBe(401);
    expect(
      (
        await guest.patch("/api/media/" + receipt.id, {
          data: { visibility: "public" },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await guest.post("/api/integrations/items", {
          data: { title: name, visibility: "public" },
        })
      ).status(),
    ).toBe(400);
    const stored = (await (await request.get("/api/media")).json()).find(
      (m: { id: string }) => m.id === receipt.id,
    );
    expect(stored.visibility).toBe("private");
    await request.delete("/api/integration/token");
    expect(
      (
        await guest.post("/api/integrations/items", {
          data: { title: name + " revoked" },
        })
      ).status(),
    ).toBe(401);
  } finally {
    await guest.dispose();
    await request.delete("/api/integration/token");
  }
});

test("discovery remains separate while saving, dismissing and reading", async ({
  page,
  request,
}) => {
  const initial = await (await request.get("/api/bootstrap")).json();
  const article = initial.inbox.find(
    (i: { state: string; url: string }) =>
      i.state === "new" &&
      !initial.media.some((m: { url: string }) => m.url === i.url),
  );
  test.skip(
    !article,
    "Live sources not yet populated; deterministic parsers and states also tested in Go.",
  );
  let savedID: string | undefined;
  const row = page.locator(".article-row").filter({
    has: page.getByRole("link", { name: article.title, exact: true }),
  });
  try {
    await page.goto("/dashboard#discover");
    await page
      .getByRole("searchbox", { name: "Search discoveries" })
      .fill(article.title);
    await row
      .getByRole("button", { name: "Dismiss " + article.title, exact: true })
      .click();
    await page
      .locator(".list-tabs")
      .getByRole("button", { name: "Dismissed", exact: true })
      .click();
    await row.getByRole("button", { name: "Mark new", exact: true }).click();
    await page
      .locator(".list-tabs")
      .getByRole("button", { name: "New", exact: true })
      .click();
    await row.getByRole("button", { name: "Save", exact: true }).click();
    await page
      .locator(".list-tabs")
      .getByRole("button", { name: "Saved", exact: true })
      .click();
    await expect(row.getByText("Saved to library")).toBeVisible();
    const after = await (await request.get("/api/bootstrap")).json();
    const saved = after.media.find(
      (m: { url: string }) => m.url === article.url,
    );
    savedID = saved.id;
    expect(saved).toMatchObject({ status: "pending", visibility: "private" });
    expect(after.media.length).toBe(initial.media.length + 1);
    await request.delete("/api/media/" + savedID);
    savedID = undefined;
    await page.reload();
    await page
      .getByRole("searchbox", { name: "Search discoveries" })
      .fill(article.title);
    await page
      .locator(".list-tabs")
      .getByRole("button", { name: "Read", exact: true })
      .click();
    await expect(
      row.getByRole("button", { name: "Save", exact: true }),
    ).toBeVisible();
  } finally {
    if (savedID) await request.delete("/api/media/" + savedID);
    await request.patch("/api/inbox/" + article.id, {
      data: { state: article.state },
    });
  }
});

test("source auto-save settings persist and dialogs are accessible on mobile and desktop", async ({
  page,
  request,
}) => {
  const sources = await (await request.get("/api/sources")).json();
  const original = sources.find(
    (s: { name: string }) => s.name === "Hugging Face",
  );
  try {
    await page.goto("/dashboard#discover");
    await page.getByRole("button", { name: "Sources", exact: true }).click();
    const row = page.locator(".source-row").filter({
      has: page.getByRole("heading", { name: "Hugging Face", exact: true }),
    });
    const autoSaveText = row.getByText("Auto-save new articles", {
      exact: true,
    });
    const labelBounds = await autoSaveText.boundingBox();
    expect(labelBounds?.width).toBeGreaterThan(100);
    expect(labelBounds?.height).toBeLessThan(24);
    const headingBounds = await row.locator(".source-heading").boundingBox();
    const statusBounds = await row.locator(".source-status").boundingBox();
    expect(labelBounds!.y).toBeGreaterThanOrEqual(
      headingBounds!.y + headingBounds!.height,
    );
    expect(
      statusBounds!.y + statusBounds!.height <= labelBounds!.y ||
        labelBounds!.y + labelBounds!.height <= statusBounds!.y ||
        statusBounds!.x + statusBounds!.width <= labelBounds!.x ||
        labelBounds!.x + labelBounds!.width <= statusBounds!.x,
    ).toBe(true);
    await row
      .getByRole("checkbox", { name: "Auto-save new articles", exact: true })
      .click();
    await expect(row.getByRole("checkbox")).toBeChecked({
      checked: !original.auto_save,
    });
    await page.reload();
    await page.getByRole("button", { name: "Sources", exact: true }).click();
    await expect(row.getByRole("checkbox")).toBeChecked({
      checked: !original.auto_save,
    });
    await checkAccess(page);
    await dialog(page).getByRole("button", { name: "Close dialog" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await checkAccess(page);
    await dialog(page).getByRole("button", { name: "Use light theme" }).click();
    await checkAccess(page);
    await dialog(page).getByRole("button", { name: "Close dialog" }).click();
    await checkAccess(page);
  } finally {
    await request.patch("/api/sources/" + original.id, {
      data: { auto_save: original.auto_save },
    });
  }
});

test("empty library, real discoveries, keyboard navigation and two-state UI remain compact", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/dashboard");
  await expect(
    page.getByText("Something worth keeping?", { exact: true }),
  ).toBeVisible();
  await checkAccess(page);
  await expect(
    page.getByText(
      /In progress|Favorites|Your rating|Your progress|Currently reading/,
    ),
  ).toHaveCount(0);
  await page.keyboard.press("/");
  await expect(
    page.getByRole("searchbox", { name: "Search library" }),
  ).toBeFocused();
  await page.screenshot({
    path: "test-results/library-" + info.project.name + ".png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /^Discover/ }).click();
  await expect(page.getByRole("heading", { name: "Discover." })).toBeVisible();
  await checkAccess(page);
  await page.locator(".skip-link").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#discover$/);
  await expect(page.locator("main")).toBeFocused();
  await page.screenshot({
    path: "test-results/discovery-" + info.project.name + ".png",
    fullPage: false,
  });
  expect(errors).toEqual([]);
});

test("TanStack shortcuts respect typing and dialogs and submit the editor once", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const search = page.getByRole("searchbox", { name: "Search library" });
  await expect(search).toBeVisible();
  const mod = (await page.locator(".search-box kbd").innerText()).includes("⌘")
    ? "Meta"
    : "Control";
  await page.keyboard.press(mod + "+k");
  await expect(search).toBeFocused();
  await search.pressSequentially("n/");
  await expect(search).toHaveValue("n/");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await search.fill("");
  await page.locator("main").focus();
  await page.keyboard.press("n");
  await expect(dialog(page)).toBeVisible();
  const name = title("Keyboard capture");
  const capture = dialog(page).getByRole("textbox", { name: "Title or URL" });
  await capture.fill(name);
  const close = dialog(page).getByRole("button", { name: "Close dialog" });
  await close.focus();
  await page.keyboard.press("n");
  await expect(capture).toHaveValue(name);
  await page.keyboard.press(mod + "+k");
  await expect(close).toBeFocused();
  await capture.focus();
  let submissions = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/media")
      submissions++;
  });
  await page.keyboard.press(mod + "+Enter");
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.locator(".media-row").filter({ hasText: name }),
  ).toBeVisible();
  expect(submissions).toBe(1);
  await page.keyboard.press(mod + "+Shift+a");
  await expect(dialog(page)).toBeVisible();
  await dialog(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
});

test("single-key shortcuts can be disabled without disabling modifier shortcuts", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("searchbox")).toBeVisible();
  const mod = (await page.locator(".search-box kbd").innerText()).includes("⌘")
    ? "Meta"
    : "Control";
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const toggle = page.getByRole("checkbox", {
    name: /Enable single-key shortcuts/,
  });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("searchbox")).toBeVisible();
  await page.locator("main").focus();
  await page.keyboard.press("n");
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox")).not.toBeFocused();
  await expect(dialog(page)).toHaveCount(0);
  await page.keyboard.press(mod + "+k");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.keyboard.press(mod + "+Shift+a");
  await expect(dialog(page)).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await checkAccess(page);
});

test("rows move smoothly and reduced motion removes movement and dialog transitions", async ({
  page,
  request,
}) => {
  const names = [title("Motion first"), title("Motion second")];
  const ids: string[] = [];
  for (const name of names) {
    const response = await request.post("/api/media", {
      data: { title: name },
    });
    expect(response.status()).toBe(201);
    ids.push((await response.json()).id);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/dashboard");
  const rows = page.locator(".media-row");
  await expect(rows).toHaveCount(2);
  const moving = rows.filter({ hasText: names[0] });
  await rows.filter({ hasText: names[1] }).getByRole("checkbox").click();
  await expect(rows).toHaveCount(1);
  expect(
    await moving.evaluate((node) => node.getAnimations().length),
  ).toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() => moving.evaluate((node) => node.getAnimations().length))
    .toBe(0);
  await request.patch("/api/media/" + ids[1], { data: { status: "pending" } });
  await page.reload();
  await expect(rows).toHaveCount(2);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  expect(
    await dialog(page).evaluate((node) =>
      getComputedStyle(node)
        .transitionDuration.split(",")
        .every((duration) => parseFloat(duration) === 0),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
});

test("compact navigation exposes sources and source controls persist without overlap", async ({
  page,
  request,
}, info) => {
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Your library." }),
  ).toBeVisible();
  const header = page.locator(".owner-shell .app-header");
  expect((await header.boundingBox())!.height).toBeLessThanOrEqual(60);
  if (info.project.name === "mobile") {
    await page.setViewportSize({ width: 320, height: 812 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(60);
  }
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Sources", exact: true })
    .click();
  await expect(dialog(page)).toBeVisible();
  for (const name of ["OpenAI", "Anthropic"]) {
    const row = page.getByRole("region", { name, exact: true });
    const image = row.locator(".source-mark img");
    await expect(image).toHaveAttribute(
      "src",
      `/brands/${name.toLowerCase()}.svg`,
    );
    await expect
      .poll(() =>
        image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
  }
  await checkAccess(page);
  await dialog(page).screenshot({
    path: `test-results/sources-${info.project.name}.png`,
  });
  if (info.project.name === "mobile") {
    await page.setViewportSize({ width: 390, height: 844 });
  }

  let created: { id: string; name: string } | undefined;
  try {
    await page
      .getByRole("textbox", { name: "Follow a website or RSS/Atom feed" })
      .fill("https://go.dev/blog/feed.atom");
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === "/api/sources",
    );
    await page.getByRole("button", { name: "Follow", exact: true }).click();
    const result = await response;
    expect(result.status()).toBe(201);
    created = await result.json();
    const row = page.getByRole("region", { name: created!.name, exact: true });
    await expect(row).toBeVisible();
    await row
      .getByRole("button", { name: "Pause " + created!.name, exact: true })
      .click();
    await expect(
      row.getByRole("button", { name: "Resume " + created!.name, exact: true }),
    ).toBeEnabled();
    await expect(
      row.getByText("Collection paused", { exact: true }),
    ).toBeVisible();
    await row
      .getByRole("combobox", { name: "Check frequency for " + created!.name })
      .click();
    await page.getByRole("option", { name: "Every 6h", exact: true }).click();
    await expect(row.getByRole("combobox")).toContainText("Every 6h");
    await page.reload();
    await page.getByRole("button", { name: "Sources", exact: true }).click();
    await expect(row.getByRole("combobox")).toContainText("Every 6h");
    await row
      .getByRole("button", { name: "Resume " + created!.name, exact: true })
      .click();
    await expect(
      row.getByRole("button", { name: "Pause " + created!.name, exact: true }),
    ).toBeEnabled();
    await row
      .getByRole("button", { name: "Remove " + created!.name, exact: true })
      .click();
    await row.getByRole("button", { name: "Unfollow", exact: true }).click();
    await expect(row).toHaveCount(0);
  } finally {
    if (created) await request.delete("/api/sources/" + created.id);
  }
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Your library." }),
  ).toBeVisible();
});

test("keyboard-only library navigation supports opening, editing, completion, undo and removal", async ({
  page,
  request,
}) => {
  for (const label of ["Keyboard first", "Keyboard second", "Keyboard third"]) {
    expect(
      (
        await request.post("/api/media", { data: { title: title(label) } })
      ).status(),
    ).toBe(201);
  }
  await page.goto("/dashboard");
  const rows = page.locator(".media-row");
  await expect(rows).toHaveCount(3);
  const mod = await modifier(page);
  await page.keyboard.press("/");
  await page.keyboard.insertText("Keyboard");
  await page.keyboard.press("ArrowDown");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("k");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(rows.first()).toBeFocused();
  const firstID = await rows.first().getAttribute("data-row-id");
  await page.keyboard.press("Enter");
  await expect(
    dialog(page).getByRole("textbox", { name: "Title", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("d");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press(mod + "+z");
  await expect(rows).toHaveCount(3);
  expect(
    (await (await request.get("/api/media")).json()).find(
      (item: { id: string }) => item.id === firstID,
    ).status,
  ).toBe("pending");
  await page.keyboard.press("Home");
  await page.keyboard.press("e");
  const field = dialog(page).getByRole("textbox", {
    name: "Title",
    exact: true,
  });
  await tabTo(page, field);
  const renamed = title("Keyboard edited");
  await page.keyboard.press(mod + "+a");
  await page.keyboard.insertText(renamed);
  await page.keyboard.press(mod + "+Enter");
  await expect(dialog(page)).toHaveCount(0);
  const edited = rows.filter({ hasText: renamed });
  await expect(edited).toBeVisible();
  await expect(edited).toBeFocused();
  await page.keyboard.press("e");
  await tabTo(
    page,
    dialog(page).getByRole("button", { name: "Remove", exact: true }),
  );
  await page.keyboard.press("Enter");
  await tabTo(
    page,
    dialog(page).getByRole("button", { name: "Remove item", exact: true }),
  );
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toHaveCount(0);
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("F1");
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(rows.first()).toBeFocused();
});

test("keyboard navigation reaches items beyond the first page", async ({
  page,
  request,
}, info) => {
  for (let i = 0; i < 44; i++) {
    expect(
      (
        await request.post("/api/media", {
          data: { title: title("Keyboard page " + i), tags: ["keyboard-nav"] },
        })
      ).status(),
    ).toBe(201);
  }
  await page.goto("/dashboard");
  const rows = page.locator(".media-row");
  await expect(rows).toHaveCount(40);
  await page.keyboard.press("End");
  await expect(rows).toHaveCount(44);
  await expect(rows.last()).toBeFocused();
  if (info.project.name === "desktop") {
    const hiddenID = await rows.last().getAttribute("data-row-id");
    await tabTo(
      page,
      rows.last().getByRole("button", { name: "keyboard-nav", exact: true }),
    );
    await page.keyboard.press("Enter");
    await expect(rows).toHaveCount(40);
    await expect(rows.last()).toBeFocused();
    await page.keyboard.press("d");
    await expect
      .poll(
        async () =>
          (await (await request.get("/api/media")).json()).filter(
            (item: { status: string }) => item.status === "done",
          ).length,
      )
      .toBe(1);
    expect(
      (await (await request.get("/api/media")).json()).find(
        (item: { id: string }) => item.id === hiddenID,
      ).status,
    ).toBe("pending");
    const mod = await modifier(page);
    await page.keyboard.press(mod + "+z");
    await expect
      .poll(
        async () =>
          (await (await request.get("/api/media")).json()).filter(
            (item: { status: string }) => item.status === "done",
          ).length,
      )
      .toBe(0);
    await page.keyboard.press("End");
    await expect(rows).toHaveCount(44);
    await expect(rows.last()).toBeFocused();
  }
  await page.keyboard.press("ArrowUp");
  await expect(rows.nth(42)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("g");
  await page.keyboard.press("d");
  await expect(page.getByRole("heading", { name: "Discover." })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("l");
  await expect(
    page.getByRole("heading", { name: "Your library." }),
  ).toBeVisible();
});

test("keyboard-only discovery supports save, read, dismiss, undo and opening the original article", async ({
  page,
  request,
  context,
}) => {
  const initial = await (await request.get("/api/bootstrap")).json();
  const states = new Map(
    initial.inbox.map((item: { id: string; state: string }) => [
      item.id,
      item.state,
    ]),
  );
  const changed = new Set<string>();
  const beforeIDs = new Set(
    initial.media.map((item: { id: string }) => item.id),
  );
  let savedURL: string | undefined;
  try {
    await page.goto("/dashboard#discover");
    const rows = page.locator(".article-row");
    await expect(rows.first()).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(rows.first()).toBeFocused();
    const savedID = (await rows.first().getAttribute("data-row-id"))!;
    savedURL =
      (await rows.first().locator(".item-title").getAttribute("href")) ||
      undefined;
    changed.add(savedID);
    await page.keyboard.press("s");
    await expect(page.locator(`[data-row-id="${savedID}"]`)).toHaveCount(0);
    await expect(rows.first()).toBeFocused();
    const readID = (await rows.first().getAttribute("data-row-id"))!;
    changed.add(readID);
    await page.keyboard.press("r");
    await expect(page.locator(`[data-row-id="${readID}"]`)).toHaveCount(0);
    await expect(rows.first()).toBeFocused();
    const dismissedID = (await rows.first().getAttribute("data-row-id"))!;
    changed.add(dismissedID);
    await page.keyboard.press("x");
    await expect(page.locator(`[data-row-id="${dismissedID}"]`)).toHaveCount(0);
    const mod = await modifier(page);
    await page.keyboard.press(mod + "+z");
    await expect(page.locator(`[data-row-id="${dismissedID}"]`)).toHaveCount(1);
    await page.keyboard.press("]");
    await expect(
      page
        .locator(".list-tabs")
        .getByRole("button", { name: "Saved", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("]");
    await expect(
      page
        .locator(".list-tabs")
        .getByRole("button", { name: "Read", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Home");
    await expect(rows.first()).toBeFocused();
    await page.keyboard.press("r");
    await expect(page.locator(`[data-row-id="${readID}"]`)).toHaveCount(0);
    await page.keyboard.press("[");
    await page.keyboard.press("[");
    await page.keyboard.press("Home");
    const openID = (await rows.first().getAttribute("data-row-id"))!;
    const openURL = await rows
      .first()
      .locator(".item-title")
      .getAttribute("href");
    changed.add(openID);
    const opened = context.waitForEvent("page");
    await page.keyboard.press("Enter");
    const original = await opened;
    await expect.poll(() => original.url()).toBe(openURL);
    await original.close();
    await page.bringToFront();
    await expect(page.locator(`[data-row-id="${openID}"]`)).toHaveCount(0);
    await page.keyboard.press("g");
    await page.keyboard.press("s");
    await expect(
      page.getByRole("heading", { name: "Your sources" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
  } finally {
    if (savedURL) {
      const media = await (await request.get("/api/media")).json();
      for (const item of media)
        if (item.url === savedURL && !beforeIDs.has(item.id))
          await request.delete("/api/media/" + item.id);
    }
    for (const id of changed)
      await request.patch("/api/inbox/" + id, {
        data: { state: states.get(id) },
      });
  }
});

test("dark is the default, settings has a full hit area, and theme persists through portals", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("margin-appearance", "light"),
  );
  await page.goto("/dashboard");
  await expect(page.locator(".app-theme")).toHaveAttribute(
    "data-appearance",
    "dark",
  );
  const settings = page.getByRole("button", {
    name: "Settings",
    exact: true,
    includeHidden: true,
  });
  const bounds = (await settings.boundingBox())!;
  expect(bounds.width).toBeGreaterThanOrEqual(32);
  expect(bounds.height).toBeGreaterThanOrEqual(32);
  const iconFits = await settings.locator("svg").evaluate((svg) => {
    const box = (svg as SVGGraphicsElement).getBBox();
    return (
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= 24 &&
      box.y + box.height <= 24
    );
  });
  expect(iconFits).toBe(true);
  await page.mouse.click(bounds.x + 3, bounds.y + 3);
  await expect(dialog(page)).toBeVisible();
  await expect(settings).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".u-dialog-theme")).toHaveAttribute(
    "data-appearance",
    "dark",
  );
  expect((await dialog(page).boundingBox())!.height).toBeLessThanOrEqual(650);
  await page.keyboard.press("F1");
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await dialog(page).screenshot({
    path: `test-results/settings-dark-${test.info().project.name}.png`,
  });
  const mod = await modifier(page);
  await tabTo(
    page,
    dialog(page).getByRole("button", { name: "Use light theme" }),
  );
  await page.keyboard.press("Enter");
  await expect(page.locator(".u-dialog-theme")).toHaveAttribute(
    "data-appearance",
    "light",
  );
  await page.keyboard.press("Escape");
  await expect(settings).toBeFocused();
  await page.reload();
  await expect(page.locator(".app-theme")).toHaveAttribute(
    "data-appearance",
    "light",
  );
  await page.keyboard.press(mod + "+,");
  await expect(dialog(page)).toBeVisible();
  await tabTo(
    page,
    dialog(page).getByRole("button", { name: "Use dark theme" }),
  );
  await page.keyboard.press("Enter");
  await checkAccess(page);
});

test("public root stays a Collection for visitors and signed-in owners", async ({
  page,
  request,
  browser,
}) => {
  const name = title("Collection book");
  await request.post("/api/media", {
    data: { title: name, kind: "book", visibility: "public" },
  });
  for (const signedIn of [true, false]) {
    const guest = signedIn ? undefined : await browser.newContext();
    const surface = guest ? await guest.newPage() : page;
    await surface.goto(baseURL + "/");
    await expect(
      surface.getByRole("heading", { name: "Collection." }),
    ).toBeVisible();
    await expect(surface.getByRole("link", { name })).toBeVisible();
    await expect(
      surface.getByRole("link", { name: /sign in|private library/i }),
    ).toHaveCount(0);
    await expect(
      surface.getByRole("button", { name: "Settings", exact: true }),
    ).toHaveCount(0);
    const cover = surface.locator(".collection-card .mini-cover");
    expect((await cover.boundingBox())!.height).toBeGreaterThanOrEqual(96);
    expect((await cover.boundingBox())!.height).toBeLessThanOrEqual(160);
    await checkAccess(surface);
    await guest?.close();
  }
});

test("metadata lookup never blocks saving", async ({ page, request }) => {
  const name = title("Fast capture");
  await page.route("**/api/metadata", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route
      .fulfill({
        json: {
          title: "Late metadata",
          author: "Late creator",
          kind: "article",
          url: "https://example.com/fast",
          cover_url: "",
          description: "",
        },
      })
      .catch(() => {});
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await dialog(page)
    .getByRole("textbox", { name: "Title or URL" })
    .fill("https://example.com/fast-" + Date.now());
  await dialog(page)
    .getByRole("textbox", { name: "Title", exact: true })
    .fill(name);
  await expect(
    dialog(page).getByRole("button", { name: "Add to library", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press((await modifier(page)) + "+Enter");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  expect(
    (await (await request.get("/api/media")).json()).find(
      (m: { title: string }) => m.title === name,
    ),
  ).toBeTruthy();
});

test("book ISBN resolves automatically with an optional keyboard correction", async ({
  page,
  request,
}) => {
  const first = title("Automatic edition"),
    second = title("Corrected edition");
  await page.route("**/api/books/search", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            title: first,
            author: "First writer",
            kind: "book",
            url: "https://openlibrary.org/books/OL1M",
            cover_url: "",
            description: "",
          },
          {
            title: second,
            author: "Second writer",
            kind: "book",
            url: "https://openlibrary.org/books/OL2M",
            cover_url: "",
            description: "",
          },
        ],
      },
    }),
  );
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await dialog(page)
    .getByRole("textbox", { name: "Title or URL" })
    .fill("9780132350884");
  await expect(
    dialog(page).getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue(first);
  await dialog(page)
    .getByRole("button", { name: "Correct book match" })
    .click();
  const radio = dialog(page).getByRole("radio");
  await expect(radio.first()).toBeChecked();
  await radio.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(radio.nth(1)).toBeChecked();
  await page.keyboard.press((await modifier(page)) + "+Enter");
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: second, exact: true }),
  ).toBeVisible();
  const item = (await (await request.get("/api/media")).json()).find(
    (m: { title: string }) => m.title === second,
  );
  expect(item).toMatchObject({
    kind: "book",
    author: "Second writer",
    url: "https://openlibrary.org/books/OL2M",
  });
});

test("external captures are reviewed explicitly without changing completion", async ({
  page,
  request,
}) => {
  const name = title("External review");
  const token = (await (await request.post("/api/integration/token")).json())
    .token;
  const receipt = await request.post("/api/integrations/items", {
    headers: { Authorization: "Bearer " + token },
    data: { title: name },
  });
  expect(receipt.status()).toBe(201);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /To review/ }).click();
  const row = page.locator(".media-row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByRole("checkbox")).not.toBeChecked();
  await page.reload();
  await page.getByRole("button", { name: /To review/ }).click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Mark reviewed: " + name }).click();
  await expect(row).toHaveCount(0);
  const item = (await (await request.get("/api/media")).json()).find(
    (m: { title: string }) => m.title === name,
  );
  expect(item).toMatchObject({ needs_review: false, status: "pending" });
});

test("local image uploads resize before sending and preserve private access", async ({
  page,
  request,
  playwright,
}) => {
  const name = title("Custom image");
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await dialog(page).getByRole("textbox", { name: "Title or URL" }).fill(name);
  await page.keyboard.press((await modifier(page)) + "+Shift+d");
  const fixture = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 3200;
    canvas.height = 2400;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#89cdb0";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const upload = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/images",
  );
  await dialog(page)
    .getByLabel("Upload image")
    .setInputFiles({
      name: "large-cover.png",
      mimeType: "image/png",
      buffer: Buffer.from(fixture, "base64"),
    });
  const uploaded = await upload;
  expect(uploaded.status()).toBe(201); // Server rejects unresized images over 1600px.
  const path = (await uploaded.json()).url;
  await expect(
    dialog(page).getByRole("textbox", { name: "Image URL (optional)" }),
  ).toHaveValue(path);
  await page.keyboard.press((await modifier(page)) + "+Enter");
  await expect(dialog(page)).toHaveCount(0);
  const row = page.locator(".media-row").filter({ hasText: name });
  await expect(row.locator("img")).toBeVisible();
  await expect
    .poll(() =>
      row
        .locator("img")
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBe(1600);
  const guest = await playwright.request.newContext({ baseURL });
  expect((await guest.get(path)).status()).toBe(404);
  expect((await request.get(path)).status()).toBe(200);
  await guest.dispose();
});

test("late metadata preserves manual title and custom image edits", async ({
  page,
}) => {
  const name = title("Manual metadata correction");
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/metadata", async (route) => {
    started();
    await released;
    await route.fulfill({
      json: {
        title: "Publisher title",
        author: "Publisher creator",
        kind: "article",
        url: "https://example.com/manual",
        cover_url: "https://example.com/publisher.jpg",
        description: "Publisher description",
      },
    });
  });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await dialog(page)
    .getByRole("textbox", { name: "Title or URL" })
    .fill("https://example.com/manual-" + Date.now());
  await requested;
  await dialog(page)
    .getByRole("textbox", { name: "Title", exact: true })
    .fill(name);
  await page.keyboard.press((await modifier(page)) + "+Shift+d");
  await dialog(page)
    .getByRole("textbox", { name: "Image URL (optional)" })
    .fill("https://example.com/custom.jpg");
  const fetched = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/metadata",
  );
  release();
  await fetched;
  await expect(
    dialog(page).getByRole("textbox", { name: "Creator (optional)" }),
  ).toHaveValue("Publisher creator");
  await expect(
    dialog(page).getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue(name);
  await expect(
    dialog(page).getByRole("textbox", { name: "Image URL (optional)" }),
  ).toHaveValue("https://example.com/custom.jpg");
});

test("development shortcut loads all kinds once and clears only its fixtures", async ({
  page,
  request,
  browser,
}, info) => {
  const bootstrap = await (await request.get("/api/bootstrap")).json();
  test.skip(
    !bootstrap.dev_mode,
    "Requires MARGIN_DEV_MODE=1 on the disposable test instance.",
  );
  const realTitle = title("Keep beside demo data");
  const real = await (
    await request.post("/api/media", {
      data: { title: realTitle, tags: ["demo"] },
    })
  ).json();
  await request.delete("/api/dev/fixtures");
  try {
    await page.goto("/dashboard");
    await expect(
      page.getByRole("region", { name: "Development tools", exact: true }),
    ).toBeVisible();
    await page.locator("main").focus();
    await page.keyboard.press("g");
    await page.keyboard.press("m");
    await expect(
      page.locator(".media-row").filter({ hasText: "[Demo]" }),
    ).toHaveCount(9);
    const compactWidths =
      (page.viewportSize()?.width || 1440) < 600 ? [320, 390] : [1440];
    for (const width of compactWidths) {
      await page.setViewportSize({ width, height: 844 });
      for (const row of await page.locator(".media-row").all()) {
        expect((await row.boundingBox())!.height).toBeLessThanOrEqual(
          width < 600 ? 120 : 96,
        );
      }
      expect(
        await page
          .locator(".list-tabs")
          .evaluate((tabs) => tabs.scrollWidth - tabs.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    await page
      .getByRole("button", { name: "Dismiss notification", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Dismiss notification", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: "test-results/populated-library-" + info.project.name + ".png",
      fullPage: true,
      animations: "disabled",
    });
    const loaded = await (await request.get("/api/bootstrap")).json();
    expect(loaded.dev_fixture_count).toBe(9);
    expect(
      new Set(
        loaded.media
          .filter((m: { title: string }) => m.title.startsWith("[Demo]"))
          .map((m: { kind: string }) => m.kind),
      ).size,
    ).toBe(9);
    await request.post("/api/dev/fixtures");
    expect(
      (await (await request.get("/api/bootstrap")).json()).dev_fixture_count,
    ).toBe(9);
    const guest = await browser.newContext();
    try {
      const publicPage = await guest.newPage();
      await publicPage.goto(baseURL + "/");
      await expect(
        publicPage.locator(".collection-card").filter({ hasText: "[Demo]" }),
      ).toHaveCount(9);
      for (const width of compactWidths) {
        await publicPage.setViewportSize({ width, height: 844 });
        const cards = publicPage.locator(".collection-card");
        for (const card of await cards.all()) {
          const bounds = (await card.boundingBox())!;
          expect(bounds.height).toBeLessThanOrEqual(width < 600 ? 220 : 360);
          if (width < 600) {
            const cover = (await card.locator(".mini-cover").boundingBox())!;
            const copy = (await card
              .locator(".collection-copy")
              .boundingBox())!;
            expect(copy.x).toBeGreaterThanOrEqual(cover.x + cover.width);
          }
        }
        await checkAccess(publicPage);
        await publicPage.screenshot({
          path: "test-results/populated-collection-" + width + ".png",
          fullPage: true,
          animations: "disabled",
        });
      }
      const images = publicPage.locator(".collection-card img");
      for (const image of await images.all()) {
        await image.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            image.evaluate(
              (element) => (element as HTMLImageElement).naturalWidth,
            ),
          )
          .toBeGreaterThan(0);
      }
      await checkAccess(publicPage);
    } finally {
      await guest.close();
    }
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await dialog(page).getByText("Development", { exact: true }).click();
    await dialog(page)
      .getByRole("button", { name: "Clear demo data", exact: true })
      .click();
    await expect(
      dialog(page).getByRole("button", { name: "Load demo data", exact: true }),
    ).toBeVisible();
    expect(
      (await (await request.get("/api/media")).json()).some(
        (m: { id: string }) => m.id === real.id,
      ),
    ).toBe(true);
    expect(
      (await (await request.get("/api/bootstrap")).json()).dev_fixture_count,
    ).toBe(0);
  } finally {
    await request.delete("/api/dev/fixtures");
  }
});

test("whole public cards open from covers, copy, padding and keyboard", async ({
  page,
  context,
  request,
}) => {
  const name = title("Whole public card");
  const manualName = title("Public card without a URL");
  const url = "https://reader.example/article";
  await context.route("https://reader.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Original article</h1>",
    }),
  );
  for (const data of [
    {
      title: name,
      url,
      description: "Read the whole story.",
      author: "Writer",
    },
    { title: manualName },
  ]) {
    expect(
      (
        await request.post("/api/media", {
          data: { ...data, kind: "article", visibility: "public" },
        })
      ).status(),
    ).toBe(201);
  }
  await page.goto("/");
  const card = page.locator(".collection-card").filter({ hasText: name });
  const open = async (click: () => Promise<unknown>) => {
    const popup = page.waitForEvent("popup");
    await click();
    const original = await popup;
    await expect(original).toHaveURL(url);
    await original.close();
  };
  await open(() => card.locator(".mini-cover").click());
  await open(() => card.getByText("Read the whole story.").click());
  await open(() => card.click({ position: { x: 3, y: 3 } }));
  await card.getByRole("link", { name, exact: true }).focus();
  await open(() => page.keyboard.press("Enter"));
  await checkAccess(page);
  await page
    .locator(".collection-card")
    .filter({ hasText: manualName })
    .locator(".mini-cover")
    .click();
  await expect(page).toHaveURL(/\/shared\/[a-z0-9-]+$/);
  await expect(page.getByRole("heading", { name: manualName })).toBeVisible();
});

test("compact library rows open from covers and whitespace while controls stay independent", async ({
  page,
  context,
  request,
}) => {
  const name = title("Whole library row");
  const manualName = title("Library row without a URL");
  const url = "https://reader.example/article";
  await context.route("https://reader.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Original article</h1>",
    }),
  );
  for (const data of [
    {
      title: name,
      url,
      author: "Writer",
      tags: ["reading"],
      needs_review: true,
    },
    { title: manualName },
  ]) {
    expect((await request.post("/api/media", { data })).status()).toBe(201);
  }
  await page.goto("/dashboard");
  await page
    .locator(".list-tabs")
    .getByRole("button", { name: "All", exact: true })
    .click();
  const row = page.locator(".media-row").filter({ hasText: name });
  const manual = page.locator(".media-row").filter({ hasText: manualName });
  // Use real pointer coordinates: the native stretched link covers these elements.
  const clickBody = async (target: Locator, x = 0.5, y = 0.5) => {
    await target.scrollIntoViewIfNeeded();
    const bounds = (await target.boundingBox())!;
    await page.mouse.click(
      bounds.x + bounds.width * x,
      bounds.y + bounds.height * y,
    );
  };
  const open = async (click: () => Promise<unknown>) => {
    const popup = page.waitForEvent("popup");
    await click();
    const original = await popup;
    await expect(original).toHaveURL(url);
    await original.close();
  };
  await expect(row).toBeVisible();
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(
    (page.viewportSize()?.width || 1440) < 600 ? 140 : 96,
  );
  expect((await manual.boundingBox())!.height).toBeLessThanOrEqual(96);
  await open(() => clickBody(row.locator(".mini-cover")));
  await open(() => clickBody(row.locator(".item-meta > span")));
  await open(() => clickBody(row, 0.65, 0.95));
  await row.getByRole("link", { name, exact: true }).focus();
  await open(() => page.keyboard.press("Enter"));
  const popups: Page[] = [];
  page.on("popup", (popup) => popups.push(popup));
  const checkbox = row.getByRole("checkbox");
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await checkbox.press("Space");
  await expect(checkbox).not.toBeChecked();
  const edit = row.getByRole("button", { name: "Edit " + name, exact: true });
  await edit.click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await edit.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await dialog(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await row
    .getByRole("button", { name: "Edit missing details: " + name })
    .click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  if ((page.viewportSize()?.width || 1440) >= 600) {
    await row.getByRole("button", { name: "reading", exact: true }).click();
  } else {
    await page
      .getByRole("combobox", { name: "Filter tag", exact: true })
      .click();
    await page.getByRole("option", { name: "reading", exact: true }).click();
  }
  await expect(manual).toHaveCount(0);
  await row.getByRole("button", { name: "Mark reviewed: " + name }).click();
  await expect(row.getByRole("button", { name: /Mark reviewed/ })).toHaveCount(
    0,
  );
  expect(popups).toHaveLength(0);
  await page.reload();
  await page
    .locator(".list-tabs")
    .getByRole("button", { name: "All", exact: true })
    .click();
  await clickBody(manual.locator(".mini-cover"));
  await expect(
    dialog(page).getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue(manualName);
  await dialog(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(popups).toHaveLength(0);
  await checkAccess(page);
});

test("public cards align across wrapped titles and missing details", async ({
  page,
  request,
}) => {
  const names = [
    title("Short title"),
    title("A long title that wraps across two lines in the public collection"),
    title("Another title"),
  ];
  for (let i = 0; i < names.length; i++) {
    const response = await request.post("/api/media", {
      data: {
        title: names[i],
        kind: ["book", "video", "article"][i],
        visibility: "public",
        author:
          i === 1
            ? "A creator name long enough to otherwise wrap onto extra lines"
            : "Demo creator",
        description:
          i === 1
            ? ""
            : "A description that can occupy two lines without changing the alignment of nearby cards.",
        tags: i === 0 ? ["design", "a-long-tag-to-check-overflow"] : [],
      },
    });
    expect(response.status()).toBe(201);
  }
  await page.goto("/");
  await expect(page.locator(".collection-card")).toHaveCount(3);
  const widths =
    (page.viewportSize()?.width || 1440) < 600 ? [320, 390] : [1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await page.locator(".collection-card").evaluateAll((cards) =>
      cards.map((card) => {
        const bounds = card.getBoundingClientRect();
        const offset = (selector: string) =>
          card.querySelector(selector)!.getBoundingClientRect().top -
          bounds.top;
        return {
          height: bounds.height,
          author: offset(".item-meta"),
          description: offset(".shared-description"),
          tags: offset(".shared-tags"),
          status: offset(".shared-status"),
        };
      }),
    );
    for (const key of [
      "height",
      "author",
      "description",
      "tags",
      "status",
    ] as const) {
      const values = layout.map((card) => card[key]);
      expect(
        Math.max(...values) - Math.min(...values),
        `${key} should align at ${width}px`,
      ).toBeLessThanOrEqual(1);
    }
    await checkAccess(page);
  }
});

test("retry recovers an existing capture and saving preserves review context", async ({
  page,
  request,
}) => {
  const name = title("Recovered article");
  const url = "https://publisher.example/recoverable-article-" + Date.now();
  const response = await request.post("/api/media", {
    data: {
      title: name,
      author: "",
      kind: "article",
      url,
      cover_url: "",
      description: "",
      metadata_warning: "Site did not share details.",
      needs_review: true,
      notes: "Private thought",
    },
  });
  expect(response.status()).toBe(201);
  const item = await response.json();
  try {
    await page.route("**/api/metadata", (route) =>
      route.fulfill({
        json: {
          title: "Publisher replacement",
          author: "Publisher writer",
          kind: "article",
          url,
          cover_url: "",
          description: "Recovered page summary",
        },
      }),
    );
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /To review/ }).click();
    await page
      .getByRole("searchbox", { name: "Search library" })
      .fill("publisher.example");
    const row = page.locator(".media-row").filter({ hasText: name });
    await expect(row).toBeVisible();
    await row
      .getByRole("button", { name: "Edit " + name, exact: true })
      .click();
    await expect(
      dialog(page).getByRole("textbox", { name: "URL (optional)" }),
    ).toHaveValue(url);
    await dialog(page)
      .getByRole("button", { name: "Retry details", exact: true })
      .click();
    await expect(
      dialog(page).getByRole("region", { name: "Link details" }),
    ).toContainText("Recovered page summary");
    await expect(
      dialog(page).getByRole("textbox", { name: "Title", exact: true }),
    ).toHaveValue(name);
    await dialog(page)
      .getByRole("button", { name: "Save & review", exact: true })
      .click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /To review/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("searchbox", { name: "Search library" }),
    ).toHaveValue("publisher.example");
    const stored = (await (await request.get("/api/media")).json()).find(
      (m: { id: string }) => m.id === item.id,
    );
    expect(stored).toMatchObject({
      title: name,
      author: "Publisher writer",
      description: "Recovered page summary",
      notes: "Private thought",
      needs_review: false,
      status: "pending",
      metadata_state: "ready",
    });
  } finally {
    await request.delete("/api/media/" + item.id);
  }
});

test("review actions undo cleanly and mobile row actions stay aligned", async ({
  page,
  request,
}) => {
  const name = title("A capture that still needs review");
  const item = await (
    await request.post("/api/media", {
      data: { title: name, needs_review: true, status: "done" },
    })
  ).json();
  try {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /To review/ }).click();
    const row = page.locator(".media-row").filter({ hasText: name });
    await expect(row).toBeVisible();
    if ((page.viewportSize()?.width || 1440) < 600) {
      for (const width of [320, 390, 570]) {
        await page.setViewportSize({ width, height: 844 });
        const edit = (await row
          .getByRole("button", { name: "Edit " + name, exact: true })
          .boundingBox())!;
        const content = (await row.locator(".row-content").boundingBox())!;
        expect(edit.x).toBeGreaterThanOrEqual(content.x + content.width);
        expect((await row.boundingBox())!.height).toBeLessThanOrEqual(180);
        await checkAccess(page);
      }
    }
    await row.getByRole("button", { name: "Mark reviewed: " + name }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(row).toBeVisible();
    expect(
      (await (await request.get("/api/media")).json()).find(
        (m: { id: string }) => m.id === item.id,
      ),
    ).toMatchObject({ needs_review: true, status: "done" });
  } finally {
    await request.delete("/api/media/" + item.id);
  }
});

test("changing a URL ignores late background details from its previous page", async ({
  page,
  request,
}) => {
  const name = title("URL change while fetching");
  const firstURL = "https://publisher.example/first";
  const nextURL = "https://publisher.example/next";
  const created = await (
    await request.post("/api/media", {
      data: {
        title: name,
        author: "",
        kind: "article",
        cover_url: "",
        description: "",
        url: firstURL,
      },
    })
  ).json();
  let finished = false;
  await page.route("**/api/bootstrap", async (route) => {
    const original = await route.fetch();
    const data = await original.json();
    data.media = data.media.map((item: { id: string }) =>
      item.id === created.id
        ? {
            ...item,
            url: firstURL,
            author: finished ? "Old page author" : "",
            description: finished ? "Old page description" : "",
            metadata_state: finished ? "ready" : "pending",
            updated_at: finished
              ? "2030-01-02T00:00:00Z"
              : "2030-01-01T00:00:00Z",
          }
        : item,
    );
    await route.fulfill({ json: data });
  });
  try {
    await page.goto("/dashboard");
    await page
      .getByRole("button", { name: "Edit " + name, exact: true })
      .click();
    await dialog(page)
      .getByRole("textbox", { name: "URL (optional)" })
      .fill(nextURL);
    finished = true;
    const refreshed = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/bootstrap",
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await refreshed;
    await dialog(page)
      .getByText("Details, image & note", { exact: true })
      .click();
    await expect(
      dialog(page).getByRole("textbox", { name: "Creator (optional)" }),
    ).toHaveValue("");
    await expect(
      dialog(page).getByRole("textbox", { name: "Description (optional)" }),
    ).toHaveValue("");
    const patch = page.waitForRequest(
      (r) =>
        r.method() === "PATCH" &&
        new URL(r.url()).pathname === "/api/media/" + created.id,
    );
    await dialog(page)
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    expect((await patch).postDataJSON()).toMatchObject({
      url: nextURL,
      fetch_metadata: true,
      author: "",
      description: "",
    });
    await expect(dialog(page)).toHaveCount(0);
  } finally {
    await request.delete("/api/media/" + created.id);
  }
});

test("a duplicate quick save stops its spinner and allows metadata retry", async ({
  page,
  request,
}) => {
  const name = title("Duplicate metadata recovery");
  const url = "https://publisher.example/duplicate-" + Date.now();
  const existing = await (
    await request.post("/api/media", {
      data: {
        title: name,
        url,
        author: "",
        kind: "article",
        cover_url: "",
        description: "",
      },
    })
  ).json();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route("**/api/metadata", async (route) => {
    calls++;
    if (calls === 1) await gate;
    await route
      .fulfill({
        json: {
          title: name,
          author: "Recovered writer",
          kind: "article",
          url,
          cover_url: "",
          description: "Recovered summary",
        },
      })
      .catch(() => {});
  });
  try {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    await dialog(page).getByRole("textbox", { name: "Title or URL" }).fill(url);
    await expect(
      dialog(page).getByText("Finding details… You can save now."),
    ).toBeVisible();
    await dialog(page)
      .getByRole("button", { name: "Add to library", exact: true })
      .click();
    await expect(
      dialog(page).getByRole("button", { name: "Open existing item" }),
    ).toBeVisible();
    await expect(
      dialog(page).getByText("Finding details… You can save now."),
    ).toHaveCount(0);
    release();
    await dialog(page)
      .getByRole("button", { name: "Find missing details", exact: true })
      .click();
    await expect(
      dialog(page).getByRole("region", { name: "Link details" }),
    ).toContainText("Recovered summary");
    await expect(
      dialog(page).getByRole("button", {
        name: "Find missing details",
        exact: true,
      }),
    ).toBeEnabled();
  } finally {
    release();
    await request.delete("/api/media/" + existing.id);
  }
});
