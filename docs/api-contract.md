# Margin corrected product/API contract

The product is a compact personal reading/watch list plus automatic discovery. Main owner destinations Up next (default), Library and Discover. Up next is a private ordered selection of unfinished saved items. Sources and integration controls are secondary. Keep Unlikely UI aesthetics; previews are large and uncropped. `/` is the public Collection; `/dashboard` is the private owner entry. No favorites, ratings, progress, units, or sessions/habits. Optional tags and private notes support finding/organizing.

## Data and migration

Media: `{id,title,author,kind,status,url,cover_url,description,notes,tags:string[],visibility,needs_review:boolean,created_at,updated_at,completed_at?:string}`. Kinds unchanged. ONLY status `pending` (Unfinished) or `done` (Done). Visibility `private` by default or explicitly `public`. Notes always owner-only. No progress/total/unit/rating/favorite current fields. PublicMedia excludes notes and private operational fields; public lists contain only explicitly public non-demo items and reveal no private counts/sources/inbox.

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

URL submissions persist pending metadata before any publisher request; a successful receipt acknowledges the committed item, not completed enrichment. Only newly created pending items trigger the existing durable metadata worker. Duplicates never fetch the publisher or change stored fields. The worker fills missing/default-derived fields and preserves later owner edits; publisher failures leave an available incomplete item with existing recovery/retry behavior. Deliberate submissions do not set a blanket review flag; unresolved ISBNs still do. Title-only submissions remain valid. Token validity is rechecked under a row lock in the submission transaction; storage failures cannot return success. Owner `POST /api/media` keeps its default synchronous lookup unless `fetch_metadata:true` is supplied.

Document curl/Python/Hermes HTTP submission using environment token placeholders. No live Marvin/Telegram changes authorized. Tests isolated schemas and clearly named testrecords, no fabricated normal screenshots.


## Capture, images, and export (migration 004)

- `needs_review` is owner-only, default false for existing/manual items. Automatic source captures retain their existing review behavior. Deliberately invoked browser/submission/MCP saves do not set a blanket flag; concrete unresolved identity problems such as a title-only ISBN still do. Owner PATCH `/api/media/{id}` accepts `{needs_review:false}` independently of pending/done. Duplicates preserve existing review state. Public DTOs exclude this field.
- POST `/api/books/search` `{query,author?}` returns `{items:Metadata[],warning?}`. It uses up to five ranked Open Library results and the first relevant edition for each work, caches bounded nonempty results for 15 minutes, and throttles uncached calls to one per second. Empty results can be retried, valid bare/path catalogue IDs are accepted, and malformed responses/provider failures return an empty result with a warning. Book JSON-LD on publisher URLs is preferred; explicit complete editor fields skip redundant metadata fetching on save.
- POST `/api/images` requires an owner session and raw JPEG/PNG bytes, at most 2 MiB and 1600px per edge. The server decodes and re-encodes JPEG, stores bytes in PostgreSQL, and returns 201 `{url:"/api/images/{uuid}"}`. Owner media `cover_url` accepts this exact local path or a validated public HTTP(S) image URL.
- GET `/api/images/{id}` returns JPEG only to the owner or when a non-demo public media item references that image. Otherwise 404. Responses are private/no-store so changing visibility takes effect on subsequent requests. Unattached images older than a day are cleaned on upload.
- GET `/api/export` requires the owner session and streams `margin-export.zip` containing versioned `library.json` plus referenced uploads at `images/{uuid}.jpg`. Uploaded cover paths become relative. Export includes private notes and review/completion state, but excludes credentials, sessions, tokens, demo rows, and orphan uploads. External image URLs remain URLs.
- Owner GET/POST/DELETE `/api/integration/browser-token` reads configuration, creates/rotates a once-shown token, or revokes it. Only the hash is stored. This is independent of `/api/integration/token`.
- POST `/api/integrations/capture` requires the browser token, never a session or submission token. Input is `{url,action:"save"|"done",page_metadata?:{title?,author?,cover_url?,description?}}`; other fields are rejected. New URLs create private items; done also marks them done. Existing canonical URL matches retain all metadata, visibility, and review flags; done changes completion only. Returns 201/200 `{id,created,action,metadata_state,warning?}`. `pending` means the item is saved but enrichment has not finished, rather than confirmed complete metadata. Known YouTube placeholder-page hints are discarded before enrichment. Revocation/rotation is rechecked under a token-row lock before commit; new captures persist before remote metadata fetching. Same-URL capture transactions are serialized. If an existing item is removed during capture, return 409 with an explicit retry message rather than silently recreating it. This bearer-only endpoint permits cross-origin extension requests; cookie-authenticated mutation routes retain same-origin checks.

See [capture decisions and sources](capture-and-collection.md) and [extension setup](../extension/README.md).

## Opt-in development fixtures

