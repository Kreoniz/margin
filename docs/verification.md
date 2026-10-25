# Corrected product verification

Current UI verification on 2026-10-24 after the keyboard, Tailwind and dark-theme correction. Backend and migration evidence below was collected on 2026-10-23. Historical verification of the earlier progress-tracking implementation is superseded by this record.

## Product scope

The current application has compact Library and Discover lists. Library items have only pending (To read/watch) and done (Done). Progress, pages, units, ratings, favorites, dashboard sections, topic navigation and dominant covers are removed from the runtime model/API/UI. The published unlikely-ui package and its stylesheet remain actual dependencies; components are imported by public subpaths, with no copied package internals or node_modules edits.

First-run owner setup and cookie login protect private reads and mutations. Public endpoints return only explicitly public records and omit notes. Telegram/Hermes capture uses a separately scoped bearer token, generated in Settings and shown once, with idempotent private/pending submissions. No live Marvin gateway or Telegram service was modified.

## Browser and frontend validation

All **34 desktop/mobile browser tests** passed against the final Docker image on the isolated QA service at port 8788 after the complete keyboard-navigation and Tailwind migration. The QA database was separate from the user's existing local database. Tests cover:

- First-run owner setup/login, logout and denial of unauthenticated private reads.
- A genuinely empty personal library, with no generated preview media.
- Title-only capture, pending/done toggles, editing, optional tags/private notes, search, reload persistence and removal.
- Automatic URL metadata, canonical URLs, preserved manual type choices, an immediately disabled save during lookup, and clearing unrelated fetched details when switching to a manual title.
- Public/private changes, owner-only edits, an anonymous browser context, excluded private notes and 404 responses for private share IDs.
- Submission token creation/revocation, minimal receipts, duplicate idempotency, denied private reads/edits and rejected public/status overrides.
- Real collected articles saved/dismissed/read independently of personal-library status.
- Source auto-save configuration persistence, light/dark dialog accessibility, responsive layouts and keyboard navigation.
- TanStack search/add shortcuts, typing safety, dialog scoping, editor save with a single request and the persisted single-key shortcut off switch. Platform-adaptive hints and modifiers are exercised by desktop and iPhone browser profiles.
- Actual row reposition animations after status changes, cancellation when reduced motion is enabled, motion-free rendering and immediate dialog closing under that preference. Dialog close/cancel uses Unlikely UI's transition lifecycle.
- Keyboard-only opening, editing, completion, undo and removal, plus discovery saving/read/unread/dismissal and opening the original article in a separate tab. No pointer actions are used in these workflows.
- Reaching beyond the first 40 rows, filter-driven pagination resets and protection against actions on hidden selections. Independent review caught the hidden-row bug; a regression reproduces it, and the fix was cleared on re-review.
- Dark by default despite the old automatically stored light value, explicit light-choice persistence, inherited dialog themes, Settings corner hit area and bounded gear artwork, compact dialog height, nested F1 guide and focus return.

Axe WCAG2A/AA/2.1AA checks pass on tested screens. Desktop Chromium was 1440×1000; mobile Chromium used the iPhone 13 profile. These are automated checks, not an assertion of a complete accessibility audit or testing on physical devices.

Tests generated explicitly named temporary test records and removed them. Normal empty-library screenshots contain no fabricated personal entries. Discovery screenshots use actual first-party articles. Browser test configuration requires E2E_TEST_INSTANCE=1 to prevent accidental use against a personal instance. Three frontend utility cases and the TypeScript/production build checks pass.

## Backend validation

The Go/PostgreSQL suite, race checks, vet and executable build passed. Tests use explicit TEST_DATABASE_URL and isolated random schemas, never application DATABASE_URL as a fallback. Coverage includes fresh and upgraded databases, precise legacy-sample detection, private defaults, session hashing/expiry/logout, setup concurrency/limiting, CSRF/origin checks, public DTO boundaries, submission scope/rotation/revocation including in-flight requests, future-only auto-save, unknown publication dates, durable seen history, duplicates, metadata/parsers, storage transactions and worker coalescing.

The HTML date regression first reproduced historical undated rows auto-saving, then verified that unknown dates retain discovery display time while remaining out of auto-save. Known future publication dates continue to auto-save privately. Migration safety and quarantined-sample duplicate identity receive separate regression coverage.

## Deployment evidence

The multi-stage image builds a static Go binary and the React app, runs as UID/GID 65532 with a read-only filesystem, and retains PostgreSQL in a named volume. Margin's bridge MTU 1376 matches the verified VPN path; TLS verification remains enabled. Local backups are excluded from Git and the Docker build context.

