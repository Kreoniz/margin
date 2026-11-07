# Margin

A personal library for choosing what to read, watch, or play next, with an automatic article inbox. **Up next** is your private, deliberately ordered shortlist. Saved items remain **Unfinished** or **Done**. No progress counters, ratings, favorites or habit tracking.

Go + PostgreSQL + React/TypeScript, using the published **[Unlikely UI](https://www.npmjs.com/package/unlikely-ui)** package (`0.1.0-alpha.3`, pinned in pnpm-lock.yaml). The application imports its Theme, Button, Checkbox, Input, Select, Dialog, Field, Textarea and Toast components and compiled CSS. App styling uses **Tailwind CSS 4.3.3**, the Vite plugin and Unlikely UI's published Tailwind token adapter. Dark is the default, with mint accents and an optional light theme.

## Run

```sh
cp .env.example .env
# Set a long URL-safe POSTGRES_PASSWORD.
docker compose up -d --build
```

Open **http://localhost:8787** for the public Collection. Go directly to **http://localhost:8787/dashboard** to create your owner password or sign in. Alternatively set `APP_PASSWORD` (12+ characters) before starting. The password is securely hashed, and editing/private reads require an owner cookie session. There is one owner, no account platform.

The library starts empty. Five default sources collect real articles into **Discover**: OpenAI, Anthropic, Thinking Machines Lab, Google DeepMind and Hugging Face. Discovery articles enter the personal list only when saved, or when explicitly opted into future auto-save. Counts reflect database contents; no sample library is generated.

Docker stores data in `margin_postgres_data`. Ordinary rebuilds, `docker compose down` and container recreation retain it. The runtime image contains one non-root Go binary, the frontend and CA certificates, runs read-only, and publishes only the app on loopback. For remote hosting, configure the owner before exposure and use an HTTPS reverse proxy preserving Host and setting `X-Forwarded-Proto: https`. Public sharing is an explicit per-item choice; private API routes remain protected.

```sh
docker compose logs -f app
docker compose down
docker compose up -d --build
```

The project bridge defaults to MTU 1376, verified for this laptop's VPN path. `DOCKER_MTU` can adjust it for another host; keep it at or below the outbound path's MTU. If changed, recreate Margin's network with `docker compose down` **without `-v`**, then `docker compose up -d`. No Docker daemon or host VPN change is needed.

For remote Docker hosting, secrets, HTTPS, backups and domain changes, see the [production deployment runbook](docs/deployment.md) and [current deployment verification](docs/deployment-2026-11-02-complete.md).

## Use

- **Up next:** the default owner view. Start with an empty shortlist, browse Library and explicitly add unfinished saved items. Add appends; native Up/Down buttons change the mixed order across books, videos, games and other kinds. Tab to each action and press Enter/Space. Search and filters preserve manual order; clear them to enable reordering. Remove keeps the saved item. Done removes it; Undo returns it to unfinished without restoring its place. The queue is private and shared across owner tabs/devices; stale changes show the latest order and ask you to retry.
- **Library:** Side by side, Shelves and List presentations. Side by side keeps a compact article/paper queue beside visual media; Shelves puts that queue below. Books, videos and games use separate shelves with uncropped artwork and aligned cards. Narrow screens stack the sections and offer direct section jumps. The browser remembers your presentation; all three share search, filters and item actions, including completion, review, editing and removal. Add a title or paste a URL; metadata fills editable details automatically. Quick saves finish missing details in the background; explicit type choices survive retries, and incomplete captures show recovery actions. Unresolved ISBNs appear under Needs attention. Deliberate browser and integration saves do not create a review obligation; duplicates preserve existing review flags. Existing-item edits update only changed fields and retain drafts when an overlapping edit conflicts. Optional tags and private notes help retrieval.
- **Discover:** open/read, save or dismiss articles from subscribed sources. Saved, read and dismissed states remain separate from library status. Source controls are secondary to the article list.
- **Sources:** open directly from the compact navigation bar. Follow a feed or a website advertising RSS/Atom, change its interval or pause it. Auto-save is off by default. Enabling it saves only previously unseen, dated future articles as **private To read/watch** items. Existing discoveries, dismissed/read/deleted URLs and library metadata/visibility stay unchanged. Undated or update-only entries stay in Discover. OpenAI and Anthropic use locally served first-party publisher marks; their origins are recorded in `web/public/brands/README.txt`.
- **Sharing:** mark individual items Public in the editor. `/shared` and `/shared/{id}` are read-only, with no private notes, subscriptions, inbox or private item counts. Switching an item back to Private removes it from public responses. Visitors cannot edit.
- **Integrations:** Settings creates a submission token shown once. Rotate or revoke it at any time. A token can add private items; it cannot read your library, edit/delete records, manage sources or publish anything.

Keyboard uses **[TanStack Hotkeys](https://tanstack.com/hotkeys/latest/docs/framework/react/quick-start)** (`@tanstack/react-hotkeys` 0.16.0). **h/j/k/l** and **←/↓/↑/→** move between items by their on-screen position in visual views. **j/k** or **↑/↓** move through List and Discover; **Home** and **Ctrl+Home** return to the page top and first item; **End** reaches the last item, loading additional items as needed. **Ctrl+Home** also works with an empty list. **Enter/o** opens the selected item. In Discover, **s** saves, **r** toggles read/unread and **x** dismisses; in Library, **Space** toggles Done, **e** edits, and **d then d** opens removal confirmation with Keep it focused first. **u** or **Ctrl/⌘ Z** undoes the last status/review change. **Ctrl+d / Ctrl+u** move half a page down/up; **g then g** returns to the page top and first item; **G** reaches the last item. Returning to the first visual row with item navigation also reveals the heading and filters. Uppercase **G** means **Shift+g**. Selection moves to a visible row after filtering or removal.

**Ctrl/⌘ K** opens global Quick Find from Library or Discover, across all real saved items regardless of active filters, including private notes and saved excerpts. **↓/↑** choose a result; **Enter** opens its original URL (or edits a title-only item). Copy/Edit actions and further matches remain available; Escape restores focus and the underlying context. **/** focuses ordinary scoped list search; **↓/Enter** leaves that search for the first match. **a**, **n** (legacy alias), or **Ctrl/⌘ Shift A** adds an item, and **Ctrl/⌘ Enter** saves the editor after normal form validation. Failed saves bring the error and recovery controls into view; reloading explicitly discards unsaved edits and returns focus to Title. Saving a reviewed capture can mark it reviewed without changing completion. **g then n/l/d** switch Up next/Library/Discover. **[/]** cycle status filters, **g then s** opens Sources, **Shift+r** checks sources and **Ctrl/⌘ comma** opens Settings. **F1** opens the full guide, including from Settings. **Tab/Shift Tab** reach filters and individual actions; **Escape** closes dialogs and returns focus. Vim quick keys, including **Ctrl+d/u**, can be disabled in Settings; typing and dialogs retain their own keys. Hover hints wait 400 ms; keyboard focus shows help immediately.

Settings → Library can hide automatic RSS/parser auto-saves, independently of completion or review. The preference persists in this browser; manual saves and Discover remain available. Rows include a remove button with confirmation, and the seen ledger prevents deleted automatic items from being auto-saved again. Article previews fall back to publisher logos or first-party favicons. Marks for all five default publishers are local; custom-source favicons and external covers contact their image host.

Library and Discover retain independent in-memory queries and filters across view switches and saves. Save receipts can open/edit an item without clearing filters. New captures offer a secondary Save as Done. Changing an existing URL to another work requires keeping current details or explicitly fetching, previewing and applying replacement details; fragment corrections preserve pending enrichment.

Settings keeps Appearance and keyboard controls upfront; sharing, integration and sample maintenance are expandable. The theme choice persists. The first dark-default upgrade starts dark even if the old app automatically stored its light default; a new explicit light selection is respected thereafter.

Rows fade in and reposition briefly after list changes; headings, controls and dialogs have restrained transitions. Native CSS and Web Animations handle motion without an animation dependency. The OS/browser reduced-motion preference disables it, including active row animations. Uploaded images and attention flags are stored in PostgreSQL. Library view, theme, Vim-key and hide-automatic-additions preferences are stored in the browser; library, owner sessions, sources and inbox live in PostgreSQL.

One dirty editor draft is retained in memory after Cancel, Escape, Close or outside dismissal, with Resume/Discard controls. It also survives session-expiry sign-in. After reauthentication it reopens with its field baselines and edits; no private draft is written to local/session storage. Save, discard and successful deliberate sign-out clear it. Reloading or closing the browser still discards an unsaved draft.

**v then b / v then s / v then l** switch Side by side/Shelves/List. The older **v then g** shortcut and saved Gallery preference open Shelves. Visual views group items by type and keep newest-first order within each section; List keeps one newest-first queue. **h/l** move horizontally without wrapping, while **[/]** remain dedicated status-tab shortcuts. Each section initially shows up to 40 items, with more revealed by paging or navigation. **f then t / f then g / f then c** open searchable multi-select Types/Tags/Channels. Pick any matching value within a group; groups combine with search and status. Saved YouTube channel names are clickable filters. Selections persist when switching layouts; chips remove individual selections.

## Telegram / Hermes capture

For the short browser and Marvin setup walkthrough, see [Capture setup](docs/capture-setup.md). A portable Hermes skill is included in `integrations/hermes/margin-save`; it was [installed and configured for Marvin on 2026-10-31](docs/deployment-marvin-capture-2026-10-31.md). Send `/reload-skills` once in Telegram before using the new command.

The authenticated HTTP interface is usable by a Telegram bot or Hermes tool. Marvin's installed skill uses its profile secret environment; other installations can use the same interface. Keep its token in the integration's secret storage:

```sh
curl --fail-with-body "$MARGIN_URL/api/integrations/items" \
  -H "Authorization: Bearer $MARGIN_SUBMISSION_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://example.com/article"}'
```

A title is also sufficient: `{"title":"Something to read","kind":"book"}`. Optional fields: author, kind, tags, notes. Explicit fields take precedence over metadata. New items always start private/pending; status or visibility overrides are rejected. Canonical duplicates return the existing minimal receipt with HTTP 200; a new item returns 201. Cookie login alone does not authorize this submission endpoint. Python/Hermes examples and credential details are in [backend/README.md](backend/README.md).

YouTube metadata supports watch/share/short/embed/live URLs, but duplicate identity still follows the generic URL policy. A share link, watch link, or differing query parameters can remain separate saved items; marking one Done does not necessarily update its aliases. Existing records, notes and visibility are never automatically merged.

## Marvin / MCP and selected text

Settings → Marvin / MCP connection issues separate, revocable read and save credentials. Read consent includes private notes and excerpts on explicit item retrieval; search returns bounded summaries. Save can only add private Pending items and returns minimal duplicate receipts. Existing browser/submission credentials never gain read access. [Verified Hermes connection instructions](integrations/hermes/mcp.md) describe manual header authentication and its limits. The installed client passed synthetic real-handler/database checks; this release does not register a live Marvin connection or restart its gateway.

Extension 1.2.0 adds an unchecked **Include selected text** option for deliberate capture. It stores up to 10,000 UTF-8 bytes privately with the original source URL, separately from owner notes. Duplicates preserve existing notes/excerpts and report that the new excerpt was not added. Direct shortcuts stay URL-only. Reload the unpacked extension after updating its files; the backend deployment does not update an installed browser extension.

## Collection

RSS/Atom is preferred. Verified endpoints and parser notes are in [docs/research.md](docs/research.md). Anthropic uses a named first-party HTML adapter; unsupported arbitrary HTML sites need a valid feed. Publisher outages/markup changes appear in Sources, preserving existing content.

The worker runs while the server is up, with per-source intervals, persistent leases, coalesced manual checks and durable duplicate/seen keys. Each sync collects up to 100 recent articles per source. Discover filters and searches on the server, with accurate totals and cursor pages of 40; older unread articles remain accessible even behind newer saved or dismissed history. Bootstrap retains a bounded recent-inbox snapshot for compatibility. The personal library is uncapped. Metadata is best-effort; blocked publishers and PDF links receive editable fallbacks. Remote HTML is converted to plain text. Fetching rejects private/loopback/special-use destinations, unsafe schemes, credential-bearing URLs, rebinding and redirects into private networks; requests and bodies are bounded.

## Existing installation upgrade

Back up first, then rebuild normally. Forward migration 002 removes obsolete tracking fields and maps old later/active items to To read/watch, completed to Done. All existing items become private. IDs, URLs, tags, notes and completion dates are retained.

Untouched legacy preview samples are positively identified from the old seed marker, exact full seed values and original timestamp pattern. They are quarantined, excluded from real/public lists, and can be reviewed/removed in Settings. Edited, inbox-linked or newly created lookalikes are preserved as user records. Migration 003 keeps quarantined samples out of real duplicate identities, so adding a real copy works normally. No broad title-based deletion occurs. Historic deletions whose URLs were absent from both old library and inbox cannot be reconstructed; all surviving URLs initialize the seen ledger, and subsequent deletions retain their history.

```sh
mkdir -p backups
(umask 077; docker compose exec -T db pg_dump -U margin margin > backups/margin.sql)
```

Keep the dump on durable storage. Restore into an empty database using `docker compose exec -T db psql -U margin -d margin`. `docker compose down -v` deletes the volume; omit `-v` for ordinary stops.

## Develop and test

```sh
mise trust
mise install
cd web
mise exec -- pnpm install --frozen-lockfile
cd ..
mise run dev
```

Create `.env` first. The development task starts PostgreSQL, Go on 8088 and Vite on 5178. Vite preserves Host for same-origin mutation checks. Use a separate disposable database for tests; don't point browser tests at your personal instance. Build/package caches remain on disk under normal tool defaults or ignored `.local/`, never RAM-backed `/tmp`.

```sh
cd web
pnpm test
pnpm build
pnpm exec playwright install chromium
E2E_TEST_INSTANCE=1 BASE_URL=http://127.0.0.1:5178 pnpm test:e2e
```

Browser tests require a dedicated empty instance. They create its test owner, generate explicitly named test items, then remove those items. `E2E_OWNER_PASSWORD` supplies a test-only password when needed; the fixture default is for disposable QA only. Tests cover owner access/logout, empty states, compact two-state flow, capture/metadata, sharing/private notes, submission permissions/revocation, sources, discovery, keyboard navigation, light/dark accessibility and desktop/mobile layouts. Public/anonymous tests use separate browser/request contexts.

```sh
cd backend
go test ./...
go vet ./...
TEST_DATABASE_URL='<disposable PostgreSQL URL>' go test -race -count=1 ./...
```

Backend tests use isolated schemas, require explicit TEST_DATABASE_URL and never fall back to the application database. They cover fresh/upgrade migrations, legacy sample precision, auth/CSRF/limiting, sharing, token scope/concurrency/revocation, auto-save cutoffs/seen history, metadata/parsers and existing worker/storage behavior. See the backend guide for optional live-source checks.

[Corrected product audit](docs/product-correction.md) · [Design research](docs/product-correction-research.md) · [API contract](docs/api-contract.md). Inter is self-hosted with its SIL Open Font License; Unlikely UI, TanStack and Tailwind license notices are retained under web/public/licenses.

See [capture, book matching, images, export, and Collection changes](docs/capture-and-collection.md) and the [Helium extension setup](extension/README.md).

### Development demo data

`mise run dev` enables development controls. In the owner dashboard, press **G then M** to load or clear nine fictional items, one for each media type. The same action is available under **Settings → Development** and in the dashboard footer. Loading shows all demo types together, including Done and Needs attention examples. Every fixture is labeled `[Demo]`; its generated cover works offline, and fixtures are public so you can inspect the Collection too.

Other local server runs can opt in with `MARGIN_DEV_MODE=1`. It is off by default, and the fixture API is absent without it. Loading is idempotent. Cleanup removes only the recorded fixture IDs and unused fixture images, preserving real items even if they have the same title or `demo` tag. Owner login is still required. Clear fixtures before reusing that database outside development.

Current reliability changes and verification are recorded in [the council remediation log](docs/council/2026-10-30/remediation.md). YouTube video metadata uses its first-party oEmbed endpoint with a page fallback and explicit incomplete state for restricted/blocked/unavailable responses. Browser capture persists before remote enrichment.
