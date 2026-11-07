# Margin MCP for Marvin / Hermes — 2026-11-02

Implemented against the existing A capture baseline (`7dd0ec2` plus the
working tree documented in `docs/deployment-2026-11-02-capture.md`). This document
does not register a connection in Marvin or authorize a gateway restart.

## Verified client and transport

Read-only inspection through the authorized `vdsina-ru-ts` alias found:

- Hermes package version **0.21.5**, checkout `dea65c7133f6247586edb4bb1952ac927a2ad9c8`, with local patches.
- Installed runtime `/home/hermes/.hermes/hermes-agent/venv/bin/python`.
- Installed Python **mcp 2.0.0**, **httpx2 2.7.0** (used by this SDK); httpx 0.28.1 is also installed.
- Latest protocol **2026-07-28**. The installed Hermes connection supports `protocol: stateless`, `transport: http`, and configured Authorization headers.
- Source SHA-256: `tools/mcp_tool.py` `c8c99d7fdfb57a21ab112b005c51103db40d41a8d6fae3628fd5933936ca90ad`; `tools/mcp_tool_transport.py` `915023c572f5cb56d0a99e7709a9d358be3a3c00cbd9f02fe7327815ffa7a8a0`; `tools/mcp_tool_server_run.py` `030e1deb23bcb8ec30594c89816517662ec4696f53e7081ac9755591db813f84`.

Margin uses official Go MCP SDK **v1.8.0** for bounded protocol decoding, schema
validation, negotiation, and stateless Streamable HTTP. This dependency replaces
custom JSON-RPC/transport machinery. The route is **`POST /api/mcp`**; responses use
JSON. There is no persistent protocol session, GET event stream, SSE fallback,
OAuth discovery, dynamic client registration, or token passthrough. The SDK also
accepts earlier protocol revisions; only the installed client/2026 workflow is
verified here, not a universal compatibility claim.

