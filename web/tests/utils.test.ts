import assert from "node:assert/strict";
import { test } from "node:test";
import { safeURL, selectMedia } from "../src/utils.ts";
import type { Media } from "../src/types.ts";

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
    kind: "all" as const,
    tag: "",
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
    selectMedia(list, { query: "", status: "done", kind: "all", tag: "" }).map(
      (m) => m.id,
    ),
    ["2"],
  );
  assert.deepEqual(
    selectMedia(list, {
      query: "",
      status: "all",
      kind: "book",
      tag: "Design",
    }).map((m) => m.id),
    ["1"],
  );
  assert.equal(
    selectMedia(list, { query: "", status: "pending", kind: "movie", tag: "" })
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
      kind: "all",
      tag: "",
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
