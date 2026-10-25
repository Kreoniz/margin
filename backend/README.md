# Margin backend

Go 1.26+ and PostgreSQL 15+. Run from this directory:

```sh
go mod download
DATABASE_URL='postgres://margin:password@localhost:5432/margin?sslmode=disable' go run ./cmd/server
```

Build an executable with `go build -o margin ./cmd/server`. If the sandbox exposes an incomplete parent `.git` directory, use `go build -buildvcs=false -o margin ./cmd/server` to disable VCS stamping.

`DATABASE_URL` is required, either directly or through `DATABASE_URL_FILE`. Optional configuration:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port, bound to all container interfaces. |
| `STATIC_DIR` | `../web/dist` | Built SPA directory, relative to the process working directory. |
| `APP_PASSWORD` | empty | Optional owner password, at least 12 characters, at most 1024 bytes. Otherwise configure the owner once in the browser. |

`DATABASE_URL_FILE` and `APP_PASSWORD_FILE` read the corresponding value from a mounted secret file. A nonempty variable and its nonempty `_FILE` counterpart cannot both be set. Each file is limited to 64 KiB before trimming; trailing CR/LF characters are removed, while spaces and direct environment values are preserved. An empty database value is rejected; an empty password keeps the existing optional-password behavior. File errors report neither paths nor contents.

Run `./margin --healthcheck` to GET `http://127.0.0.1:$PORT/api/health` (`PORT` defaults to `8080`) with a three-second timeout. It exits 0 only for HTTP 200; redirects, other statuses, connection errors, invalid ports, and timeouts exit 1. This mode does not load database/password configuration, connect to PostgreSQL, run migrations, or start the server/worker, so the same static executable can serve as a Docker scratch health probe.

Use the database URL's TLS settings for the deployment. Keep the published container port on loopback unless intentionally exposing the service. Serve browser sessions over HTTPS. Cookies are opaque random secrets, HttpOnly, SameSite=Lax, expire after 30 days, and are stored only as SHA-256 hashes in PostgreSQL. HTTPS requests (including a proxy's `X-Forwarded-Proto: https`) receive Secure cookies. A reverse proxy must preserve the public Host and set the forwarded protocol correctly. Mutations reject cross-site browser requests and mismatched Origin/Referer hosts; origin-less HTTP clients remain supported. Vite's development proxy should preserve the browser Host or omit the Origin when proxying requests.

Private APIs require the owner cookie; Basic Auth and integration credentials cannot authorize them. The static UI, minimal health/session status, and read-only public media endpoints remain accessible. Passwords use salted PBKDF2-SHA256 with 600,000 iterations. Setup is atomic and single-use; login/setup attempts have per-address and global budgets with bounded memory. Logout revokes the cookie token in the database. Setting a different `APP_PASSWORD` on startup replaces the password and revokes existing sessions; an unchanged value preserves sessions. Removing the variable preserves the stored password.

Migrations are embedded, versioned, transactional, and serialized with a PostgreSQL advisory lock. Startup retries database connections for up to 60 seconds, migrates, inserts default subscriptions once, and starts collection. SIGINT/SIGTERM shuts down HTTP and the worker. No PostgreSQL extensions or external schedulers are required.

The default library is empty. The five default subscriptions are OpenAI, Anthropic, Thinking Machines Lab, Google DeepMind, and Hugging Face. Deleting a subscription persists across restarts. Startup never inserts sample library records.

Migration 002 converts later/active to pending and completed to done, preserving IDs, URLs, notes, tags and completion dates, and removes the obsolete media columns. It defaults every existing item to private. The previous 001 migration remains unchanged. Legacy sample identification runs before columns are dropped: it requires the `demo_library_v1=seeded` marker, every original seed field (including obsolete values), the exact original backdated creation timestamp relative to the untouched update timestamp, and the original completion timestamp pattern. Changed or newly created lookalikes are deliberately left alone. Pre-upgrade manual deletions with no surviving inbox entry have no recoverable URL history; the migration cannot infer those URLs. All known current URLs seed the durable seen ledger and every subsequent deletion preserves it. Positively identified samples are quarantined as `is_demo`, hidden from normal/public lists and mutation routes. Bootstrap reports `legacy_sample_count`; only owner `GET /api/legacy-samples` and `DELETE /api/legacy-samples` list/delete them. Cleanup never selects arbitrary personal records.

## Collection and limits

RSS and Atom share the safe HTTP fetcher. Anthropic uses only its first-party dated listing rows, including linked articles outside `/news/`. Sources and verified endpoints are described in `../docs/research.md`. Publisher outages, rate limits, and markup changes appear in each source's `last_error`, with the next retry scheduled normally. There is no third-party feed dependency.

The worker checks due sources on startup and every 30 seconds. Manual sync immediately requests an enabled-source pass, bypasses their intervals, and coalesces overlapping requests. Two-minute database leases prevent simultaneous collection across processes and recover after crashes. A successful or failed attempt persists `last_sync`, `next_sync`, and `last_error`. Source deletion retains saved library records. Existing inbox URLs and read/dismissed/saved state survive repeat collection.

