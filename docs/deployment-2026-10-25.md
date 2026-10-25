# Production deployment — 2026-10-25

Margin is deployed at **https://margin.kreoniz.ru** on the owner’s `vdsina-ru` server. The source repository is private: [Kreoniz/margin](https://github.com/Kreoniz/margin). Deployment, private push and the hostname were explicitly requested by the owner. The owner configured DNS; no domain was purchased.

## Release and isolation

Application revision: `ea272d4d3b76c240ab4400629a69d154b91cd944`. Release image: `margin:2026-10-25-production-3`, config digest `sha256:e1e1e7e3b4a88b6f35eafdc65290f06d0afa4f69a0b9bb76afc41eb5eedb692a`. The image is built locally from a clean Git export, transferred over SSH and checksum-verified before loading. Operational documentation may advance the branch beyond that application revision.

The Go/SPA app and PostgreSQL run in separate Docker containers under `/opt/margin`. No host ports are published. PostgreSQL has its own internal network and durable volume. The app joins the existing Caddy ingress network, runs as UID 65532 with a read-only filesystem, dropped capabilities and no privilege escalation, capped at 192 MiB. PostgreSQL is capped at 256 MiB and the app’s database role is not a superuser. Database credentials are file-mounted and excluded from Git and images.

Caddy received one additive site block. Its existing container ID, mounted-file inode, prior site blocks and global settings were preserved. All 11 pre-existing sites retained their baseline HTTP statuses. Margin redirects HTTP to HTTPS and has a trusted certificate, HSTS, CSP, no-referrer and frame protection. Public ingress blocks setup, health, environment and Git paths. The exact trusted Caddy peer is configured for login throttling.

## Data and security

The existing local database was backed up with a consistent custom-format dump, verified and restored into the new database. The owner’s password hash and data were preserved; copied browser sessions were revoked. The normal library was empty and remains usable empty. Twelve earlier preview samples remain quarantined. No demo data was added. A synthetic production privacy fixture and its short-lived session were removed after verification; no owner password was changed or exposed.

Security review fixes: submission receipts expose only `{id,created}`; forwarded client addresses require an exact trusted proxy peer; rejected per-client login requests cannot drain the global budget. First-run setup is completed before ingress and blocked at the edge. Public responses exclude private notes and owner-only data.

Thinking Machines returns Cloudflare 403 from the Russian VPS while its RSS works from the owner’s Finnish VPS. Only its exact apex/`www` hosts use optional SOCKS egress over a dedicated SSH tunnel. The tunnel listens only on a private Docker bridge. Its unprivileged egress account is restricted to the deployment source IP and the two verified publisher HTTPS addresses, with shell sessions, remote forwarding, Unix-socket forwarding, PTY and agent forwarding disabled. The host key is pinned through an existing trusted SSH connection. No private key leaves the deployment server and no public proxy port was opened. DNS validation, public-IP checks, destination pinning and TLS verification remain active. Other publishers remain direct. See the [runbook](deployment.md) for address changes and removal.

## Verification

- Complete Go/PostgreSQL suite with `-race`, vet and production build passed against an isolated database. The later publisher-routing change passed race tests covering exact-host routing, DNS/SSRF checks, pinning, redirects, TLS hostname validation, handshake cancellation and config validation.
- Eight focused desktop/mobile browser checks passed against the disposable release instance, covering access, sharing/privacy, submission scope/idempotency and theme behavior. The prior full UI suite had 34 passing desktop/mobile cases.
- Production synthetic HTTP checks passed: owner configured, anonymous private API denial, blocked setup/secrets, private/public/read-only lifecycle, completion, secure cookie flags and fixture cleanup.
- Production desktop/mobile sign-in rendered dark with no horizontal overflow or JavaScript errors. The collaborative browser snapshot timed out twice; the read-only check used the repository’s Playwright package. All 12 served frontend files matched the exact Docker image byte-for-byte.
- After the final image update, an authenticated production sync completed successfully for all five sources: OpenAI, Anthropic, Thinking Machines Lab, Google DeepMind and Hugging Face. The image config digest and application revision matched the local build. Public DNS resolves to the intended ingress and no stale AAAA record exists.
- A backup restored successfully into a separate disposable database: nine tables, three migrations, owner credentials and the complete inbox. That database was removed.

Daily verified custom-format backups are enabled through `margin-backup.timer`, around 03:40 UTC with up to 15 minutes of spread, retaining 14 days. Manual and systemd runs passed. Restore guidance and update/rollback procedures are in the runbook. No automatic code deployment or external anti-DDoS service was installed.

Production credential files remain protected on the VPS. Automatic approval review rejected exporting them to a local archive because SSH transport/compression would still leave an additional unencrypted copy. No workaround was attempted. Same-server backups are not offsite disaster recovery; the protected pre-deployment database copy also remains on the owner’s laptop.
