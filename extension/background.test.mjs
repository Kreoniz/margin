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