The [current transport specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
requires Origin validation and describes stateless POST requests. Margin rejects
foreign/null Origins and cross-site browser requests; native clients may omit
Origin. Every MCP HTTP operation requires its own bearer grant, including discovery.
The [authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
recommends OAuth for HTTP implementations. This deliberately narrow first-client
integration instead uses manually issued owner credentials supported by the
installed client; **it does not implement or claim OAuth conformance**. Clients
that require automatic OAuth cannot use this connection flow. Remote access must
use HTTPS. See also [SDK v1.8.0 release notes](https://github.com/modelcontextprotocol/go-sdk/releases/tag/v1.8.0).

## Owner consent, connection and revocation

In existing Settings → Marvin / MCP connection, deliberately issue either:

- **Read:** search all real saved items, including private items; explicitly retrieve private owner notes and selected excerpts.
- **Save:** add private Pending saved items; no read, edit, delete, publishing, bulk or administration tools.

There is one independent credential per grant. Each is displayed only on issue,
kept in component memory until Settings closes, and stored only as a hash on the
server. Reissuing replaces just that grant. Existing browser/submission/session
credentials are invalid at the MCP route; MCP credentials are invalid as owner
sessions or ordinary capture tokens. Grant controls keep owner-session and
same-origin checks.

For a deliberate later connection, supply the read credential in protected
Hermes configuration (the placeholders below are not actual credentials):

```yaml
mcp_servers:
  margin_read:
    url: "https://margin.example/api/mcp"
    transport: "http"
    protocol: "stateless"
    strict_redirect_headers: true
    headers:
      Authorization: "Bearer <read credential>"
```

If save is also desired, configure a **separate** `margin_save` entry using the
same endpoint and the save credential. Do not substitute a browser/submission
token. Nothing in this change writes this configuration or starts a connection.

Revoke either grant in Settings to stop subsequent requests. Each tool rechecks
the credential under a transaction lock. A revocation committed first prevents
admission; an operation already holding the shared grant lock may complete before
revocation finishes. Already retrieved data cannot be recalled. There is no claim
that untrusted instruction-like content is harmless to a consuming model: it is
returned as labeled data and cannot change server-side authority.

## Tool contracts

`search_items({query?,limit?,cursor?})`: literal case-insensitive whitespace words
must all match title, creator, original URL, description, owner notes, selected
excerpt/source or tags. Query is at most 500 UTF-8 bytes, limit defaults to 10 and
is bounded at 20. The response contains `items`, optional `next_cursor`, and
`data_label`. Summaries contain only `id,title,creator,kind,status,source_url`;
there are no private-note/excerpt snippets or private counts. Source URLs retain
fragments; title-only records have an empty URL.

Ordering is `(created_at DESC,id DESC)`. Cursors bind the normalized query,
initial time ceiling and last returned creation-time/ID. Use the returned cursor
with the same query. New captures after the first page are excluded from that
continuation. This is keyset pagination, not a historical snapshot: later edits
or deletion can change membership. Invalid/oversized cursors are rejected.

`get_item({id})`: returns the same identity/source summary plus
`metadata_description`, `owner_notes`, optional `selected_text` and
`selected_text_source_url`, bounded `tags`, and `data_label`. Notes are explicitly
owner notes; selected text is an owner-captured excerpt. Metadata may be scraped
or owner-edited; the schema does not prove per-field provenance. Text caps are
1,000 bytes each for title/creator, 20,000 description, 100,000 notes, 10,000
excerpt, and 50 tags of 100 bytes each. Stored source URLs are validated at 4,096
bytes. Read tools exclude legacy quarantined samples **and** generated fixtures
identified by recorded `dev_media_fixtures_v1` MediaIDs, independently of names,
tags, or current dev mode. Ordinary Library previews remain intact. Owner-only
bootstrap includes those existing recorded IDs as `dev_fixture_ids`.

`save_item({url?,title?,author?,kind?,tags?,notes?})`: same strict allowed fields
and durable operation as A's submission route. URL or title is required. It
commits before any publisher fetching; enrichment uses the existing durable
worker and explicit title/author intent flags. New records are private/Pending
without a blanket review obligation. Concrete unresolved identity problems still carry a review flag. Saves never add to Up next. The only receipt fields are `{id,created}`. Duplicate matching
never merges notes, overwrites a record, or exposes an existing record's details.
The read credential has no save tool; the save credential has no read tools.

Credentials and internal database/protocol errors are omitted from tool results.
HTTP failures use 401 for missing/invalid/revoked credentials and 403 for rejected
Origins; tool scope is enforced by separate tool catalogs plus transaction-time
scope checks. Unknown or unauthorized tools cannot execute. MCP input is bounded
at 256 KiB. No update/delete/publish/admin tools are installed.

## Private selected-text capture

Only the browser-token `POST /api/integrations/capture` route accepts optional:

```json
{"url":"https://source.example/page#paragraph","action":"save","selection":{"text":"An explicitly selected excerpt","source_url":"https://source.example/page#paragraph"}}
```

Text must be nonblank and at most **10,000 UTF-8 bytes**, never implicitly
appended to notes. Source is independently canonicalized and must equal the
captured canonical URL **including its fragment**. New captures store private
`selected_text`/`selected_text_source_url` and return `selection_saved:true`.
Both owner matching and MCP search include the excerpt/source. Public DTOs
exclude both fields.

Existing duplicate URLs (including another ordinary anchor) preserve all stored
notes/excerpts/source and return `selection_saved:false` with the fixed warning:
“Already saved. The selected text was not added. Open Margin to review the
existing item.” That receipt omits the existing metadata state and excerpt.
Ordinary capture receipts remain unchanged, without `selection_saved`. Explicit
Done retains the existing intentional completion behavior. Later owner URL edits
never rebind the excerpt's original source. Owner create/PATCH, submission and
MCP save cannot write excerpt fields.

## Validation status and commands

Implementation-agent checks:

- TypeScript `pnpm --dir web check`, existing utility tests, and `node --test web/tests/selection-matching.test.ts`: passed.
- Focused backend non-database tests: query bounds, unknown-field rejection via official SDK, selected-text byte/source validation and public DTO privacy passed.
- **Installed-client fixture passed:** actual installed Hermes `_streamable_http_transport` and `_negotiate_session`, actual Python SDK, synthetic search/get including original fragment/private note, and separate save/duplicate receipts. It used a temporary SSH loopback forward to a synthetic SDK fixture, no live personal Margin data. A Python audit hook denied filesystem writes and profile/config/message-data reads; no gateway, registry, configuration, LLM or Telegram interaction occurred.
- Database acceptance tests were **skipped** because `TEST_DATABASE_URL` was not supplied. They do not establish acceptance; migration, transaction behavior and production-handler compatibility still require the parent's disposable database run. Nothing has been deployed by this child.

From `backend/`, using a disposable PostgreSQL database supplied by the parent:

```sh
go test -race -count=1 ./internal/app -run 'TestAgent|TestSelection|TestCaptureSelection|TestSubmission'
HERMES_FIXTURE_SSH=vdsina-ru-ts go test -count=1 -v ./internal/app -run '^TestAgentInstalledHermesDatabaseFixture$'
```

Set `TEST_DATABASE_URL` securely in the environment for both database commands.
The second runs the installed client against the **real production handler**
with isolated-schema synthetic records and fixed fixture-only credentials. The
already passed transport-only exercise is independently reproducible with:

```sh
HERMES_FIXTURE_SSH=vdsina-ru-ts go test -count=1 -v ./internal/app -run '^TestAgentInstalledHermesClientFixture$'
```

Both opt-in tests use port 19783 on remote loopback and fail on a collision; they
never terminate another user's listener. No acceptance claim should convert a
database-skipped test to a pass. Extension UI, final browser tests, integration,
review and deployment belong to the parent.

Parent acceptance on 2026-11-02 supplied an isolated PostgreSQL database. The
focused MCP/selection/capture tests passed with race detection and no skips. The
installed Hermes database fixture also passed against the real Margin handler,
including search/get and save/duplicate workflows. The full backend race suite
and vet passed. These checks used synthetic records and fixture credentials;
Marvin's live configuration, gateway, private library and messaging were not
changed or exercised. Release evidence is in
[the B–F deployment record](../../docs/deployment-2026-11-02-complete.md).
