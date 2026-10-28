# Margin corrected product/API contract

The product is a compact personal reading/watch list plus automatic discovery. Main destinations Library and Discover. Sources and integration controls are secondary. Keep Unlikely UI aesthetics; previews are large and uncropped. `/` is the public Collection; `/dashboard` is the private owner entry. No favorites, ratings, progress, units, or sessions/habits. Optional tags and private notes support finding/organizing.

## Data and migration

Media: `{id,title,author,kind,status,url,cover_url,description,notes,tags:string[],visibility,needs_review:boolean,created_at,updated_at,completed_at?:string}`. Kinds unchanged. ONLY status `pending` (To read/watch) or `done` (Done). Visibility `private` by default or explicitly `public`. Notes always owner-only. No progress/total/unit/rating/favorite current fields. PublicMedia excludes notes and private operational fields; public lists contain only explicitly public non-demo items and reveal no private counts/sources/inbox.

InboxItem existing shape/states new/read/dismissed/saved. Source existing fields plus `auto_save:boolean` (defaultfalse). Enabling auto-save sets a cutoff; only genuinely new discoveries published at/after cutoff become PRIVATE PENDING library items. No historical backfill surprise; seen/read/dismissed/deleted records do not resave; existing library metadata/visibility unchanged.

Forward migration: later/active->pending, completed->done; preserve IDs/URLs/notes/tags/completiondates. Drop obsolete columns, keep historic001 migration. Remove DEMO_SEED behavior entirely. Identify untouched prior seedrows only using demo_library_v1 marker + EXACT original seed contents including progress/description/tags/notes/url/status/cover + backdated creation timestamps; quarantine as is_demo, hidden normal/public lists. Never blanket-delete or label user-created/edited records. Expose owner-only legacy_sample_count/list/cleanup. Fresh databases have no personal items. Tests cover fresh/upgrade.

## Owner authentication

Single owner, no multi-user platform. Private APIs require browser session. Static UI/public APIs stay accessible. Opaque random cookie token hashed in PostgreSQL, HttpOnly/SameSite/bounded lifetime, logout revokes. Preserve same-origin browser mutation checks. Bounded login/setup brute-force limiter. No BasicAuth or integration token as general editing authority. APP_PASSWORD optionally supplies owner password min12 chars, otherwise first-browser atomic setup chooses securely hashed persisted password. No generated login shown in chat. Secure cookies on HTTPS; proxies preserve Host.

The sign-in limiter allows 10 attempts per client and 100 globally per minute, with bounded memory. By default client identity comes only from the immediate connection; forwarded headers are ignored. Startup parses the optional comma-separated `TRUSTED_PROXIES` with `app.ParseTrustedProxies` and assigns `Server.TrustedProxies` before serving requests. Only exact IPv4 `/32` or IPv6 `/128` prefixes are valid; broad subnets and malformed values fail configuration with a generic error. Trust only explicitly configured proxy addresses. If the immediate peer is trusted, parse `X-Forwarded-For` (all header lines, at most 4 KiB and 16 hops) and strip trusted hops from right to left, selecting the first untrusted address. Missing, malformed or oversized chains fall back to the immediate peer; other client-IP headers confer no trust. The edge proxy must replace untrusted incoming forwarded headers or append the actual connecting client. Already-configured setup returns 409 before decoding the body or consuming either login budget; the transaction still enforces atomic first setup.

GET /api/session -> `{authenticated:boolean,setup_required:boolean}`.
POST /api/setup `{password}` -> sessionJSON+cookie201; single-use/conflict afterconfigured.
POST /api/login `{password}` -> sessionJSON+cookie.
POST /api/logout ->204 revoke.

## Owner APIs

UUID/RFC3339 JSON, errors `{error}`. Reuse safe fetcher/parsers/worker/dedup.

- GET /api/health public minimal DB status.
- GET /api/bootstrap -> `{media:Media[],inbox:InboxItem[],sources:Source[],legacy_sample_count:number}` owner-only.
- GET/POST /api/media, PATCH/DELETE /api/media/{id} as before, revisedfields. Title OR URL valid on create; URL-only extracts metadata server-side with editable fallback. Duplicate409 `{error,existing_id}`.
- POST /api/metadata `{url}` -> `{title,author,kind,url,cover_url,description,warning?}` no progressfields.
- PATCH /api/inbox/{id} `{state:new|read|dismissed}` ->InboxItem.
- POST /api/inbox/{id}/save ->Media201/200 atomicidempotent, private default. Deleting linked media resets saved inbox toread for resaving.
- Sources GET/POST/PATCH/DELETE asbefore, POST `{url,name?,interval_minutes?,auto_save?}`, PATCH `{enabled?,interval_minutes?,name?,auto_save?}`.
- POST /api/sync ->202 existing coalescingworker.
- GET /api/legacy-samples ->owner-only quarantined media. DELETE /api/legacy-samples ->204 deleteONLY positivelyidentified samples.

## Sharing and integrations

GET /api/public/media ->PublicMedia[]. GET /api/public/media/{id} ->PublicMedia/404 inclprivateIDs. Public mutationsreject. No auth, no private data leakage. Frontend `/`, `/shared` and `/shared/{id}` are visibly read-only. No public login link; owner access is at `/dashboard`.

