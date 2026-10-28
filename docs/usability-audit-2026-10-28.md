# Two-round capture and usability audit — 2026-10-28

The user reported a slug-only capture of `https://openai.com/index/scaling-postgresql/` and requested two subagent review/refinement rounds. Each round used two independent read-only agents: one technical capture/data review and one browser usability review. The parent implemented fixes between reviews and after the second round. Browser audit records lived only in disposable instances and were removed.

## Root cause reproduced

The article's HTML returned HTTP 403 to the server while the [official RSS](https://openai.com/news/rss.xml) returned 200. The RSS contains the full title and a 144-character description, but no author or image for this item. At verification it was well beyond the inbox's newest 100 entries. The old capture path returned a URL-derived title, discarded the metadata warning, and gave the extension an unconditional Saved result. Existing captures had no retry action.

The corrected live lookup returns **Scaling PostgreSQL to power 800 million ChatGPT users**, its description, and an explicit missing-image warning. It does not invent an author or cover. The extension can supplement missing fields from the open page's metadata when explicitly invoked.

## Round 1 — findings and refinements

| Finding | Refinement |
| --- | --- |
| Blocked HTML lost metadata despite usable publisher RSS | Canonical URL lookup in a complete body-bounded known-source feed, separate from inbox retention; ten-minute cache |
| Save now aborted enrichment permanently | Durable pending state, worker leases, background completion and temporary UI polling |
| Failed external captures lost warnings and had no recovery | Persistent owner-only warning, visible URL/preview/retry controls, honest extension feedback |
| Only Book JSON-LD was parsed | Article, NewsArticle and BlogPosting extraction added |
| Editing a To review item switched status and cleared filters | Existing edits preserve review/search/filter context; optional Save & review |
| Reviewed looked like a state, with no reversal | Mark reviewed action with Undo; accurate all-reviewed empty state |
| Mobile Edit wrapped beneath a large empty cover | Predictable mobile grid, right-aligned Edit, smaller empty-cover treatment |
| Search omitted saved URLs; author refinement was stale | URL/domain search, singular counts, manual author changes refine book matching |

## Round 2 — independent validation and final refinements

The live browser reviewer measured a quick OpenAI capture returning in about 70 ms before its background feed recovery. Retry, domain search, review context, Save & review, Undo, and mobile action placement worked; the audited mobile row was 125px tall without overflow. The technical reviewer confirmed the durable merge tests passed.

| Remaining finding | Final refinement |
| --- | --- |
| Passive polling could copy old-page details into an edited URL draft | Match draft and stored URL before passive synchronization; preserve pending lookup for unsaved URL changes |
| Extension injection could read a newly navigated page for the previous URL | Bind extraction to the expected URL and discard mismatches |
| Delayed extension errors could mark a different active tab | Keep both success and failure feedback on the original tab and URL |
| Duplicate receipts could disclose an owner-written warning | Only new captures receive a generic capture warning; duplicates omit it |
| JSON-LD image arrays of ImageObject were missed | Normalize array entries before extracting image URLs |
| Duplicate save left an aborted metadata spinner active | Clear loading on abort; keep retry usable after failed saves |
| Row Retry merely opened Edit | Label the action accurately as opening the editor |

The second browser reviewer encountered two preview snapshot timeouts and used isolated Playwright on a separate disposable instance, following the browser fallback rule. All audit contexts/tabs were closed. There was no third review round.

## Validation

Deterministic backend tests cover blocked HTML plus a matching feed entry beyond position 650, feed caching, article JSON-LD images, immediate save, concurrent edits/URL changes, browser hints, duplicate warning privacy, and public-data boundaries. Extension tests cover expected-page binding and feedback after navigation/focus changes. Browser regressions cover retry, review context/Undo, mobile controls, stale background results after URL edits, and duplicate-save recovery, alongside the existing suite.

Final checks: the frontend production build and three utility tests passed; full Go tests passed with race detection on isolated PostgreSQL schemas, and go vet passed. All seven extension tests passed, and Chromium loaded extension 1.0.1 with its options page and both commands. The 58-case browser run passed 57 cases; one existing privacy assertion queried the public endpoint before its save completed. The trace showed the GET starting during the pending PATCH. The test now waits for save completion; all four affected desktop/mobile save/privacy cases passed on rerun. The new recovery, stale-URL, duplicate-save, review, and layout cases passed. Mobile action placement also covers 570px.

The reported slug-only record in the local review database was selectively queued for enrichment only while its title matched the URL fallback and author/image/description were empty. It now has the full title and 144-character description. Its existing To review flag and pending completion state were preserved. The original installation was not changed.

## Follow-up — click targets and populated-list density

The user correctly identified gaps after these reviews: only titles opened items, and library covers still dictated excessive row heights. The earlier reviews established specific flow and alignment behavior, but did not adequately assess the populated list's density or click targets. They should not be read as comprehensive usability approval.

Public cards now use a single native link around the cover, copy, and padding. Linked library items stretch their native link across the row; manual items stretch their editor button. Completion, Edit, review, missing-details, and tag controls remain independent. This preserves native keyboard activation and link behavior without nesting buttons inside links or adding a competing row click handler.

Library covers now occupy a consistent 64px-high area on desktop and 56px on mobile; missing covers use a smaller icon without a colored placeholder block. Desktop public covers are 128px high. All nine demo kinds are checked in a populated list: rows stay within 96px on desktop and 120px on mobile at the tested viewport. A long, two-line mobile capture with both a missing-details action and a review button has a separate 140px bound. Public card text alignment remains checked at 320px, 390px, and desktop width.

