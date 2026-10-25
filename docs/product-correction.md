# Product correction audit

Reviewed 2026-10-23 before implementation changes against the corrected reading/watch-list requirements.

Reusable: PostgreSQL migrations, canonical duplicates, safe remote fetching, RSS/Atom parsing, Anthropic adapter, durable worker leases, source configuration and actual published Unlikely UI imports.

Replace: active/later/completed plus progress/units, favorites/ratings, dashboard sections, sidebar/topic navigation and dominant cover grids. Optional Basic Auth lacks private-owner/public-reader separation. Missing: submission-only integration API, future-source auto-save, first-run owner setup, explicit legacy sample handling.

Corrected scope: compact list, pending/done toggle, title/link/type, optional tags/private note, quick owner edit. Library and Discover are the only main navigation. Discovery rows open/read, save and dismiss; Sources is secondary. Per-item sharing is explicit, private by default. Settings contains owner/session controls, sharing entry point, revocable submission token and clearly labeled legacy sample cleanup. Fresh normal operation inserts no personal media.

See api-contract.md for shared implementation contract and product-correction-research.md for independent primary-source references.
