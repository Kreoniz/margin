import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeOrigin } from "./shared.js";

test("setup accepts pasted app URLs and normalizes only the site address", () => {
  assert.equal(
    normalizeOrigin(" https://margin.example/dashboard#library "),
    "https://margin.example",
  );
  assert.equal(
    normalizeOrigin("localhost:5178/dashboard"),
    "http://localhost:5178",
  );
  assert.equal(
    normalizeOrigin("127.0.0.1:5178/?view=library"),
    "http://127.0.0.1:5178",
  );
  assert.equal(normalizeOrigin("margin.example"), "https://margin.example");
});

test("setup rejects unsafe schemes, credentials and unencrypted remote sites", () => {
  for (const value of [
    "",
    "http://margin.example",
    "https://user:secret@margin.example",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "ftp://localhost",
  ]) {
    assert.throws(() => normalizeOrigin(value));
  }
});