`MARGIN_DEV_MODE=1` registers owner-only POST/DELETE `/api/dev/fixtures`. POST loads one labeled fictional public item per media kind with offline covers, varied completion states, and review flags; repeated calls reuse the tracked set. DELETE removes only tracked fixture IDs and fixture images unused by other items. Real duplicates are never adopted into the fixture manifest. Bootstrap includes `dev_mode:boolean` and `dev_fixture_count:number`. The default server has no fixture mutation routes. `mise run dev` opts in; the owner UI exposes G then M and Settings → Development.


## Metadata recovery (migration 005)

Owner Media adds `metadata_state` (`pending`, `ready`, `partial`, or empty for older/manual records) and a bounded `metadata_warning`. Public DTOs exclude both. Owner create/patch accepts `fetch_metadata:true` to persist a quick save without a remote fetch. A separate worker loop claims pending rows with 45-second leases and a 32-second fetch budget; unfinished work survives restart. Completion fills only missing/default-derived fields and preserves concurrent owner edits, completion, review, notes, and visibility. Changing URLs invalidates the previous lease. The owner UI polls while metadata is pending and offers retry through `/api/metadata`; retry fills the draft and saves normally.

Known first-party RSS feeds can recover metadata when HTML is blocked. Lookup matches the canonical URL across up to 5,000 body-bounded entries, independently of the inbox’s recent-item retention, and caches known feeds for ten minutes. No third-party mirror or invented author/image is substituted. Article, NewsArticle, BlogPosting, and Book JSON-LD supply structured fallbacks without loading contexts.

Browser capture optionally accepts `page_metadata:{title,author,description,cover_url}` from the page explicitly captured. Hints fill missing fields on new captures only and are bounded/validated like other input. They cannot update existing records. New-capture receipts may include a generic `warning`; duplicate receipts never disclose stored owner warning text. The extension uses activeTab plus scripting to read these metadata fields, verifies the captured URL, and scopes all feedback to the original tab/page.

## Reliability and curation (migration 006)

- Owner Media adds `auto_added:boolean`; public DTOs exclude it. Only automatic source saves set it, while browser/integration/manual captures remain distinct. Hide automatic additions is a persisted browser preference across Library status/review filters. Historical backfill uses linked rows with equal transaction creation/discovery times, rather than labeling every manually saved discovery.
- Owner GET `/api/inbox` accepts `state` (new/read/saved/dismissed, default new), optional `source` UUID, literal search terms `q` (up to 1,000 bytes), and opaque `cursor`. It returns `{items:InboxItem[],total:number,next_cursor?:string}`. Pages contain at most 40 rows after filtering. Bootstrap adds `inbox_counts` across all states; its legacy recent snapshot is not the dashboard retrieval boundary.
- Existing-item editor PATCH is sparse. Optional `expected` carries the previous values of submitted fields and is compared under the media row lock. Conflicts return 409 `{error,code:"edit_conflict"}` without changing the record. `expected_url` also prevents old-URL lookup results being applied after a URL change. The UI retains the draft and can explicitly reload the latest item.
- `kind` is explicit unless `infer_kind:true` authorizes automatic inference. This intent persists across metadata jobs/retries; it is not a public field. A valid unresolved title-only ISBN is saved with `needs_review:true`, partial metadata and a correction hint; ordinary title-only books remain deliberate valid captures.
- Browser captures persist before publisher requests and trigger deferred work. Valid complete page hints can satisfy lookup immediately; partial hints are supplemented asynchronously. Restricted/deleted/blocked YouTube responses remain editable incomplete captures.
- Stored URLs retain fragment destinations. Duplicate keys continue to group ordinary anchors with their document, while explicit `#/` and `#!/` routes have distinct keys. Fetch requests strip all fragments. Previously discarded fragments cannot be reconstructed.
- Uploaded-image references use a generated UUID foreign key, so cleanup and attachment cannot commit a dangling relation. Missing draft images fail validation with a re-upload action; cleanup skips images locked by an in-flight attachment.
- Direct shared-item pages render full text; compact index cards link to details as well as originals. Empty Discover distinguishes source health and initial/paused states. Source failure recording is best-effort when storage is usable, and metadata worker storage failures are logged.
- Library Vim keys: `j/k`, `gg/G`, `Ctrl+d/u`, `h/l`, `/`, `a`, `e`, `o`/Enter, Space completion, `u` undo, and `dd` remove confirmation. Discover retains `s/r/x` save/read/dismiss. Modifier shortcuts and disable-able quick keys remain.

- Owner Library filters support multiple types, tags and YouTube channel display names. Values within a group use OR; groups combine with query/status using AND. Channel names are case-insensitive saved creator names, not canonical channel IDs. `v l`/`v g` switch List/Gallery; `f t`/`f g`/`f c` open searchable filter pickers. Layout switching retains selections. Public Collection retains its existing single type filter.

## Durable submission capture (migration 007)