Each sync stores at most the 100 newest valid entries among the first 500 feed entries; the initial sync is a bounded recent inbox, not a full publisher archive. Bootstrap includes at most 1,000 newest inbox entries across all states. Library and source lists are complete. Missing publication dates use discovery time. Sources default to `auto_save: false`. Explicitly enabling auto-save records a cutoff, with a fresh cutoff each time it changes from false to true. Only previously unseen URLs with a known publication timestamp at or after that cutoff become private pending library items. Undated and update-only entries remain in Discover. Historical, already-seen, read, dismissed, saved, and deleted records never auto-save again. A persistent URL ledger survives source and library deletion; existing library metadata, visibility, notes and completion never change during collection. Manual inbox save remains atomic and idempotent; deleting linked media resets its inbox entries to read for an explicit resave.

HTTP fetching disables environment proxies, validates every redirect, rejects private/special-use IPv4/IPv6 and mixed DNS answers, and dials pinned public IPs. Only HTTP(S), ports 80/443, and URLs without credentials are accepted. Limits are 20 seconds per HTTP request, five request destinations including redirects, 2 MiB decompressed metadata, and 8 MiB decompressed feed/HTML. Source discovery tries at most five advertised feeds within the API's 35-second deadline. Oversized, inaccessible, or non-HTML metadata returns an editable fallback with a warning. PDFs get paper metadata without PDF text extraction. Remote HTML is converted to plain text; unsafe cover/article links are discarded.

Canonical duplicate keys ignore fragments, common tracking parameters, default ports, trailing slashes, HTTP/HTTPS, and `www` variants. Query parameters otherwise remain significant. Manual duplicates use Unicode NFC, case, and whitespace normalization of title/author/kind. Keys are hashed to avoid PostgreSQL index-size limits. JSON mutations are bounded to 256 KiB. Media uses only pending/done status and private/public visibility. Creation accepts a title or URL; URL-only creation fetches metadata server-side with an editable fallback. Explicit submitted fields win over metadata. Tags are optional and notes are always owner-only, including on public records. Source intervals are 5–10,080 minutes.

## HTTP submission integration

The owner creates/rotates a submission token in Settings (`POST /api/integration/token`). Only its hash is stored; the secret appears in that response once. `GET` returns only configured/creation status and `DELETE` revokes it. Keep the token in your integration's secret environment. It can submit to `POST /api/integrations/items` and has no owner read/edit/share/source-management authority. A browser session alone cannot call submission. Requests accept only title, URL, author, kind, tags, and notes. Status/visibility overrides are rejected; new items always start private and pending. Duplicate canonical URLs or matching manual identities return the existing ID without changing its fields. The receipt contains only `{id,created}`, with 201/true for creation and 200/false for duplicates; no existing metadata is returned.

Example curl (replace environment placeholders locally):

```sh
curl --fail-with-body "$MARGIN_URL/api/integrations/items" \
  -H "Authorization: Bearer $MARGIN_SUBMISSION_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://example.com/article","tags":["reading"]}'
```

Python with the standard library:

```python
import json
import os
import urllib.request

request = urllib.request.Request(
    os.environ["MARGIN_URL"].rstrip("/") + "/api/integrations/items",
    data=json.dumps({"url": "https://example.com/article"}).encode(),
    headers={
        "Authorization": "Bearer " + os.environ["MARGIN_SUBMISSION_TOKEN"],
        "Content-Type": "application/json",
    },
    method="POST",
)
with urllib.request.urlopen(request, timeout=40) as response:
    receipt = json.load(response)
```

A Hermes HTTP tool can use the same endpoint, JSON body and bearer header populated from its secret environment. Configure it as a submission action; it cannot fetch the library or notes. These are HTTP interface examples only; no live Marvin/Hermes or Telegram configuration is required or changed.

## Validation

```sh
go test ./...
go vet ./...
TEST_DATABASE_URL='postgres://postgres:password@localhost:5432/margin_test?sslmode=disable' go test -race -count=1 ./...
```

The integration suite requires explicit `TEST_DATABASE_URL` pointing to a disposable database; it never falls back to the application `DATABASE_URL`. It creates randomly named schemas and drops **only those schemas**. It does not migrate, truncate, or delete the caller's application tables. The database account needs permission to create schemas. Without a database URL those tests explicitly skip; all deterministic parser, validation, fetch-security, origin, and SPA tests run without a database.

Optional first-party checks:

```sh
MARGIN_LIVE_SOURCES=true go test -run TestLiveDefaultSources -v ./internal/app
ANTHROPIC_HTML_FIXTURE=/path/to/downloaded-news.html go test -run TestAnthropicSnapshot -v ./internal/app
```

On a sandboxed laptop, keep build caches on disk:

```sh
mkdir -p .local/go-cache .local/go-tmp
GOCACHE="$PWD/.local/go-cache" GOTMPDIR="$PWD/.local/go-tmp" go test ./...
```

`.local/` is ignored. There is no Redis, browser automation, or frontend-only library persistence. The API follows `../docs/api-contract.md`.

`TRUSTED_PROXIES` optionally accepts comma-separated exact `/32` or `/128` proxy peers. Forwarded client addresses are ignored for other peers; the global login budget remains. Verify Caddy peer addresses after recreation.
