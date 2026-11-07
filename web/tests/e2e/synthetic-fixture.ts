import type { Page } from "@playwright/test";
import type { Media } from "../../src/types";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

export async function fixture(page: Page, customMedia?: Media[]) {
  const now = "2026-10-30T00:00:00Z";
  const source = { id: "source-1", name: "OpenAI", site_url: "https://openai.com", feed_url: "https://openai.com/feed", parser: "rss", enabled: true, auto_save: false, interval_minutes: 60, last_sync: now, next_sync: now, last_error: "", item_count: 42 };
  const sources = [source, { ...source, id: "source-2", name: "Second source" }];
  const media: Media[] = customMedia ? customMedia.map(item => ({ ...item, tags: [...item.tags] })) : [
    { id: "video-1", title: "A landscape video", kind: "video", url: "https://www.youtube.com/watch?v=NBCM_ZoWZo8", cover_url: "https://images.test/video.svg" },
    { id: "video-2", title: "An unavailable preview", kind: "video", url: "https://www.youtube.com/watch?v=AAAAAAAAAAA", cover_url: "https://images.test/missing.jpg" },
    { id: "video-3", title: "No preview supplied", kind: "video", url: "https://www.youtube.com/watch?v=BBBBBBBBBBB", cover_url: "" },
    { id: "video-4", title: "Custom portrait artwork", kind: "video", url: "https://example.com/video", cover_url: "https://images.test/portrait.svg" },
  ].map(item => ({ author: "Synthetic author", status: "pending", description: "", notes: "", tags: [] as string[], visibility: "public", needs_review: false, created_at: now, updated_at: now, ...item, kind: item.kind as Media["kind"] }));
  const inbox = Array.from({ length: 42 }, (_, index) => ({ id: `inbox-${index}`, source_id: source.id, source_name: source.name, title: `A useful article ${index}`, author: "", url: `https://openai.com/article-${index}`, cover_url: "", description: "A synthetic description to check the compact row layout.", state: "new", published_at: new Date(Date.parse(now) - index * 1000).toISOString(), discovered_at: now }));
  let releaseInbox = () => {};
  let inboxGate = Promise.resolve();
  let releaseImage = () => {};
  let imageGate = Promise.resolve();
  let queue = { version: 0, ids: [] as string[] };
  let queueFailure = false;
  let queueConflict = false;
  let bootstrapFailure = false;
  let inboxFailure = false;
  let cursorFailure = false;
  let imageFailure = false;
  let deleteFailure = false;
  let sourceDeleteFailure = false;
  let mediaFailure = false;
  let mediaConflict = false;
  let releaseMediaWrite = () => {};
  let mediaWriteGate = Promise.resolve();
  let releaseInboxWrite = () => {};
  let inboxWriteGate = Promise.resolve();
  let releaseInboxAck = () => {};
  let inboxAckGate = Promise.resolve();
  let releaseSourceDelete = () => {};
  let sourceDeleteGate = Promise.resolve();
  const requests = { bootstrap: 0, sourcePatches: 0, sourceCreates: 0, sourceDeletes: 0, mediaDeletes: 0, mediaPatches: 0, mediaCreates: 0, mediaWrites: [] as Record<string, unknown>[], inboxSaves: 0, inboxPatches: 0, inboxCommits: 0, inbox: [] as string[] };
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === "https://images.test") {
      if (url.pathname === "/missing.jpg") return route.fulfill({ status: 404, body: "" });
      await imageGate;
      if (imageFailure) return route.fulfill({ status: 404, body: "" });
      const body = /portrait|book|manga/.test(url.pathname)
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="200"><rect width="120" height="200" fill="#315750"/><text y="20" fill="white">Top of artwork</text><text y="195" fill="white">Bottom of artwork</text></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#315750"/><path fill="black" d="M0 0h480v45H0zM0 315h480v45H0z"/></svg>';
      const artwork = url.pathname === "/book.svg" || url.pathname === "/manga.svg"
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#9c6650"/><rect x="14" y="14" width="172" height="272" fill="none" stroke="#eadbbd" stroke-width="3"/><circle cx="100" cy="130" r="48" fill="#e0bc82"/><text x="100" y="235" text-anchor="middle" fill="#fff3d7" font-family="sans-serif" font-size="20">SYNTHETIC</text><text x="100" y="260" text-anchor="middle" fill="#fff3d7" font-family="sans-serif" font-size="16">COVER</text></svg>'
        : url.pathname === "/square.svg"
          ? '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360"><rect width="360" height="360" fill="#315750"/><circle cx="180" cy="180" r="120" fill="#eadbbd"/></svg>'
        : url.pathname === "/wide.svg"
          ? '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#365c68"/><circle cx="1200" cy="220" r="120" fill="#edc17b"/><path d="M0 900 500 170 1000 900M500 900 1100 350 1600 900" fill="#1b3540"/><text x="80" y="800" fill="#f2e9d6" font-family="sans-serif" font-size="96">A WIDE IDEA</text></svg>'
          : body;
      return route.fulfill({ contentType: "image/svg+xml", body: artwork });
    }
    if (url.origin !== "http://margin.test") return route.abort();
    if (url.pathname === "/api/integration/agent-grants") return route.fulfill({ json: [] });
    if (url.pathname === "/api/session") return route.fulfill({ json: { authenticated: true, setup_required: false } });
    if (url.pathname === "/api/bootstrap") {
      requests.bootstrap++;
      const counts = Object.fromEntries(["new", "saved", "read", "dismissed"].map(state => [state, inbox.filter(item => item.state === state).length]));
      return bootstrapFailure ? route.fulfill({ status: 503, json: { error: "Synthetic bootstrap unavailable" } }) : route.fulfill({ json: { up_next: queue, media, inbox: [], sources, inbox_counts: counts, legacy_sample_count: 0 } });
    }
    if (url.pathname === "/api/up-next") {
      if (route.request().method() === "GET") return route.fulfill({ json: queue });
      const body = route.request().postDataJSON();
      if (queueFailure) return route.fulfill({ status: 503, json: { error: "Synthetic queue unavailable" } });
      if (queueConflict || body.expected_version !== queue.version) {
        queueConflict = false;
        queue = { ...queue, version: queue.version + 1, ids: [...queue.ids].reverse() };
        return route.fulfill({ status: 409, json: { error: "Up next changed in another tab. The latest order is shown; try again.", code: "up_next_conflict", up_next: queue } });
      }
      const index = queue.ids.indexOf(body.id);
      if (body.action === "add" && index < 0) queue.ids.push(body.id);
      if (body.action === "remove" && index >= 0) queue.ids.splice(index, 1);
      if (["up", "down"].includes(body.action)) {
        const next = index + (body.action === "up" ? -1 : 1);
        if (index >= 0 && next >= 0 && next < queue.ids.length) [queue.ids[index], queue.ids[next]] = [queue.ids[next], queue.ids[index]];
      }
      queue.version++;
      return route.fulfill({ json: queue });
    }
    if (url.pathname === "/api/sources") {
      requests.sourceCreates++;
      const added = { ...source, id: "source-new", name: "New source", site_url: route.request().postDataJSON().url };
      sources.push(added);
      return route.fulfill({ status: 201, json: added });
    }
    if (url.pathname.startsWith("/api/sources/")) {
      if (route.request().method() === "DELETE") {
        requests.sourceDeletes++;
        await sourceDeleteGate;
        if (sourceDeleteFailure) return route.fulfill({ status: 503, json: { error: "Synthetic source removal unavailable" } });
        const id = sources.find(item => url.pathname.endsWith(item.id))!.id;
        for (let index = inbox.length - 1; index >= 0; index--) if (inbox[index].source_id === id) inbox.splice(index, 1);
        sources.splice(sources.findIndex(item => url.pathname.endsWith(item.id)), 1);
        return route.fulfill({ status: 204 });
      }
      requests.sourcePatches++;
      Object.assign(source, route.request().postDataJSON());
      return route.fulfill({ json: source });
    }
    if (url.pathname === "/api/inbox") {
      await inboxGate;
      const more = url.searchParams.has("cursor");
      requests.inbox.push(url.search);
      if (inboxFailure || more && cursorFailure) return route.fulfill({ status: 503, json: { error: "Synthetic inbox unavailable" } });
      const state = url.searchParams.get("state") || "new";
      const filterSource = url.searchParams.get("source");
      const terms = (url.searchParams.get("q") || "").toLowerCase().split(/\s+/).filter(Boolean);
      const filtered = inbox.filter(item => item.state === state && (!filterSource || item.source_id === filterSource) && terms.every(term => [item.title, item.author, item.source_name, item.url, item.description].join(" ").toLowerCase().includes(term)));
      const cursor = url.searchParams.get("cursor");
      const after = cursor === "second-page" ? 39 : cursor ? Number(cursor.slice(6)) : -1;
      const remaining = filtered.filter(item => Number(item.id.slice(6)) > after);
      const items = remaining.slice(0, 40);
      const last = Number(items.at(-1)?.id.slice(6));
      return route.fulfill({ json: { items, total: filtered.length, ...(remaining.length > 40 ? { next_cursor: last === 39 ? "second-page" : "after-" + last } : {}) } });
    }
    if (url.pathname.startsWith("/api/inbox/") && route.request().method() === "POST") {
      requests.inboxSaves++;
      await inboxWriteGate;
      const item = inbox.find(item => url.pathname === `/api/inbox/${item.id}/save`)!;
      item.state = "saved";
      const saved = { ...media[0], id: "saved-" + item.id, kind: "article", title: item.title, url: item.url, cover_url: item.cover_url, author: item.author, description: item.description, notes: "", tags: [], visibility: "private", needs_review: false };
      media.push(saved);
      requests.inboxCommits++;
      await inboxAckGate;
      return route.fulfill({ status: 201, json: saved });
    }
    if (url.pathname.startsWith("/api/inbox/") && route.request().method() === "PATCH") {
      requests.inboxPatches++;
      await inboxWriteGate;
      const item = inbox.find(item => url.pathname.endsWith(item.id))!;
      item.state = route.request().postDataJSON().state;
      requests.inboxCommits++;
      await inboxAckGate;
      return route.fulfill({ json: item });
    }
    if (url.pathname.startsWith("/api/public/media")) return route.fulfill({ json: url.pathname === "/api/public/media" ? media : media.find(item => url.pathname.endsWith(item.id)) });
    if (url.pathname.startsWith("/api/media/") && route.request().method() === "DELETE") {
      requests.mediaDeletes++;
      if (deleteFailure) return route.fulfill({ status: 503, json: { error: "Synthetic removal unavailable" } });
      const removed = media.splice(media.findIndex(item => url.pathname.endsWith(item.id)), 1)[0];
      if (queue.ids.includes(removed.id)) queue = { version: queue.version + 1, ids: queue.ids.filter(id => id !== removed.id) };
      return route.fulfill({ status: 204 });
    }
    if (url.pathname.startsWith("/api/media/") && route.request().method() === "PATCH") {
      requests.mediaPatches++;
      requests.mediaWrites.push(route.request().postDataJSON());
      await mediaWriteGate;
      if (mediaConflict) return route.fulfill({ status: 409, json: { error: "Synthetic conflicting edit", code: "edit_conflict" } });
      if (mediaFailure) return route.fulfill({ status: 503, json: { error: "Synthetic save unavailable" } });
      const item = media.find(item => url.pathname.endsWith(item.id))!;
      const body = route.request().postDataJSON();
      for (const key of Object.keys(item)) if (key in body) Object.assign(item, { [key]: body[key] });
      if (item.status === "done" && queue.ids.includes(item.id)) queue = { version: queue.version + 1, ids: queue.ids.filter(id => id !== item.id) };
      return route.fulfill({ json: item });
    }
    if (url.pathname === "/api/media" && route.request().method() === "POST") {
      requests.mediaCreates++;
      requests.mediaWrites.push(route.request().postDataJSON());
      await mediaWriteGate;
      if (mediaFailure) return route.fulfill({ status: 503, json: { error: "Synthetic save unavailable" } });
      const body = route.request().postDataJSON();
      const item = { ...media[0], id: "created-" + requests.mediaCreates, title: body.title, kind: body.kind || "article", status: body.status || "pending", url: body.url || "", cover_url: body.cover_url || "", author: body.author || "", description: body.description || "", notes: body.notes || "", tags: body.tags || [], visibility: body.visibility || "private", needs_review: false };
      media.push(item);
      return route.fulfill({ status: 201, json: item });
    }
    if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { configured: false } });
    const asset = /^(\/assets\/|\/brands\/|\/fonts\/)/.test(url.pathname) ? url.pathname.slice(1) : "index.html";
    const contentType = ({ ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" } as Record<string, string>)[extname(asset)] || "text/html";
    return route.fulfill({ body: await readFile(new URL("../../dist/" + asset, import.meta.url)), contentType });
  });
  return {
    requests,
    queue(ids: string[]) { queue = { version: queue.version + 1, ids: [...ids] }; },
    failQueue(value = true) { queueFailure = value; },
    conflictQueue() { queueConflict = true; },
    review(id: string) { media.find(item => item.id === id)!.needs_review = true; },
    kind(id: string, kind: string) { media.find(item => item.id === id)!.kind = kind as Media["kind"]; },
    enrichMedia(id: string, values: Partial<Pick<Media, "title" | "description" | "cover_url" | "author" | "metadata_state">>) { Object.assign(media.find(item => item.id === id)!, values); },
    failBootstrap(value = true) { bootstrapFailure = value; },
    failInbox(value = true) { inboxFailure = value; },
    failCursor(value = true) { cursorFailure = value; },
    failImage(value = true) { imageFailure = value; },
    failDelete(value = true) { deleteFailure = value; },
    failSourceDelete(value = true) { sourceDeleteFailure = value; },
    failMedia(value = true) { mediaFailure = value; },
    conflictMedia(value = true) { mediaConflict = value; },
    holdMediaWrite() { mediaWriteGate = new Promise<void>(resolve => { releaseMediaWrite = resolve; }); },
    releaseMediaWrite() { releaseMediaWrite(); mediaWriteGate = Promise.resolve(); },
    holdInboxWrite() { inboxWriteGate = new Promise<void>(resolve => { releaseInboxWrite = resolve; }); },
    releaseInboxWrite() { releaseInboxWrite(); inboxWriteGate = Promise.resolve(); },
    holdInboxAck() { inboxAckGate = new Promise<void>(resolve => { releaseInboxAck = resolve; }); },
    releaseInboxAck() { releaseInboxAck(); inboxAckGate = Promise.resolve(); },
    holdSourceDelete() { sourceDeleteGate = new Promise<void>(resolve => { releaseSourceDelete = resolve; }); },
    releaseSourceDelete() { releaseSourceDelete(); sourceDeleteGate = Promise.resolve(); },
    holdInbox() { inboxGate = new Promise<void>(resolve => { releaseInbox = resolve; }); },
    releaseInbox() { releaseInbox(); inboxGate = Promise.resolve(); },
    holdImage() { imageGate = new Promise<void>(resolve => { releaseImage = resolve; }); },
    releaseImage() { releaseImage(); imageGate = Promise.resolve(); },
  };
}

