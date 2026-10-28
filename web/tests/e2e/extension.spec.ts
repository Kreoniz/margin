import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve, sep } from "node:path";

async function extensionPage(
  page: Page,
  file: string,
  overrides: Record<string, unknown> = {},
) {
  await page.addInitScript((overrides) => {
    const state = Object.assign(
      {
        saved: { origin: "https://margin.example", token: "q".repeat(43) },
        allowed: true,
        grant: true,
        pending: false,
        tab: {
          id: 7,
          url: "https://openai.com/index/scaling-postgresql/",
          title: "Scaling PostgreSQL to power 800 million ChatGPT users",
        },
        commands: [
          { name: "_execute_action", shortcut: "Ctrl+Shift+Y" },
          { name: "save-page", shortcut: "" },
          { name: "done-page", shortcut: "" },
        ],
        reply: {
          result: {
            id: "item-7",
            created: true,
            editURL: "https://margin.example/dashboard#edit=item-7",
          },
        },
        captures: [],
        permissions: [],
        removed: [],
        tabs: [],
        optionsOpened: 0,
        finish: () => {},
      },
      overrides,
    ) as any;
    (window as any).__extensionTest = state;
    (window as any).chrome = {
      storage: {
        local: {
          get: async () => state.saved,
          set: async (value: unknown) => {
            state.saved = value;
          },
        },
      },
      permissions: {
        contains: async () => state.allowed,
        request: async (value: unknown) => {
          state.permissions.push(value);
          return state.grant;
        },
        remove: async (value: unknown) => {
          state.removed.push(value);
          return true;
        },
      },
      commands: { getAll: async () => state.commands },
      tabs: {
        query: async () => [state.tab],
        create: async (value: unknown) => {
          state.tabs.push(value);
        },
      },
      runtime: {
        openOptionsPage: async () => {
          state.optionsOpened++;
        },
        sendMessage: async (value: unknown) => {
          state.captures.push(value);
          if (state.pending)
            await new Promise<void>((resolve) => {
              state.finish = resolve;
            });
          return state.reply;
        },
      },
    };
  }, overrides);
  const root = resolve("../extension");
  const types: Record<string, string> = {
    html: "text/html",
    js: "text/javascript",
    css: "text/css",
    png: "image/png",
    woff2: "font/woff2",
  };
  await page.route("https://extension.test/**", async (route) => {
    const filename = resolve(
      root,
      new URL(route.request().url()).pathname.slice(1),
    );
    if (!filename.startsWith(root + sep)) return route.abort();
    await route.fulfill({
      path: filename,
      contentType: types[filename.split(".").at(-1)!] || "text/plain",
    });
  });
  await page.goto("https://extension.test/" + file);
}

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

test("extension popup previews the page and supports independent capture, focus keys and recovery", async ({
  page,
}, info) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await extensionPage(page, "popup.html");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Scaling PostgreSQL to power 800 million ChatGPT users",
  );
  const save = page.getByRole("button", { name: /Save for later/ });
  const done = page.getByRole("button", { name: /Mark done/ });
  await expect(save).toBeEnabled();
  await accessible(page);
  await page.locator("main").screenshot({
    path: "test-results/extension-popup-dark-" + info.project.name + ".png",
  });
  await page.emulateMedia({ colorScheme: "light" });
  await accessible(page);
  await page.locator("main").screenshot({
    path: "test-results/extension-popup-light-" + info.project.name + ".png",
  });
  await page.keyboard.press("s");
  await expect(page.getByRole("status")).toContainText("Saved for later");
  expect(await page.evaluate("window.__extensionTest.captures[0]")).toEqual({
    type: "capture",
    action: "save",
    tab: { id: 7, url: "https://openai.com/index/scaling-postgresql/" },
  });
  await expect(
    page.getByRole("link", { name: /Review in Margin/ }),
  ).toHaveAttribute("href", "https://margin.example/dashboard#edit=item-7");
  await page.keyboard.press("h");
  await expect(save).toBeFocused();
  await page.keyboard.press("l");
  await expect(done).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Marked done.");
  expect(await page.evaluate("window.__extensionTest.captures[1].action")).toBe(
    "done",
  );
  await page.evaluate(
    "window.__extensionTest.reply={error:'Your browser token was rejected.',code:'connection'}",
  );
  await page.keyboard.press("s");
  await expect(page.getByRole("alert")).toContainText("token was rejected");
  await expect(page.locator("#edit")).toBeHidden();
  await page
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  expect(await page.evaluate("window.__extensionTest.optionsOpened")).toBe(1);
});

