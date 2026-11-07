import assert from "node:assert/strict";
import { test } from "node:test";
import { isFallbackTitle, safeURL, selectMedia, youtubeChannelName } from "../src/utils.ts";
import type { Media } from "../src/types.ts";

test("known YouTube placeholders are recoverable without replacing real titles", () => {
  for (const url of ["https://youtu.be/NBCM_ZoWZo8", "https://www.youtube.com/watch?v=NBCM_ZoWZo8", "https://m.youtube.com/shorts/NBCM_ZoWZo8"]) {
    assert.equal(isFallbackTitle("YouTube", url), true);
    assert.equal(isFallbackTitle("Before you continue to YouTube", url), true);
    assert.equal(isFallbackTitle("A deliberate video title", url), false);
  }
  assert.equal(isFallbackTitle("YouTube", "https://publisher.example/article"), false);
});

const item = (data: Partial<Media> = {}): Media => ({
  id: "1",
  title: "A useful idea",
  author: "A reader",
  kind: "book",
  status: "pending",
  url: "",
  cover_url: "",
  description: "",
  notes: "Remember this",
  tags: ["Design"],
  visibility: "private",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  ...data,
});
test("list search combines title, creator, note and tags", () => {
  const filters = {
    query: "idea reader design remember",
    status: "all",
    kinds: [],
    tags: [],
  };
  assert.deepEqual(
    selectMedia(
      [item(), item({ id: "2", title: "A film", notes: "" })],
      filters,
    ).map((m) => m.id),
    ["1"],
  );
});
test("pending/done, type and tag filters compose", () => {
  const list = [
    item(),
    item({ id: "2", status: "done", kind: "movie", tags: ["Film"] }),
  ];
  assert.deepEqual(
    selectMedia(list, { query: "", status: "done", kinds: [], tags: [] }).map(
      (m) => m.id,
    ),
    ["2"],
  );
  assert.deepEqual(
    selectMedia(list, {
      query: "",
      status: "all",
      kinds: ["book"],
      tags: ["Design"],
    }).map((m) => m.id),
    ["1"],
  );
  assert.equal(
    selectMedia(list, { query: "", status: "pending", kinds: ["movie"], tags: [] })
      .length,
    0,
  );
});
test("public DTOs without notes can be searched and unsafe links rejected", () => {
  const { notes: _notes, ...publicItem } = item({ visibility: "public" });
  assert.equal(
    selectMedia([publicItem], {
      query: "idea",
      status: "all",
      kinds: [],
      tags: [],
    }).length,
    1,
  );
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,x",
    "/relative",
    "https://user:secret@example.com",
  ])
    assert.equal(safeURL(url), undefined);
  assert.equal(safeURL("https://example.com/a"), "https://example.com/a");
});

test("multi-select filters match any value within a group and all active groups", () => {
  const list = [
    item({ id: "book", tags: ["Design"] }),
    item({ id: "video", kind: "video", tags: ["Code"], author: "Channel One", url: "https://youtu.be/NBCM_ZoWZo8" }),
    item({ id: "other-video", kind: "video", tags: ["Film"], author: "Channel Two", url: "https://www.youtube.com/watch?v=AAAAAAAAAAA" }),
    item({ id: "article", kind: "article", tags: ["Design", "Code"] }),
  ];
  const filters = { query: "", status: "pending", kinds: ["book", "video"] as const, tags: ["Design", "Code"] };
  assert.deepEqual(selectMedia(list, filters).map(m => m.id), ["book", "video"]);
  assert.deepEqual(selectMedia(list, { ...filters, channels: ["channel one", "channel two"] }).map(m => m.id), ["video"]);
  assert.equal(selectMedia(list, { ...filters, query: "unmatched" }).length, 0);
  assert.equal(selectMedia(list, { ...filters, status: "done" }).length, 0);
});

test("channel filters use trimmed case-insensitive YouTube creator names only", () => {
  const video = item({ kind: "video", url: "https://www.youtube.com/watch?v=NBCM_ZoWZo8", author: "  Channel One  " });
  assert.equal(youtubeChannelName(video), "Channel One");
  assert.equal(selectMedia([video], { query: "", status: "all", kinds: [], tags: [], channels: ["channel one"] }).length, 1);
  assert.equal(youtubeChannelName({ ...video, url: "https://youtube.com.evil.test/watch" }), undefined);
  assert.equal(youtubeChannelName({ ...video, kind: "book" }), undefined);
  assert.equal(youtubeChannelName({ ...video, author: " " }), undefined);
});