The existing local instance was upgraded at http://localhost:8787 after two owner-readable-only database backups in `backups/`. All three migrations applied. Verification found zero real library items, 12 quarantined samples, 333 retained real inbox articles and all five subscriptions. No owner password or live integration token was invented; first open requires owner setup. `/api/health` returns 200 with a database check, unauthenticated bootstrap returns 401, and the public list returns an empty array.

One sample used the old normalizer's slash-stripped R2D3 URL. A new migration regression reproduced the mismatch (11 samples instead of 12), then passed with the exact legacy form recognized. Since the first local upgrade had already applied 002, the remaining record was classified only after checking every original field, the seed marker and exact timestamps against the fresh pre-upgrade dump, then guarding every retained current field in a single atomic update. No records were deleted. Migration 003 lets real copies coexist with quarantined samples without changing seen history. The focused migration/sample race suite passed after this correction.

The final container completed a scheduled collection pass for all five publishers between 16:45:24 and 16:45:28 UTC on 2026-10-23, with empty source errors. Auto-save remains off until explicitly enabled. All obsolete tracking columns are absent. The final link-style Unlikely UI buttons explicitly use its non-native-button mode when rendered as anchors.

After final container recreation, health and access checks passed again and counts remained unchanged. Temporary QA containers, Go/Vite development servers and QA credential files were removed. The retained services are the local app on loopback port 8787 and its healthy persistent PostgreSQL container.

The Hotkeys update pins the published `@tanstack/react-hotkeys` 0.16.0 package. Motion uses CSS and native Web Animations, with no animation dependency, extra copies of content or delayed data mutations. The frontend production build is 149.39 KB JavaScript and 12.92 KB CSS gzipped. TanStack license notices are retained in `web/public/licenses/tanstack.txt`.

## Sources and navigation repair

On 2026-10-23, reproduced the reported source-label failure against the prior Docker image: the auto-save text was constrained to the Checkbox component's 24px control width. The repair composes the published checkbox with an external label, uses a responsive options grid and tightens source-row spacing. Regression checks require readable, single-line text and verify that headings, labels and sync status do not overlap.

All four affected desktop/mobile source checks passed against the final image, including light/dark accessibility, auto-save persistence, following the real Go Blog Atom feed, pause/resume, interval persistence after reload, removal and return to the underlying Library. Navbar checks verify a single row under 60px tall, direct Sources access and reflow at 320px width. The broader run also passed the other 24 desktop/mobile cases; its two geometry failures were an overly strict 130px text-width assertion (rendered width 128px), corrected before the final focused run. TypeScript, utility tests and Docker production builds pass.

OpenAI's official black monoblossom SVG and Anthropic's first-party monochrome icon are served locally, with origins recorded in `web/public/brands/README.txt`. Both assets load successfully in the browser checks. The navbar is sticky and provides Library, Discover, Sources, Add and Settings without a second mobile navigation row. Desktop/mobile Sources screenshots were inspected after the repair. The retained local five-source collection reports no publisher errors.

Current schema/API and migration behavior are documented in [api-contract.md](api-contract.md), deployment and integration usage in [README.md](../README.md), and independent product references in [product-correction-research.md](product-correction-research.md).

## Keyboard, dark theme and Tailwind correction

Tailwind CSS 4.3.3 and its Vite plugin now compile utility composition and reusable component hooks through Unlikely UI's published token adapter. The design-system package remains untouched. Settings shows Appearance and a short keyboard section first; sharing, integration and sample maintenance are expandable. The inspected default Settings dialog is approximately 444px tall on desktop rather than the earlier full-height layout.

The new `margin-theme` preference starts dark and preserves a newly selected light theme. The old automatic `margin-appearance=light` value does not override that default. CSS, portalled components and page color-scheme follow the theme. Tailwind, TanStack and Unlikely UI license notices are retained locally.

Arrow/J/K navigation highlights and focuses actual rows, loads more items when needed, and moves focus after mutations. Enter/O opens; S/R/X act on discoveries; D/E act on library media. Home/End, view/filter shortcuts, search, add/save, undo, Sources, Settings and F1 help are available without a touchpad. Native Tab controls and text editing retain their own keys. One dark-mode help-button contrast regression found by axe was corrected before the passing final suite. The final build is 152.09 KB JavaScript and 15.14 KB CSS gzipped. Desktop and mobile screenshots were inspected.