GET /api/integration/token -> `{configured:boolean,created_at:string|null}` owner-only, neverstoredtoken.
POST /api/integration/token -> `{token:string,created_at}` owner-only create/rotate randomsecret shownonceinapp; storedhashed. DELETE ->204 revoke.
POST /api/integrations/items requires Authorization Bearer submissiontoken, NOT browsercookieauthority. Accept `{title?,url?,author?,kind?,tags?,notes?}` titleORurlrequired. Metadata fills missingfields; explicitfieldswin. FORCE PRIVATE PENDING, reject status/visibility overrides. New201 or duplicate200 idempotent. Every successful submission returns ONLY `{id:string,created:boolean}` (`created:true` for 201, `false` for 200), including manual, URL, concurrent and legacy-sample-copy submissions. Duplicates preserve the existing item and reveal no title, URL, status, notes or other owner-edited metadata. Tokencannotreadprivate/list/notes, edit/delete/share ormanagesources. Boundbodies/rejectrevokedcredentials.

Document curl/Python/Hermes HTTP submission using environment token placeholders. No live Marvin/Telegram changes authorized. Tests isolated schemas and clearly named testrecords, no fabricated normal screenshots.


## Capture, images, and export (migration 004)

- `needs_review` is owner-only, default false for existing/manual items. New integration and automatic source captures set it true. Owner PATCH `/api/media/{id}` accepts `{needs_review:false}` independently of pending/done. Duplicates preserve existing review state. Public DTOs exclude this field.
- POST `/api/books/search` `{query,author?}` returns `{items:Metadata[],warning?}`. It uses up to five ranked Open Library results and the first relevant edition for each work, caches bounded results for 15 minutes, and throttles uncached calls to one per second. Provider failures return an empty result with a warning. Book JSON-LD on publisher URLs is preferred; explicit complete editor fields skip redundant metadata fetching on save.
- POST `/api/images` requires an owner session and raw JPEG/PNG bytes, at most 2 MiB and 1600px per edge. The server decodes and re-encodes JPEG, stores bytes in PostgreSQL, and returns 201 `{url:"/api/images/{uuid}"}`. Owner media `cover_url` accepts this exact local path or a validated public HTTP(S) image URL.
- GET `/api/images/{id}` returns JPEG only to the owner or when a non-demo public media item references that image. Otherwise 404. Responses are private/no-store so changing visibility takes effect on subsequent requests. Unattached images older than a day are cleaned on upload.
- GET `/api/export` requires the owner session and streams `margin-export.zip` containing versioned `library.json` plus referenced uploads at `images/{uuid}.jpg`. Uploaded cover paths become relative. Export includes private notes and review/completion state, but excludes credentials, sessions, tokens, demo rows, and orphan uploads. External image URLs remain URLs.
- Owner GET/POST/DELETE `/api/integration/browser-token` reads configuration, creates/rotates a once-shown token, or revokes it. Only the hash is stored. This is independent of `/api/integration/token`.
- POST `/api/integrations/capture` requires the browser token, never a session or submission token. Input is exactly `{url,action:"save"|"done"}`. New URLs create private items; done also marks them done. Existing canonical URL matches retain all metadata, visibility, and review flags; done changes completion only. Returns 201/200 `{id,created,action}`. Revocation/rotation is rechecked under a token-row lock after metadata fetching. Same-URL capture transactions are serialized. This bearer-only endpoint permits cross-origin extension requests; all cookie-authenticated mutation routes retain same-origin checks.

See [capture decisions and sources](capture-and-collection.md) and [extension setup](../extension/README.md).

## Opt-in development fixtures

`MARGIN_DEV_MODE=1` registers owner-only POST/DELETE `/api/dev/fixtures`. POST loads one labeled fictional public item per media kind with offline covers, varied completion states, and review flags; repeated calls reuse the tracked set. DELETE removes only tracked fixture IDs and fixture images unused by other items. Real duplicates are never adopted into the fixture manifest. Bootstrap includes `dev_mode:boolean` and `dev_fixture_count:number`. The default server has no fixture mutation routes. `mise run dev` opts in; the owner UI exposes G then M and Settings → Development.


## Metadata recovery (migration 005)

Owner Media adds `metadata_state` (`pending`, `ready`, `partial`, or empty for older/manual records) and a bounded `metadata_warning`. Public DTOs exclude both. Owner create/patch accepts `fetch_metadata:true` to persist a quick save without a remote fetch. A separate worker loop claims pending rows with 45-second leases and a 32-second fetch budget; unfinished work survives restart. Completion fills only missing/default-derived fields and preserves concurrent owner edits, completion, review, notes, and visibility. Changing URLs invalidates the previous lease. The owner UI polls while metadata is pending and offers retry through `/api/metadata`; retry fills the draft and saves normally.

Known first-party RSS feeds can recover metadata when HTML is blocked. Lookup matches the canonical URL across up to 5,000 body-bounded entries, independently of the inbox’s recent-item retention, and caches known feeds for ten minutes. No third-party mirror or invented author/image is substituted. Article, NewsArticle, BlogPosting, and Book JSON-LD supply structured fallbacks without loading contexts.

Browser capture optionally accepts `page_metadata:{title,author,description,cover_url}` from the page explicitly captured. Hints fill missing fields on new captures only and are bounded/validated like other input. They cannot update existing records. New-capture receipts may include a generic `warning`; duplicate receipts never disclose stored owner warning text. The extension uses activeTab plus scripting to read these metadata fields, verifies the captured URL, and scopes all feedback to the original tab/page.
