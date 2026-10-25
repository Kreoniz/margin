# Margin product correction: research and audit

Research date: **2026-10-23**. Scope: the pre-correction README, frontend, backend model/schema, API routes, collection worker, and existing desktop screenshot. This report records that baseline while implementation proceeds elsewhere. Only this document was changed. No user accounts, private feeds, or production servers were accessed.

## Product decision

Margin should be a compact personal read/watch list with an equally visible stream of automatically collected discoveries. The useful loop is **discover → save → open → done**, or **discover → dismiss**. A saved item has exactly two statuses: **To read/watch** and **Done**. Opening a link does not imply completion.

Remove progress tracking, pages, percentages, totals, units, sessions, habits, favorites, and ratings from the product contract. Remove extensive topic navigation. Keep the warm cream canvas, mint actions, quiet typography, and real Unlikely UI components. The correction is primarily subtraction and a few missing capture/privacy controls; it does not need a larger dashboard.

## Audit of the current implementation

These are source observations, not assumptions based on a screenshot.

| Requirement | Current evidence | Correction |
| --- | --- | --- |
| Two personal statuses | [Frontend types](../web/src/types.ts), [Go model](../backend/internal/app/model.go), and [initial SQL](../backend/internal/app/migrations/001_initial.sql) use `later`, `active`, `completed`. Model validation couples completion to numerical progress. | Use one pending status and one done status everywhere. Migrate both `later` and `active` to pending, and `completed` to done. Preserve records and completion dates. Completion must work without a total. |
| No tracking or evaluation | [README](../README.md) explicitly promotes pages/percent, favorites, ratings, and topics. [MediaDialogs](../web/src/MediaDialogs.tsx) includes Current/Total/Unit, Start, stars, hearts, and topic entry. The schema persists those fields; metadata types include `total`/`unit`. | Remove the UI, live API fields, validation, numerical completion behavior, and active schema fields for progress/total/unit/favorite/rating. Do not merely hide controls. No session/habit/streak feature was found in the reviewed code; do not introduce one. |
| Compact, actionable list | [App](../web/src/App.tsx) defaults to a cover grid, precedes it with a large heading and active/welcome section, and supplies nine media filters plus topic navigation. Its existing list still exposes progress and hearts; completion is inside the detail dialog. [Saved screenshot](../web/test-results/library-desktop.png) corroborates the visual hierarchy, but is historical test evidence. | Make a compact list the default and sole necessary layout. Put completion directly on each saved row. Remove the active/welcome hero, topic sidebar, grid toggle, and wide media-filter strip. |
| Discovery is central | All five default sources, subscriptions, background collection, durable deduplication, source errors, and explicit Save/Dismiss already exist. See [worker](../backend/internal/app/worker.go), [store](../backend/internal/app/store.go), [source research](research.md), and [App](../web/src/App.tsx). Discovery sits below five library destinations; its cards and four Unread/Read/Saved/Dismissed tabs add another tracking model. | Preserve ingestion. Give **Library** and **Discover** equal navigation weight. Default Discover to actionable candidates; Save and Dismiss are its primary actions. Saved items belong in Library. Avoid a second visible read-status ledger. |
| Configurable automatic saving | `sources` has enabled/interval/error fields but no auto-save field. `FinishSource` only inserts inbox records; saving is an explicit separate operation. See [schema](../backend/internal/app/migrations/001_initial.sql), [store](../backend/internal/app/store.go), and [API contract](api-contract.md). | Add a persistent per-source **Auto-save new items** switch, off by default. Explain its destination as To read/watch. |
| Fast manual capture | URL metadata and editable manual fallback already work. The editor requires a title, creator/type/status/topic form, and disables Save while metadata is fetching. See [MediaEditor](../web/src/MediaDialogs.tsx). | Lead with a title or URL entry, then an editable title and Save. Keep extra metadata optional. A slow metadata lookup must not prevent saving an already usable draft. |
| Telegram/Hermes capture | The [HTTP routes](../backend/internal/app/http.go) provide `/api/metadata` and `/api/media` separately. Create requires a title and does not perform metadata extraction. Origin-less authenticated clients are supported, but there is no dedicated one-call URL capture or limited integration credential. | Provide a small authenticated submit operation that accepts a title and/or URL, enriches best-effort, deduplicates, and saves to To read/watch. Integration configuration belongs in documentation/settings, not the reading flow. |
| Private default, optional public reading, owner-only edits | The [middleware](../backend/internal/app/http.go) gates all routes with Basic Auth only when `APP_PASSWORD` is configured. The documented Docker address is loopback. There is no public read-only route, sharing setting, or separate owner authorization boundary. | Keep local access private; require owner authentication for remote private access and all mutations. Add one explicit, revocable read-only sharing mode with a separate public projection. Hiding edit buttons alone is insufficient. |
| Honest normal and empty states | [Startup](../backend/cmd/server/main.go) invokes [demo seeding](../backend/internal/app/seed.go) only when enabled. The normal library is already empty; discovery is collected from real publishers. Samples include invented personal notes, progress, favorites, and ratings, and remain after disabling the flag. | Preserve empty-by-default behavior. Do not enable demo seeding for normal use or present demo screenshots as the owner's history. If a development demo remains, label it clearly. Do not delete existing owner records during correction. |
| Published Unlikely UI | [package.json](../web/package.json) pins `unlikely-ui@0.1.0-alpha.2`; [pnpm lock](../web/pnpm-lock.yaml) resolves the package with an integrity hash. [main.tsx](../web/src/main.tsx) imports its compiled CSS; App/dialogs/components import actual Theme, Button, Input, Toast, Field, Select, and Dialog components. | This requirement is already met. Preserve the published dependency and useful primitives; do not substitute lookalike local components or a local checkout. |

