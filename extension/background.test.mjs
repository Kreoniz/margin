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
  let checks = 0;
  chrome.tabs.get = async () => ({
    id: 7,
    url: ++checks === 1 ? "https://publisher.example/blocked" : "https://publisher.example/next-page",
  });
  chrome.action.setBadgeText = async (value) => badges.push(value.text);
  await capture("save");
  assert.equal(JSON.parse(sent.body).page_metadata.title, "A real page title");
  assert.deepEqual(badges, ["…"]);
});

test("page extraction refuses metadata after the tab URL changes", async () => {
  const { readPageMetadata } = await import("./background.js");
  globalThis.location = { href: "https://publisher.example/page-b" };
  assert.deepEqual(readPageMetadata("https://publisher.example/page-a"), { page_changed: true });
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
    const result = await response;
    assert.match(result.error, /Could not reach Margin/);
    assert.equal(result.code, "connection");
    assert.ok(badges.every((value) => value.tabId === 21));
    assert.equal(badges.at(-1).text, "!");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("a popup capture is bound to the previewed page and refuses a changed tab", async () => {
  const previousFetch = globalThis.fetch;
  const badges = [];
  let calls = 0;
  chrome.tabs.get = async () => ({
    id: 31,
    url: "https://publisher.example/new",
  });
  chrome.action.setBadgeText = async (value) => badges.push(value);
  globalThis.fetch = async (...args) => {
    calls++;
    return previousFetch(...args);
  };
  try {
    const result = await new Promise((resolve) =>
      message(
        {
          type: "capture",
          action: "save",
          tab: { id: 31, url: "https://publisher.example/previewed" },
        },
        {},
        resolve,
      ),
    );
    assert.equal(result.code, "page_changed");
    assert.match(result.error, /page changed/);
    assert.equal(calls, 0);
    assert.deepEqual(badges, []);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("rejected tokens return actionable connection feedback", async () => {
  chrome.tabs.get = async () => ({ id: 31, url: "https://publisher.example/article" });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  try {
    await assert.rejects(
      capture("save", { id: 31, url: "https://publisher.example/article" }),
      (error) =>
        error.code === "connection" && /token was rejected/.test(error.message),
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("navigation during page extraction never submits the old preview URL", async () => {
  const previousScript = chrome.scripting;
  const previousFetch = globalThis.fetch;
  let requests = 0;
  const tab = { id: 31, url: "https://publisher.example/article" };
  chrome.tabs.get = async () => tab;
  chrome.scripting = { executeScript: async () => [{ result: { page_changed: true } }] };
  globalThis.fetch = async (...args) => { requests++; return previousFetch(...args); };
  try {
    await assert.rejects(capture("save", tab), error => error.code === "page_changed");
    assert.equal(requests, 0);
    chrome.scripting = { executeScript: async () => { throw new Error("Injection unavailable"); } };
    await capture("save", tab);
    assert.equal(requests, 1, "inaccessible metadata still permits URL-only capture");
  } finally {
    chrome.scripting = previousScript;
    globalThis.fetch = previousFetch;
  }
});

test("badge failure cannot hide a committed receipt and pending details remain distinct", async () => {
  const previousFetch = globalThis.fetch;
  const previousAction = chrome.action;
  const tab = { id: 31, url: "https://publisher.example/article" };
  chrome.tabs.get = async () => tab;
  try {
    chrome.action = { setBadgeText: noOp, setBadgeBackgroundColor: async () => { throw new Error("Tab closed"); }, setTitle: noOp };
    const committed = await capture("save", tab);
    assert.equal(committed.id, "test-id");
    const badges = [], titles = [];
    chrome.action = { setBadgeText: async value => badges.push(value.text), setBadgeBackgroundColor: noOp, setTitle: async value => titles.push(value.title) };
    globalThis.fetch = async () => new Response(JSON.stringify({ id: "pending-id", created: true, metadata_state: "pending" }), { status: 201 });
    const pending = await capture("save", tab);
    assert.equal(pending.metadata_state, "pending");
    assert.equal(badges.at(-1), "…");
    assert.match(titles.at(-1), /still loading/);
  } finally {
    globalThis.fetch = previousFetch;
    chrome.action = previousAction;
  }
});

test("navigation during the pending badge is checked before submission", async () => {
  const previousFetch = globalThis.fetch, previousAction = chrome.action, previousScript = chrome.scripting;
  const previousGet = chrome.tabs.get;
  const original = { id: 31, url: "https://publisher.example/page-a" };
  let current = original, requests = 0;
  chrome.tabs.get = async () => current;
  chrome.scripting = { executeScript: async () => [{ result: { title: "Page A" } }] };
  chrome.action = { ...previousAction, setBadgeText: async value => { if (value.text === "…") { await Promise.resolve(); current = { ...original, url: "https://publisher.example/page-b" }; } } };
  globalThis.fetch = async (...args) => { requests++; return previousFetch(...args); };
  try {
    await assert.rejects(capture("save", original), error => error.code === "page_changed");
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = previousFetch; chrome.action = previousAction; chrome.scripting = previousScript; chrome.tabs.get = previousGet;
  }
});

test("selection extraction is explicit, byte-bounded and bound to the captured fragment", async () => {
  const { readPageMetadata } = await import("./background.js");
  const previous = { window: globalThis.window, document: globalThis.document, location: globalThis.location };
  const url = "https://publisher.example/article#quote";
  let text = "A selected excerpt", reads = 0;
  globalThis.location = { href: url };
  globalThis.document = { title: "Page title", baseURI: url, querySelector: () => null };
  globalThis.window = { getSelection: () => { reads++; return { toString: () => text }; } };
  try {
    assert.equal(readPageMetadata(url).selection, undefined);
    assert.equal(reads, 0);
    assert.deepEqual(readPageMetadata(url, true).selection, { text, source_url: url });
    text = "🙂".repeat(2500);
    assert.equal(readPageMetadata(url, true).selection.text, text);
    text += "🙂";
    assert.match(readPageMetadata(url, true).selection_error, /10,000 UTF-8 bytes/);
    text = "  \n ";
    assert.match(readPageMetadata(url, true).selection_error, /Select some text/);
    globalThis.window.getSelection = () => {
      globalThis.location.href = "https://publisher.example/other";
      return { toString: () => "Previous page text" };
    };
    assert.deepEqual(readPageMetadata(url, true), { page_changed: true });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test("selected capture is separate from page metadata and duplicate text is never reported as stored", async () => {
  const previous = { script: chrome.scripting, get: chrome.tabs.get, fetch: globalThis.fetch };
  const tab = { id: 51, url: "https://publisher.example/selected#quote" };
  const selection = { text: "Owner selected this", source_url: tab.url };
  let scriptArgs, created = true;
  chrome.tabs.get = async () => tab;
  chrome.scripting = { executeScript: async options => {
    scriptArgs = options.args;
    return [{ result: { title: "Selected page", selection } }];
  } };
  globalThis.fetch = async (url, options) => {
    sent = { url, ...options };
    return new Response(JSON.stringify({ id: "selected-id", created, action: "save", selection_saved: created }), { status: created ? 201 : 200 });
  };
  try {
    const saved = await capture("save", tab, true);
    assert.equal(saved.selection_saved, true);
    assert.deepEqual(scriptArgs, [tab.url, true]);
    assert.deepEqual(JSON.parse(sent.body).selection, selection);
    assert.deepEqual(JSON.parse(sent.body).page_metadata, { title: "Selected page" });
    assert.equal(JSON.parse(sent.body).notes, undefined);
    created = false;
    const duplicate = await capture("save", tab, true);
    assert.equal(duplicate.selection_saved, false);
    assert.match(duplicate.warning, /selected text was not added/);
    await capture("save", tab);
    assert.equal(JSON.parse(sent.body).selection, undefined);
    assert.deepEqual(scriptArgs, [tab.url, false]);
  } finally {
    chrome.scripting = previous.script; chrome.tabs.get = previous.get; globalThis.fetch = previous.fetch;
  }
});

test("requested selection failures stop before submission while ordinary URL capture still works", async () => {
  const previous = { script: chrome.scripting, get: chrome.tabs.get, fetch: globalThis.fetch };
  const tab = { id: 52, url: "https://publisher.example/selection" };
  let calls = 0;
  chrome.tabs.get = async () => tab;
  globalThis.fetch = async (...args) => { calls++; return previous.fetch(...args); };
  try {
    chrome.scripting = { executeScript: async () => [{ result: { selection_error: "Select some text first." } }] };
    await assert.rejects(capture("save", tab, true), error => error.code === "selection");
    chrome.scripting = { executeScript: async () => { throw new Error("Page access denied"); } };
    await assert.rejects(capture("save", tab, true), error => error.code === "selection");
    chrome.scripting = { executeScript: async () => [{ result: { selection: { text: "Wrong page", source_url: tab.url + "#other" } } }] };
    await assert.rejects(capture("save", tab, true), error => error.code === "selection");
    assert.equal(calls, 0);
    chrome.scripting = { executeScript: async () => { throw new Error("Page access denied"); } };
    await capture("save", tab);
    assert.equal(calls, 1);
  } finally {
    chrome.scripting = previous.script; chrome.tabs.get = previous.get; globalThis.fetch = previous.fetch;
  }
});
