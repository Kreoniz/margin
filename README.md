# Margin

A small personal reading/watch list with an automatic article inbox. Two library states: **To read/watch** and **Done**. No progress counters, ratings, favorites or habit tracking.

Go + PostgreSQL + React/TypeScript, using the published **[Unlikely UI](https://www.npmjs.com/package/unlikely-ui)** package (`0.1.0-alpha.2`, pinned in pnpm-lock.yaml). The application imports its Theme, Button, Checkbox, Input, Select, Dialog, Field, Textarea and Toast components and compiled CSS. App styling uses **Tailwind CSS 4.3.3**, the Vite plugin and Unlikely UI's published Tailwind token adapter. Dark is the default, with mint accents and an optional light theme.

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

For remote Docker hosting, secrets, HTTPS, backups and domain changes, see the [production deployment runbook](docs/deployment.md) and [deployment verification](docs/deployment-2026-10-25.md).

## Use

- **Library:** searchable rows with larger uncropped previews, a quick done checkbox, media-type/tag filters, optional covers and an edit action. Add a title or paste a URL; metadata fills editable details automatically. Optional tags and private notes help retrieval.
- **Discover:** open/read, save or dismiss articles from subscribed sources. Saved, read and dismissed states remain separate from library status. Source controls are secondary to the article list.
- **Sources:** open directly from the compact navigation bar. Follow a feed or a website advertising RSS/Atom, change its interval or pause it. Auto-save is off by default. Enabling it saves only previously unseen, dated future articles as **private To read/watch** items. Existing discoveries, dismissed/read/deleted URLs and library metadata/visibility stay unchanged. Undated or update-only entries stay in Discover. OpenAI and Anthropic use locally served first-party publisher marks; their origins are recorded in `web/public/brands/README.txt`.
- **Sharing:** mark individual items Public in the editor. `/shared` and `/shared/{id}` are read-only, with no private notes, subscriptions, inbox or private item counts. Switching an item back to Private removes it from public responses. Visitors cannot edit.
- **Integrations:** Settings creates a submission token shown once. Rotate or revoke it at any time. A token can add private items; it cannot read your library, edit/delete records, manage sources or publish anything.

Keyboard uses **[TanStack Hotkeys](https://tanstack.com/hotkeys/latest/docs/framework/react/quick-start)** (`@tanstack/react-hotkeys` 0.16.0). **↑/↓** or **J/K** select rows; **Home/End** reach the first/last item and navigation loads additional rows as needed. **Enter/O** opens the selected item. In Discover, **S** saves, **R** toggles read/unread and **X** dismisses; in Library, **D** toggles Done and **E** edits. **Ctrl/⌘ Z** undoes the last status change. Selection moves to a visible row after filtering or removal.

**Ctrl/⌘ K** searches; **↓/Enter** leaves search for the first match. **Ctrl/⌘ Shift A** adds an item, and **Ctrl/⌘ Enter** saves the editor after normal form validation. **G then L/D** switch Library/Discover. **[/]** cycle status filters, **G then S** opens Sources, **Shift R** checks sources and **Ctrl/⌘ comma** opens Settings. **F1** opens the full guide, including from Settings. **Tab/Shift Tab** reach filters and individual actions; **Escape** closes dialogs and returns focus. Single-key shortcuts can be disabled in Settings; typing and dialogs retain their own keys.

Settings keeps Appearance and keyboard controls upfront; sharing, integration and sample maintenance are expandable. The theme choice persists. The first dark-default upgrade starts dark even if the old app automatically stored its light default; a new explicit light selection is respected thereafter.

Rows fade in and reposition briefly after list changes; headings, controls and dialogs have restrained transitions. Native CSS and Web Animations handle motion without an animation dependency. The OS/browser reduced-motion preference disables it, including active row animations. Uploaded images and explicit external-capture review flags are stored in PostgreSQL. Only theme and keyboard preferences are stored in the browser; library, owner sessions, sources and inbox live in PostgreSQL.

## Telegram / Hermes capture

The authenticated HTTP interface is usable by a Telegram bot or Hermes tool. No live gateway or Marvin configuration is installed or changed by this project. Keep its token in the integration's secret storage:

```sh
curl --fail-with-body "$MARGIN_URL/api/integrations/items" \
  -H "Authorization: Bearer $MARGIN_SUBMISSION_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://example.com/article"}'
```

A title is also sufficient: `{"title":"Something to read","kind":"book"}`. Optional fields: author, kind, tags, notes. Explicit fields take precedence over metadata. New items always start private/pending; status or visibility overrides are rejected. Canonical duplicates return the existing minimal receipt with HTTP 200; a new item returns 201. Cookie login alone does not authorize this submission endpoint. Python/Hermes examples and credential details are in [backend/README.md](backend/README.md).

## Collection

RSS/Atom is preferred. Verified endpoints and parser notes are in [docs/research.md](docs/research.md). Anthropic uses a named first-party HTML adapter; unsupported arbitrary HTML sites need a valid feed. Publisher outages/markup changes appear in Sources, preserving existing content.

The worker runs while the server is up, with per-source intervals, persistent leases, coalesced manual checks and durable duplicate/seen keys. Each sync retains up to 100 recent articles per source; the inbox API exposes its 1,000 newest entries and the UI renders 40 at a time. The personal library is uncapped. Metadata is best-effort; blocked publishers and PDF links receive editable fallbacks. Remote HTML is converted to plain text. Fetching rejects private/loopback/special-use destinations, unsafe schemes, credential-bearing URLs, rebinding and redirects into private networks; requests and bodies are bounded.

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

`mise run dev` enables development controls. In the owner dashboard, press **G then M** to load or clear nine fictional items, one for each media type. The same action is available under **Settings → Development** and in the dashboard footer. Loading shows all demo types together, including Done and To review examples. Every fixture is labeled `[Demo]`; its generated cover works offline, and fixtures are public so you can inspect the Collection too.

Other local server runs can opt in with `MARGIN_DEV_MODE=1`. It is off by default, and the fixture API is absent without it. Loading is idempotent. Cleanup removes only the recorded fixture IDs and unused fixture images, preserving real items even if they have the same title or `demo` tag. Owner login is still required. Clear fixtures before reusing that database outside development.