New browser regressions click covers, author/description text, and empty padding; activate links using Enter; open manual items; and exercise independent completion, edit, missing-details, review, and tag controls. Populated desktop/mobile library and Collection screenshots are generated for visual inspection. Visibility indicators now sit with creator metadata instead of adding a mobile grid row; mobile tab spacing keeps all status choices visible. This follow-up was implemented directly, without adding a third subagent round.

Follow-up validation: production frontend build, all three utility tests, formatting/diff checks, and 14 focused browser cases passed. The populated-list case was then extended to verify library density and tab visibility at both 320px and 390px, and passed again on desktop and mobile. No backend or extension code changed in this follow-up.

## Follow-up — action tooltips

Repeated row actions, toolbar/navigation shortcuts, source controls, token copying, and editor Save/Close now use the existing UI library's tooltips. A page or dialog shares one Root and floating popup through trigger payloads, following [Base UI's multiple-trigger pattern](https://base-ui.com/react/components/tooltip#multiple-triggers). Triggers render onto the original controls, keeping click targets, accessible names, and form behavior intact. Popups remain unmounted while idle; triggers still have normal React/interaction overhead. Hover state is owned by the tooltip scope rather than the library state. This is a bounded DOM strategy, not a claim of measured performance at arbitrary list sizes.

Hints use a 300ms mouse-hover delay, immediate keyboard-focus opening, hoverable content, and Escape dismissal. Action labels and shortcut badges are supplementary to persistent accessible names. Quick-key badges follow the user's preference, and row actions explicitly describe their focus requirement. Touch activation still performs the action directly. Informational dialogs initially focus their heading so the Close hint does not consume the first Escape press; the editor retains input autofocus. Explicitly focusing Close still offers its Esc hint, which can be dismissed without closing the dialog.

All 18 focused desktop/mobile browser cases passed, including existing source, library, discovery, form submission, and keyboard regressions. New cases verify nine rows have zero floating tooltip DOM while idle and one shared popup while active, correct description reassignment between buttons, pointer movement onto the popup, keyboard focus/Escape, dialog layering, touch activation, and disabled quick-key hints. Frontend build, three utility tests, formatting, and diff checks passed. The tooltip module adds about 7.8kB to the gzipped application JS once; no package dependency was added. The build now reports its advisory 500kB minified-chunk threshold (the JS chunk is about 512kB); this warning was not suppressed.

The next refinement adds 12px horizontal row padding on desktop, 8px on mobile, and explicit horizontal padding in tooltip text. Hints now also explain status filters, tag filtering, review versus completion, metadata recovery, reading/reset actions, pagination, demo loading, and the editor's details shortcut. The expanded controls retain their original native elements. Eighteen focused desktop/mobile cases passed again; checks include real control insets at 320px/390px, the existing compact-height bounds, secondary hint content, review without completion, and native details disclosure. The production build and utility tests also passed.

## Follow-up — Vim navigation and extension 1.1.0

The owner UI now uses `h` / `l` for previous/next status tabs, `Shift+H` / `Shift+L` for Library/Discover, `j` / `k` for rows, and `gg` / `Shift+G` for first/last item, including items beyond the initial page. Existing arrow, Home/End, bracket, and go sequences remain available. These additions follow the existing single-key preference and typing/widget/dialog scopes. Help, tooltips, and the preference description explain the mappings. F1 remains usable from search.

Regression testing caught a sequence collision: after `gg`, the second G could remain a fresh prefix for `g l`, so a following `l` opened Library instead of advancing a status tab. The completed `gg` handler now clears sequence progress using the hotkey manager's public API; the test immediately follows `gg` with status navigation and checks that the page stays put. Navigation is also checked against completion/review changes, typing, native picker typeahead, dialogs, disabled quick keys, and empty discovery tabs.

Extension 1.1.0 includes the selected Margin mark at native PNG icon sizes 16/32/48/128, a bundled Inter font, dark/light presentation, a current-page preview, primary Save for later and secondary Mark done actions, accessible busy/result/error feedback, and direct review links. `s` / `d` capture inside the popup; `h` / `l` or arrow keys focus its actions. The suggested browser shortcut opens the popup with Ctrl+Shift+Y (Command+Shift+Y on macOS). Optional direct Save/Done commands retain their existing IDs and user assignments. Setup and popup display the actual assignments from the browser instead of assuming a default was registered.

Setup accepts a pasted dashboard URL, normalizes its origin, masks the browser token with an optional reveal control, and reports denied site permissions without replacing the saved connection. Switching sites removes the old site permission. Saving reports a stored connection rather than claiming a live token check. Capture reports rejected tokens, unreachable servers, unsupported browser pages, and missing metadata with a recovery action. Busy state prevents duplicate sends and hides stale receipt links. Popup requests are bound to the previewed tab and URL; a changed page must be checked before retrying.

Validation for this follow-up: the production frontend build and three utility tests passed; all 11 extension command/origin/recovery tests passed. All 24 focused desktop/mobile browser cases passed: eight extension UI cases with mocked Chromium APIs, including dark/light WCAG A/AA checks and screenshots, plus 16 owner-UI shortcut, typing, dialog, row action, pagination, and hint regressions. A separate unpacked Chromium smoke loaded the real 1.1.0 manifest/service worker, all four PNG sizes, the bundled font, setup and popup, and registered all three native commands without page errors. The suggested popup shortcut registered as Ctrl+Shift+Y; direct commands remained unassigned. Browser-specific conflicts and the user's actual Helium installation still require checking there. The existing advisory frontend chunk-size warning remains recorded rather than suppressed.
