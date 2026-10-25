# Margin corrected product/API contract

The product is a compact personal reading/watch list plus automatic discovery. Main destinations Library and Discover. Sources and integration controls are secondary. Keep warm Unlikely UI aesthetics; remove dashboard, hero, big covers, favorites, ratings, progress, units, sessions/habits and topic navigation. Optional tags and private notes support finding/organizing.

## Data and migration

Media: `{id,title,author,kind,status,url,cover_url,description,notes,tags:string[],visibility,created_at,updated_at,completed_at?:string}`. Kinds unchanged. ONLY status `pending` (To read/watch) or `done` (Done). Visibility `private` by default or explicitly `public`. Notes always owner-only. No progress/total/unit/rating/favorite current fields. PublicMedia excludes notes and private operational fields; public lists contain only explicitly public non-demo items and reveal no private counts/sources/inbox.

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

GET /api/public/media ->PublicMedia[]. GET /api/public/media/{id} ->PublicMedia/404 inclprivateIDs. Public mutationsreject. No auth, no private data leakage. Frontend `/shared` and `/shared/{id}` visiblyread-only.

GET /api/integration/token -> `{configured:boolean,created_at:string|null}` owner-only, neverstoredtoken.
POST /api/integration/token -> `{token:string,created_at}` owner-only create/rotate randomsecret shownonceinapp; storedhashed. DELETE ->204 revoke.
POST /api/integrations/items requires Authorization Bearer submissiontoken, NOT browsercookieauthority. Accept `{title?,url?,author?,kind?,tags?,notes?}` titleORurlrequired. Metadata fills missingfields; explicitfieldswin. FORCE PRIVATE PENDING, reject status/visibility overrides. New201 or duplicate200 idempotent. Every successful submission returns ONLY `{id:string,created:boolean}` (`created:true` for 201, `false` for 200), including manual, URL, concurrent and legacy-sample-copy submissions. Duplicates preserve the existing item and reveal no title, URL, status, notes or other owner-edited metadata. Tokencannotreadprivate/list/notes, edit/delete/share ormanagesources. Boundbodies/rejectrevokedcredentials.

Document curl/Python/Hermes HTTP submission using environment token placeholders. No live Marvin/Telegram changes authorized. Tests isolated schemas and clearly named testrecords, no fabricated normal screenshots. Parent owns frontend/Docker/rootdocs; backendagent owns backend/**.