Use a new migration for existing installations rather than rewriting the applied initial migration. Update the README, API contract, and relevant checks with the corrected behavior. The older [research document](research.md) remains useful feed evidence; its Hardcover progress recommendation and extensive card/topic lessons are superseded by this brief.

## Three primary product references

These references supply specific patterns, not a feature checklist. Product facts below were checked against live official documentation/source on the research date; the design choices are our inferences.

| Reference and verified behavior | Application to Margin |
| --- | --- |
| **Readwise Reader:** officially separates automatically arriving **Feed** material from intentionally saved **Library** material. Its Classic library configuration uses Later and Archive. [Feed versus Library](https://docs.readwise.io/reader/docs/faqs/adding-new-content), [library configuration](https://docs.readwise.io/reader/guides/workflows/library-configuration). | Borrow the boundary between discovery and commitment. Name Margin's two personal states To read/watch and Done. Do not import Reader's other library configurations, highlights, filtered-view builder, or reading statistics. |
| **Miniflux:** documents a List View and keyboard navigation; its API exposes feeds, entries, and refresh operations, with server-side scheduled polling. Read state and bookmarking are separate concepts in that product. [Interface](https://miniflux.app/docs/ui.html), [API](https://miniflux.app/docs/api.html), [polling](https://miniflux.app/docs/configuration.html#polling-frequency). | Borrow a scan-first RSS list, direct actions, keyboard access, and background refresh. Do not equate opening a story with finishing a saved item, or copy a bookmark/star layer. |
| **linkding:** its token-authenticated API can scrape a submitted URL when title/description are omitted, or accept caller metadata. The official model defaults bookmark sharing and public sharing to false; access helpers resolve writable bookmarks for their owner. [Capture API](https://linkding.link/api/#bookmarks), [model/defaults](https://github.com/sissbruecker/linkding/blob/master/bookmarks/models.py), [access checks](https://github.com/sissbruecker/linkding/blob/master/bookmarks/views/access.py). | Borrow one-call capture, editable/fallible enrichment, private defaults, and server-enforced ownership. Do not add tag management, multiple archive concepts, or a general bookmark administration interface. |

Per-source auto-save is a Margin requirement and recommendation here; this research does **not** establish an equivalent native switch in all three reference products.

## Compact interaction recommendation

### Library

A narrow top bar contains the Margin wordmark, **Library / Discover**, search, and **Add**. Sources is a secondary control within Discover; appearance and sharing can remain in a small settings menu. There is no need for a permanent 240px taxonomy sidebar.

Library opens on **To read/watch**, with **Done** beside it. A row contains a completion control, title, a small secondary creator/domain line, an optional small cover, and an overflow action for edit/remove. The title opens the original when a URL exists; metadata editing has its own affordance. A title-only item remains usable without a link. Completion is one action, reversible with Undo or from Done. Keep sorting to newest first initially; search is more valuable than another navigation hierarchy.

Target roughly 60–72px rows on desktop and naturally wrapping rows on mobile. Covers, when enabled, are approximately 32–40px wide; absent covers need no fabricated book jacket or empty image box. Keep controls touch-friendly and visible on keyboard focus and mobile, not exclusively on hover. Search should include title, creator, and URL/domain; avoid rebuilding a topic taxonomy.

### Discover and sources

Discover is one chronological list across the five defaults and added subscriptions. Each row shows title, source, date when known, optional short excerpt, **Save**, and **Dismiss**. Use an optional source filter, not a page per publisher. Opening the original does not mutate personal completion. Saved/dismissed records can remain internal for deduplication and recovery without becoming four prominent tabs. Offer Dismiss Undo and a secondary way to restore dismissed candidates.

Source controls need only name/feed, enabled, auto-save, and concise last-check/error information. Existing interval controls can remain secondary. Show a short error near the affected source; preserve working sources and existing records during an outage. Keep manual Check now available without making refresh a prerequisite for using the list.

**Auto-save semantics:** off by default; applies to newly discovered items after activation, including an initial bounded import only when the owner explicitly enables it while subscribing. Turning it on for an existing source must not silently import its backlog. Pausing stops collection and automatic saving. Turning auto-save off retains saved items. Repeat syncs must not reset Done, overwrite owner edits, resave dismissed/deleted items, or duplicate a manual/API save. Show “Auto-save new items to To read/watch” so the effect is concrete; no rules language or scoring system is needed.

### Capture and sharing

**Add:** accept a pasted URL or manual title. A URL gets best-effort title, creator, description, type, and optional cover, with manual edits preserved. Title-only capture should save immediately; do not guess which book or film a string denotes or invent missing metadata. Failed lookup leaves a usable manual path. Reuse the same capture behavior for a proposed `POST /api/submit`, with a limited, revocable submit credential for Telegram/Hermes. Return the saved/existing item identity and whether it was newly created; metadata failure should not turn successful capture into failure. Exact route/response design belongs to the implementation contract.

**Sharing:** the smallest useful version is an owner-controlled, off-by-default public library link that can be disabled/revoked. Explain what becomes visible before enabling it. Its public response contains only intentionally shared list metadata and statuses; exclude private notes, discovery candidates, subscription/feed configuration, integration tokens, and internal errors. Public requests cannot mutate data, and the private bootstrap must remain inaccessible. Retain owner-only authorization on the server even when a public list exists. This needs no social profile, followers, or collaborative editing.

### Warmth without dashboard furniture

Retain the current cream canvas (`#f7f4eb` in app CSS), restrained mint actions, dark ink, fine separators, and existing `--u-*` theme tokens. Use mint to identify Save, Done, and selected navigation; do not spend the first viewport on illustrations, motivational copy, progress summaries, or repeated collection headings. A brief “Nothing saved yet” with **Add a title or link** and **Discover** is sufficient. A feed still loading or failing must show that state honestly rather than manufactured article cards or fake totals.

## Publisher continuity and verification limits

The current defaults are [OpenAI News RSS](https://openai.com/news/rss.xml), [Thinking Machines RSS](https://thinkingmachines.ai/index.xml), [DeepMind RSS](https://deepmind.google/blog/rss.xml), [Hugging Face RSS](https://huggingface.co/blog/feed.xml), and the named first-party [Anthropic News](https://www.anthropic.com/news) HTML adapter. Keep them integrated; do not replace them with external links to reader apps or unofficial feed services.

The existing [source research](research.md) records direct XML/HTML checks from earlier on this same date. In this pass the web tool reported XML content types but could not parse the four feeds, and terminal requests were blocked by DNS restrictions; no new feed payload validation is claimed. Anthropic's official news listing was accessible. Feed freshness and extraction should therefore be verified by the backend's existing public-source checks, independently of this product audit. Missing covers/authors/excerpts remain valid data, not a reason to fabricate them.

## Correction acceptance checks

1. A clean normal app has no personal records, completion history, ratings, favorites, invented notes, or fake counts; real discovery can arrive independently.
2. A saved item exposes only To read/watch or Done. Its list row can complete/reopen it without a dialog; no progress, unit, page, session, or habit controls remain in the live product/API.
3. Library and Discover are directly reachable on desktop/mobile. Search and Save/Done/Dismiss work with keyboard and touch; real Unlikely UI remains imported and pinned.
4. All five sources and additional subscriptions collect in the background. Per-source auto-save obeys its stated start boundary, pause state, duplicates, dismissals, and owner edits across restart/resync.
5. A URL or title can be saved despite metadata failure; a Telegram/Hermes client can capture in one authenticated request without owner-wide edit credentials.
6. Anonymous access cannot read the private library or change anything. Enabling public sharing exposes only the promised read-only projection; disabling it removes public access.

These checks define the product correction. Full-text reader modes, recommendations/rankings, social features, goals, streaks, new taxonomies, and elaborate automation rules are outside this scope.
