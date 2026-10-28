# Docker deployment

Use `deploy/compose.production.yaml` behind an existing HTTPS Caddy proxy. It publishes no host ports. PostgreSQL runs on a separate internal network; only the application joins the proxy network. The application runs as UID 65532 with a read-only filesystem, no capabilities and bounded CPU/memory/processes. The database is persistent, limited to 256 MiB, and the app uses its own non-superuser database role.

## First deployment

Build and test locally. Tag the image with a unique release identifier, transfer with `docker save` over SSH, and verify its image ID after `docker load`. Keep archives under ignored `.local/` on disk. Never copy `.env`, local credentials, cache folders or private backups into an image or Git repository.

Copy `deploy/production.env.example` to `.env.production`. Set an immutable release image, digest-pinned PostgreSQL 18 image, existing proxy network and **only the verified immediate Caddy peer** in `TRUSTED_PROXIES` (`/32` for IPv4, `/128` for IPv6). Verify that peer again after Caddy is recreated. Forwarded client addresses are ignored for other peers. Caddy must preserve Host and overwrite the forwarded HTTPS scheme.

Create a `0700` secret directory outside Git containing independent random `db_admin_password`, `db_app_password` and a `database_url` using the app role:

```text
postgres://margin:APP_DATABASE_PASSWORD@db:5432/margin?sslmode=disable
```

Use URL-safe database passwords. Secret files need to be readable by the mounted container UID; a `0444` file within a `0700` host directory allows this without granting ordinary host users access to the directory. Compose secrets are file mounts, not an encrypted secret manager. Never print their contents or include them in command arguments/logs.

Start **only the database** first:

```sh
docker compose --env-file .env.production -f deploy/compose.production.yaml up -d --wait db
```

For an existing installation, create a custom-format dump using `pg_dump --no-owner --no-acl`, securely transfer it, and restore with `pg_restore --no-owner --no-acl --role=margin -U margin_admin -d margin --exit-on-error`. This preserves the existing owner password hash and data; no plaintext owner password is needed. Restore only into the new empty database. Verify row counts, owner configuration, migrations and constraints before starting app. Revoke copied browser sessions on the destination with `DELETE FROM owner_sessions`; submission tokens remain valid.

For a fresh installation, initialize the owner through an SSH-only tunnel before opening ingress, or supply `APP_PASSWORD_FILE` temporarily at startup through a protected secret mount. Remove that startup credential after configuration. **Never expose an unconfigured setup page.**

Start the app, verify `/margin --healthcheck` succeeds and the internal `/api/session` reports `setup_required:false`. Add only the site block from `deploy/Caddyfile` to the shared Caddyfile, substituting the hostname. Back up the existing file, preserve its inode if it is individually bind-mounted, validate before reload, and compare all existing routes before/after. Do not restart the shared proxy or replace its configuration. The site blocks setup/health from the internet, uses HTTPS, bounded requests, CSP/HSTS and no access logs.

## Domain

The selected hostname is **margin.kreoniz.ru**. Set its A record to your ingress IPv4 address; add AAAA only if IPv6 ingress is verified. Add the exact hostname to Caddy, validate/reload and verify its certificate. Future hostname changes require no app rebuild or database changes. The owner must log in again on the new hostname because cookies are host-only. Never enable unrestricted on-demand certificate issuance.

## Backup and recovery

`scripts/backup-production.sh` creates a custom-format dump in `.local/backups`, verifies its table of contents before the atomic rename, and keeps 14 days after a successful backup. Install `deploy/margin-backup.service` and `.timer` into `/etc/systemd/system`, then `systemctl daemon-reload && systemctl enable --now margin-backup.timer`. It runs daily around 03:40 UTC with a 15-minute spread. Check `systemctl list-timers margin-backup.timer` and the last service result. Copy backups to independent protected storage; same-server backups alone do not protect against server loss.

Test a backup by restoring into a **new disposable database**, verify record/migration counts, then remove that database. Never restore over the running database. Keep production credentials separately in protected recovery storage.

Update sequence: verified backup → new tested image → recreate only app → health, auth/privacy and source checks. For releases with image uploads, apply the site's exclusive request-body matchers from `deploy/Caddyfile`: only `POST /api/images` gets 2 MiB, while other requests retain 256 KB. Validate with the installed Caddy binary before reloading; preserve existing timeout settings and neighboring routes. Retain the previous image and compatible dump. Rollback app only when schema-compatible; a database rewind requires a separate plan to preserve new writes. Do not use `down -v`, global Docker prune, or restart neighboring services. No automatic code deployment is installed.

## Optional publisher egress

Some publishers block the deployment region. The default fetcher remains direct and ignores ambient HTTP proxy settings. To route a specific publisher through a trusted SOCKS5 endpoint, set both `SOCKS_PROXY_ADDRESS` (host:port) and `SOCKS_PROXY_HOSTS` (comma-separated exact public hostnames). Empty values disable it. Wildcards and partial configurations are rejected. Destination DNS is still resolved locally; private, special-use and mixed public/private answers are rejected before the validated IP is passed to SOCKS. TLS continues to verify the original publisher hostname. Proxy failures do not fall back to direct access.

The optional `deploy/margin-egress.service` runs an unprivileged SSH dynamic tunnel, bound only to a private Docker bridge. Copy `deploy/egress.env.example` to ignored `.env.egress`, set that bridge address and a trusted egress target, and use a dedicated key generated on the deployment host. Systemd loads the key and pinned known-host entry from protected `.local/egress` files using `LoadCredential`; credentials do not leave that server. Verify the egress host key through your existing trusted SSH connection, not an unauthenticated key scan.

On the egress host, create an unprivileged key-only account with a non-login shell and `0700` home/SSH directories. Restrict its authorized key to the deployment server's source IP, disable shell/PTY/agent access, and allow forwarding only to the publisher's current public HTTPS addresses. `deploy/sshd-margin-egress.conf` provides the additional per-user SSH restrictions, including no sessions and local forwarding only. Verify destination addresses first. Validate `sshd -t` and confirm `sshd -T -C user=margin-egress,host=margin-egress,addr=YOUR_DEPLOYMENT_IP` before reloading SSH. Other accounts must retain their settings.

Verify the feed succeeds through the tunnel and unrelated destinations fail. Do not expose the SOCKS listener on a public interface. Address pinning intentionally fails closed if publisher DNS changes; verify and update only the narrow allowlist. This optional operational dependency is unnecessary on hosts where the publisher is reachable directly. Disable the app's two SOCKS variables together before removing the tunnel, its dedicated key/account and scoped SSH configuration.

Primary references: [Compose file secrets](https://docs.docker.com/compose/how-tos/use-secrets/), [Caddy HTTPS](https://caddyserver.com/docs/automatic-https), [PostgreSQL backup](https://www.postgresql.org/docs/current/backup-dump.html).