Submission-token URL captures persist before remote enrichment, retaining their existing minimal receipts and authorization boundaries. Internal `title_explicit` / `author_explicit` database flags preserve supplied submission title/author intent through worker reloads and retries, including fallback-looking titles and intentionally empty authors. Owner title/author patches record the same intent. General owner creation and browser hints keep their existing inference behavior, including enrichment of the web Quick Save's generated title. The flags are not request fields and are excluded from owner/public JSON responses. Migration 007 only adds default-false flags; it does not change existing field values or infer historical intent. Owner create metadata-fetch defaults remain unchanged.

## Scoped agent access and private excerpts (migration 008)

Owner `GET /api/integration/agent-grants` reports read/save grant status. Owner
`POST` or `DELETE /api/integration/agent-grants/{read|save}` issues/replaces or
revokes only that scope; existing owner-session and same-origin protections
apply. Secrets appear once and only hashes persist. Submission/browser tokens
and owner cookies cannot authorize `/api/mcp`.

Stateless Streamable HTTP `/api/mcp` uses the official Go SDK with separate
bearer read/save catalogs and per-operation transaction-time revocation checks.
Read grants expose bounded `search_items` summaries without note/excerpt bodies;
explicit `get_item` can disclose private notes and selected excerpts under the
disclosed read consent. Save grants expose only `save_item`, reusing durable
private/Pending capture and minimal `{id,created}` duplicate receipts.
No edit/delete/publish/admin tools exist. First-client support is manually
configured Authorization headers for verified Marvin/Hermes, without OAuth
discovery/conformance. See [client contract](../integrations/hermes/mcp.md).

Browser-token capture optionally accepts `selection:{text,source_url}` only on
explicit user opt-in. Text is nonblank and at most 10,000 UTF-8 bytes; canonical
source must match the captured URL including its fragment. New captures store
private `selected_text` / `selected_text_source_url`, distinct from notes and
publisher text. Duplicate selection captures never append/overwrite: they
return `selection_saved:false` and a fixed generic warning, without existing
metadata details. Explicit Done remains intentional. Public DTOs omit both
fields; later URL corrections retain the original excerpt source. Other create,
PATCH, submission and MCP-save payloads cannot write excerpts.

Owner bootstrap adds `dev_fixture_ids:string[]` from the recorded fixture
manifest. Global Quick Find and MCP retrieval exclude these IDs and quarantined
legacy samples; ordinary Library fixture previews remain available. No title or
tag heuristic identifies fixtures.

## Editor and retrieval behavior

Global Quick Find searches all real saved items regardless of current list
filters, including notes and private excerpts, while retaining underlying view
context. Library and Discover have independent in-memory queries/filters.
Dismissal keeps one dirty draft in memory with Resume/Discard; saves, explicit
discard and successful sign-out clear it. Reload/browser close still loses it.
Duplicate feedback preserves the draft until explicit discard/navigation.

Replacing an existing URL with a different work requires Keep details or an
explicit metadata fetch, preview and application. Sparse field baselines protect
concurrent changes; failed/stale lookups preserve text. Same-document fragment
corrections omit unchanged metadata and preserve pending enrichment. New-item
Save as Done is secondary; ordinary save remains private/Pending by default.

## Private Up next (migration 009)

The queue starts empty, independently of saved library contents. Owner bootstrap includes `up_next:{version:number,ids:string[]}` in deliberate order; GET `/api/up-next` returns the same state. This is separate from Media/PublicMedia and absent from public, MCP read/export and capture/submission receipt representations. Existing credentials gain no access.

Owner POST `/api/up-next` requires a same-origin session and `{id:uuid,action:"add"|"remove"|"up"|"down",expected_version:number}`. Add accepts only a saved non-demo pending item and appends; remove retains the media; up/down swap adjacent queue positions across kinds. Repeated add/remove and boundary moves are idempotent. Effective mutations increment a singleton version. Missing/invalid input is 400, missing add target 404, missing owner session 401. A stale version is 409 `{code:"up_next_conflict",error,up_next:{version,ids}}` with no mutation. The UI acknowledges successful state and refreshes stale state without discarding drafts.

The singleton is locked before media rows. Capture takes its token/URL gates before the queue; no other queue writer takes those gates. Every application completion/deletion writer removes membership and bumps version in its transaction, including browser Done and development fixture deletion. Returning to unfinished never adds membership. Status Undo explicitly explains that it restores unfinished status without restoring priority, and checks the acknowledged status before applying. No background source, duplicate capture, Discover save or integration can add to this queue.

The owner view preserves mixed manual order and has a single artwork/list presentation. Native labeled Up/Down/Remove buttons support pointer and keyboard; moving keeps selection, removing selects the nearest remaining visible row. Reordering is disabled under any search/type/tag/channel filter with an explanation and Clear filters action. A filtered-empty shortlist differs from an initially empty shortlist, which offers Browse library. Library keeps its secondary layout choices.
