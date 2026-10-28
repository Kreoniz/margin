# Production release — 2026-10-28

Deployed to **https://margin.kreoniz.ru** on `vdsina-ru` after the owner's explicit deployment request. [PR #2](https://github.com/Kreoniz/margin/pull/2) was merged as `ce2dcc48cb817b42b6b066ee3cb65329c52b3b1a`. There were no outstanding reviews, review threads, or configured CI checks.

## Release identity

- Application source: `14f6dccdbd93a137544bb654bea58521ca69080d`. Backend, frontend, and Dockerfile are identical to the merge commit.
- Release image: `margin:2026-10-28-14f6dcc`.
- Image config digest, verified after loading on the VPS: `sha256:78959d8425136a742a146df43b4f4aaaf2c0fc05c7959450bc423fc408666e47`.
- Transferred gzip archive SHA-256: `c10db229ef0142a6f8624342214df02632725d1cd947dae65e765ca9fa883679`.
- Previous image retained: `margin:2026-10-25-production-3`, config digest `sha256:e1e1e7e3b4a88b6f35eafdc65290f06d0afa4f69a0b9bb76afc41eb5eedb692a`.

The image was built locally from a clean Git export with the frozen frontend lockfile, transferred over SSH, checksum-verified, and loaded without copying credentials. Only the application container was recreated. PostgreSQL, its volume, private networking, resource caps, and file-mounted credentials were preserved. The application still runs as UID 65532 with a read-only filesystem and no published host ports. Development mode is disabled.

This release includes Collection and library layout/click-target fixes, metadata recovery, private uploads/export, browser capture, shared action hints, the selected Margin identity, and Vim navigation. The unpacked browser extension is version 1.1.0; users must load/reload it locally and connect it to the production address with a production browser token. No extension-store publication occurred.

## Backup and migrations

A verified pre-release custom-format backup is retained on the VPS at `/opt/margin/.local/backups/margin-20261028T162915693761269Z.dump`. It was restored into a new disposable database. The exact migration 004 and 005 SQL was then applied under the application role to another restored copy in one transaction. All 29 records in that snapshot and the owner configuration remained intact; the copy reached five migrations with the expected default review/metadata state. Both verification databases were removed.

The live application applied those additive migrations successfully. The existing owner password and sessions were not reset. A verified post-release backup is retained at `/opt/margin/.local/backups/margin-20261028T164020521088224Z.dump`. The daily backup timer remains enabled and its last service result is successful. These backups remain same-server recovery copies; this release did not add offsite storage.

## Proxy compatibility

Preflight found that the old 256 KB proxy limit would reject valid image uploads. Only the Margin site was changed: `POST /api/images` accepts at most 2 MiB, while other requests retain the existing 256 KB limit and timeouts. Both matchers are mutually exclusive. The updated example is in `deploy/Caddyfile`.

The candidate was validated with the installed Caddy 2.11.4 binary before reload. Every byte outside the Margin site was preserved, the individually mounted Caddyfile kept its inode, and Caddy was reloaded without restarting its container. The Caddy container ID and PostgreSQL container ID were unchanged. Its verified immediate peer remained the configured trusted proxy. Other site configuration was not changed.

## Verification

- Full Go tests with race detection against disposable PostgreSQL schemas, plus vet, passed before release. The production Docker frontend/backend build passed. The existing advisory frontend chunk-size warning remains.
- The preceding focused run passed all 24 desktop/mobile browser cases and 11 extension tests; a native Chromium extension smoke loaded its manifest, worker, icons, font, and commands.
- Live health, owner configuration, anonymous API denial, blocked setup/secrets, secure cookies, and disabled development endpoints passed.
- A temporary synthetic owner session verified private/public Collection visibility, owner-only warnings/notes, and protected image access. A 480,613-byte PNG uploaded successfully through Caddy; a request above 2 MiB was rejected, and oversized JSON remained rejected.
- A temporary capture token was installed only while no owner browser token existed. Duplicate Save/Done actions preserved notes, private visibility, and the review flag; the token could not read the library and duplicate receipts omitted the owner warning. Synthetic items, image bytes, sessions, and the owned temporary token were removed. Existing records, sources, and legacy-sample state were preserved by the smoke checks.
- The reported OpenAI PostgreSQL URL recovered its full title and 144-character description through the live application. Its missing-image warning remained explicit.
- All five configured sources reported a successful last sync without errors.
- All 13 served frontend files matched the release image byte-for-byte. The live Collection and owner sign-in rendered at 320px, 390px, and 1440px with no horizontal overflow or JavaScript errors. Local screenshots and verification scripts remain in ignored `.local/deployment/`.

## Rollback

The protected operational snapshot is `/opt/margin/.local/releases/20261028-14f6dcc/`: `env.before`, `Caddyfile.before`, and the validated candidate. The previous image remains loaded. For an application rollback, restore only the previous `MARGIN_IMAGE` value and recreate `app` with `--no-deps`, then check health and authentication. The added columns/tables are compatible with the previous application; older code will not provide the new capture/image features. Do not rewind the database over writes made after this release. Restore the proxy file in place and validate/reload only if reverting that scoped configuration is also needed.