test("extension prevents duplicate sends while busy and keeps partial metadata feedback", async ({
  page,
}) => {
  await extensionPage(page, "popup.html", {
    pending: true,
    reply: {
      result: {
        id: "item-7",
        created: true,
        editURL: "https://margin.example/dashboard#edit=item-7",
        warning: "Some details are missing. Review them in Margin.",
      },
    },
  });
  const save = page.getByRole("button", { name: /Save for later/ });
  await expect(save).toBeEnabled();
  await page.keyboard.press("s");
  await expect(save).toBeDisabled();
  await expect(page.getByRole("button", { name: /Mark done/ })).toBeDisabled();
  await page.keyboard.press("d");
  expect(await page.evaluate("window.__extensionTest.captures.length")).toBe(1);
  await page.evaluate("window.__extensionTest.finish()");
  await expect(page.getByRole("status")).toContainText(
    "Some details are missing",
  );
  await expect(save).toBeEnabled();
  await expect(page.locator("#status")).toHaveAttribute("data-tone", "warning");
  await accessible(page);
});

test("extension offers setup and refuses unsupported pages before sending", async ({
  page,
}) => {
  await extensionPage(page, "popup.html", {
    saved: {},
    tab: { id: 7, url: "chrome://settings/", title: "Settings" },
  });
  await expect(
    page.getByRole("heading", { name: "Connect your library", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "This page can’t be saved",
  );
  await expect(
    page.getByRole("button", { name: /Save for later/ }),
  ).toBeDisabled();
  await page.keyboard.press("s");
  expect(await page.evaluate("window.__extensionTest.captures")).toEqual([]);
  await page
    .getByRole("button", { name: "Connect to Margin", exact: true })
    .click();
  expect(await page.evaluate("window.__extensionTest.optionsOpened")).toBe(1);
  await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
  expect(await page.evaluate("window.__extensionTest.tabs")).toEqual([
    { url: "chrome://extensions/shortcuts" },
  ]);
  await accessible(page);
});

test("extension setup normalizes pasted URLs and displays actual shortcut assignments", async ({
  page,
}, info) => {
  await extensionPage(page, "options.html", {
    grant: false,
    commands: [
      { name: "_execute_action", shortcut: "Ctrl+Shift+P" },
      { name: "save-page", shortcut: "Alt+S" },
      { name: "done-page", shortcut: "" },
    ],
  });
  const token = page.getByLabel("Browser token", { exact: true });
  await expect(token).toHaveAttribute("type", "password");
  await page
    .getByRole("button", { name: "Show browser token", exact: true })
    .click();
  await expect(token).toHaveAttribute("type", "text");
  expect(await page.evaluate("window.__extensionTest.permissions")).toEqual([]);
  await page
    .getByRole("button", { name: "Hide browser token", exact: true })
    .click();
  await page
    .getByLabel("Margin address", { exact: true })
    .fill("localhost:5178/dashboard#library");
  await token.fill("a".repeat(43));
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Allow access");
  expect(await page.evaluate("window.__extensionTest.saved.origin")).toBe(
    "https://margin.example",
  );
  await page.evaluate("window.__extensionTest.grant=true");
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Connection saved");
  await expect(page.getByLabel("Margin address", { exact: true })).toHaveValue(
    "http://localhost:5178",
  );
  expect(await page.evaluate("window.__extensionTest.saved.origin")).toBe(
    "http://localhost:5178",
  );
  expect(await page.evaluate("window.__extensionTest.removed")).toEqual([
    { origins: ["https://margin.example/*"] },
  ]);
  await expect(page.locator("#command-list")).toContainText("Ctrl+Shift+P");
  await expect(page.locator("#command-list")).toContainText("Alt+S");
  await expect(page.locator("#command-list")).toContainText("Not assigned");
  await accessible(page);
  await page.screenshot({
    path: "test-results/extension-settings-" + info.project.name + ".png",
    fullPage: true,
  });
});
