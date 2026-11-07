import assert from "node:assert/strict";
import { test } from "node:test";
import { selectMedia } from "../src/utils.ts";
import { emptyDraft, type Media, type PublicMedia } from "../src/types.ts";

test("saved item matching includes private excerpts without requiring them on public DTOs", () => {
  const item: Media = { ...emptyDraft(), id: "fixture", title: "Saved source", selected_text: "A distinctive excerpt", selected_text_source_url: "https://original.example/page#selection", created_at: "2026-11-02T00:00:00Z", updated_at: "2026-11-02T00:00:00Z" };
  const filters = { query: "distinctive original.example", status: "all", kinds: [], tags: [] };
  assert.deepEqual(selectMedia([item], filters).map(i => i.id), [item.id]);
  const { notes: _notes, selected_text: _excerpt, selected_text_source_url: _source, ...publicFields } = item;
  const publicItem: PublicMedia = publicFields;
  assert.deepEqual(selectMedia([publicItem], filters), []);
});
