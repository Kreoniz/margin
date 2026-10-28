import assert from "node:assert/strict";
import { test } from "node:test";

let command, message, sent;
const credential = "test-only-browser-credential";
const noOp = async () => {};
globalThis.chrome = {
  storage: {
    local: {
      setAccessLevel: noOp,
      get: async () => ({
        origin: "https://margin.example",
        token: credential,
      }),
    },
  },
  permissions: { contains: async () => true },
  tabs: {
    query: async () => [
      { id: 1, url: "https://publisher.example/article?utm_source=browser" },
    ],
  },
  action: { setBadgeBackgroundColor: noOp, setBadgeText: noOp, setTitle: noOp },
  commands: {
    onCommand: {
      addListener: (listener) => {
        command = listener;
      },
    },
  },
  runtime: {
    onMessage: {
      addListener: (listener) => {
        message = listener;
      },
    },
  },
};
globalThis.fetch = async (url, options) => {
  sent = { url, ...options };
  return new Response(
    JSON.stringify({
      id: "test-id",
      created: true,
      action: JSON.parse(options.body).action,
    }),
    { status: 201 },
  );
};
const { capture } = await import("./background.js");

test("capture sends only the URL and action, with a separate bearer credential", async () => {
  const result = await capture("save");
  assert.equal(sent.url, "https://margin.example/api/integrations/capture");
  assert.equal(sent.credentials, "omit");
  assert.equal(sent.redirect, "error");
  assert.equal(sent.headers.Authorization, "Bearer " + credential);
  assert.deepEqual(JSON.parse(sent.body), {
    url: "https://publisher.example/article?utm_source=browser",
    action: "save",
  });
  assert.equal(result.editURL, "https://margin.example/dashboard#edit=test-id");
});
test("save and done commands are independent and produce different actions", async () => {
  command("save-page");
  await new Promise(setImmediate);
  assert.equal(JSON.parse(sent.body).action, "save");
  command("done-page");
  await new Promise(setImmediate);
  assert.equal(JSON.parse(sent.body).action, "done");
});
test("popup receives errors without throwing a service-worker exception", async () => {
  const response = await new Promise((resolve) =>
    message({ type: "capture", action: "invalid" }, {}, resolve),
  );
  assert.match(response.error, /Unknown capture action/);
});
test("capture requires the configured site permission and rejects browser pages", async () => {
  chrome.permissions.contains = async () => false;
  await assert.rejects(capture("save"), /Grant access/);
  chrome.permissions.contains = async () => true;
  chrome.tabs.query = async () => [{ id: 1, url: "chrome://settings" }];
  await assert.rejects(capture("save"), /HTTP or HTTPS/);
});

test("current-page metadata accompanies URL capture and stale-page badges are skipped", async () => {
  const badges = [];
  chrome.tabs.query = async () => [
    { id: 7, url: "https://publisher.example/blocked" },
  ];
  chrome.permissions.contains = async () => true;
  chrome.scripting = {
    executeScript: async () => [
      {
        result: {
          title: "A real page title",
          author: "Writer",
          cover_url: "https://publisher.example/cover.jpg",
          description: "Page summary",
        },
      },
    ],
  };
  chrome.tabs.get = async () => ({
    id: 7,
    url: "https://publisher.example/next-page",
  });
  chrome.action.setBadgeText = async (value) => badges.push(value.text);
  await capture("save");
  assert.equal(JSON.parse(sent.body).page_metadata.title, "A real page title");
  assert.deepEqual(badges, ["…"]);
});

test("page extraction refuses metadata after the tab URL changes", async () => {
  const { readPageMetadata } = await import("./background.js");
  globalThis.location = { href: "https://publisher.example/page-b" };
  assert.equal(readPageMetadata("https://publisher.example/page-a"), null);
});

test("late failures stay scoped to the original tab after focus changes", async () => {
  const previousFetch = globalThis.fetch;
  const badges = [];
  const captured = { id: 21, url: "https://publisher.example/original" };
  chrome.tabs.query = async () => [captured];
  chrome.tabs.get = async (id) =>
    id === 21 ? captured : { id, url: "https://publisher.example/new" };
  chrome.action.setBadgeText = async (value) => badges.push(value);
  let fail;
  globalThis.fetch = () =>
    new Promise((_resolve, reject) => {
      fail = () => reject(new Error("Test connection failure"));
    });
  try {
    const response = new Promise((resolve) =>
      message({ type: "capture", action: "save" }, {}, resolve),
    );
    await new Promise(setImmediate);
    chrome.tabs.query = async () => [
      { id: 22, url: "https://publisher.example/new" },
    ];
    fail();
    assert.match((await response).error, /Test connection failure/);
    assert.ok(badges.every((value) => value.tabId === 21));
    assert.equal(badges.at(-1).text, "!");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
