# Capture and collection changes (issue #1)

## Interaction decisions

- `/` is the public **Collection**, including for signed-in owners. `/dashboard` is the private owner entry. Existing `/shared` and `/shared/{id}` links continue to work. The public header has no sign-in link.
- Public cards give mixed media a larger image area and type label. Library and Discover previews are larger too. All use `object-fit: contain` to preserve full covers and video stills.
- The editor saves immediately while a lookup is pending or unavailable. Explicitly supplied complete details avoid a second server fetch. Late responses fill only fields the owner has not edited. Details are collapsed initially. Ctrl/Cmd+Enter saves, Ctrl/Cmd+Shift+D toggles details, and Ctrl/Cmd+Shift+L toggles visibility inside the editor.
- Books accept title/author searches, valid ISBN-10/13 values, and URLs. Choosing Book enables automatic title lookup; ISBN input selects Book automatically. Publisher `schema.org/Book` data takes precedence; incomplete book links can use an Open Library match. The most relevant returned edition is selected without a blocking dialog. **Correct book match** exposes an optional search and native radio group, whose arrow keys select another result. Provider outages leave editable data and never prevent saving.
- New integration and automatic-source captures get `needs_review=true`. Manually created and explicitly saved Discover items are already deliberate choices. **To review** includes pending and done captures; **Reviewed** clears only that flag. No viewport, scroll, open, or completion event clears it. Existing records migrate as already reviewed. The flag is owner-only.
- The extension has independently customizable Save and Done commands with no defaults. A separate browser token grants completion authority; the established submission token retains its narrower scope. Both endpoints return minimal receipts, without library metadata. URL identity uses the existing canonical duplicate key. Existing visibility, notes, and edited metadata survive repeated capture.
- Custom image URLs and uploads live in editor details. The browser resizes to a maximum 1600px edge and encodes JPEG before upload. The server accepts at most 2 MiB of JPEG/PNG, validates dimensions, and re-encodes as JPEG. Images live in PostgreSQL and inherit access from attached media: owner-only until a public item references them; switching back to private removes anonymous access. Unattached uploads older than a day are cleaned on subsequent uploads.
- Settings exports a versioned `library.json` and attached uploads in a ZIP. Image references become relative archive paths. Private notes are included; external images remain URLs. This is a portable data export, not a database dump or an import system. Owner credentials, sessions, and tokens are excluded.
- Alt shortcuts are removed. G then L/D/S opens Library/Discover/Sources when quick keys are enabled. Dialog entrance and exit durations match, including save/remove exits. Reduced motion remains respected.

## Sources and tradeoffs

[Open Library Search](https://openlibrary.org/dev/docs/api/search) distinguishes works from editions and returns the most relevant matching edition first. One provider keeps the implementation and failure handling small; coverage will vary by language and publisher. Matches remain correctable. Search misses are serialized to one request per second, with a bounded 15-minute cache, following the [API usage guidance](https://openlibrary.org/developers/api).

Publisher book extraction follows [Schema.org Book](https://schema.org/Book). JSON-LD is parsed as inert data, without fetching contexts. Existing safe-fetch DNS, redirect, body, and timeout restrictions still apply.

Native radio controls provide the standard arrow-key behavior described in the [WAI-ARIA radio pattern](https://www.w3.org/WAI/ARIA/apg/patterns/radio/); no custom combobox or additional UI dependency is required for the optional correction list. [Chromium commands](https://developer.chrome.com/docs/extensions/reference/api/commands) allow commands without default shortcuts, and [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) limits page access to a user-invoked capture. Optional host permissions are requested only for the configured Margin site.

## Local review

The review instance runs on `http://localhost:5178`, with private access at `/dashboard`, against a snapshot of the existing laptop library. Changes there are isolated from the original `http://localhost:8787` installation. Its owner password is inherited from that snapshot. Test fixtures use another database and app instance.

## Validation

- Frontend production build and three utility tests passed.
- Full Go tests passed with `-race -count=1` against disposable PostgreSQL schemas; `go vet ./...` passed. New coverage checks edition selection and publisher precedence, token scope and revocation, canonical capture identity, review privacy, upload validation/access, and ZIP contents.
- All 46 desktop and mobile Playwright checks passed, covering owner/public routes, keyboard flows, source collection, automatic book selection and radio-key correction, immediate save, explicit review, pre-upload resizing, image privacy, late metadata edits, and reduced motion.
- Four extension command/permission tests passed. The unpacked Manifest V3 worker, options page, and both commands loaded in an isolated Chromium profile. Actual Helium installation and the user’s chosen shortcuts remain a manual check.
