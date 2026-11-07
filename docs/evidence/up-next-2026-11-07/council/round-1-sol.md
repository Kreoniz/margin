# Independent Sol review — round 1

Reviewed `dea2ad2423a127ec8f306d1fac3834ae3b5e0b0e..e5589e61bdad20d5ad50418c129c285557a33c2e` on `feat/up-next`, including backend, frontend, tests, documentation and supplied visual evidence. This is the whole feature diff against the specified local baseline, not a review of the earlier unpublished application work.

## Verdict

Accept the compact Library direction and core implementation, with one concrete validation repair requested. I found no blocking runtime, data-integrity or privacy defect. The retained product keyboard test has an outdated status sequence and will fail against the new behavior. The most useful optional improvement is less mobile toolbar height; a replacement queue screen or new organizing model would work against the stated goal.

## Required finding

### P2 — Update the retained keyboard regression test for the new status cycle

**Evidence:** `web/tests/e2e/product.spec.ts:748–752` presses `]` from Done and expects Needs attention. The implementation at `web/src/App.tsx:583–590` correctly cycles `pending → done → next → review → all`. The same test also skips Up next going backward at lines 763–766 and forward again at 767–771.

**Reproduction:** Open Library with Vim keys enabled, focus `main`, and press `]` twice. Done is selected after the first press; Up next is selected after the second. I independently reproduced this read-only on the real disposable preview at 390×844. The observed sequence was `Unfinished, Done, Up next, Needs attention`, then `[ → Up next`, `[ → Done`. The test's assertion at line 749 therefore cannot pass under the implemented sequence. I did not run the product spec itself because it creates/deletes records and this review forbids preview-data writes.

**Minimal fix:** Include Up next assertions and the additional keypress in both directions in this existing test, then run that one product case against a disposable test instance. Preserve the later Discover/context/navigation assertions. Expected improvement: the retained regression suite validates the current keyboard model instead of reporting a deterministic false regression. This is a test defect, not evidence that the application should skip Up next.

## Optional UX improvements, not defects

1. **Recover a mobile toolbar row before changing card density.** In `after-mobile.png` (390×844), the first card begins around y=473 and its title around y=687. Heading, full-width layout selector, scoped search, a separate Quick Find row, three filter buttons, status tabs and section jumps precede it. `after-next-mobile.png` adds the two-line priority explanation, placing its first book card around y=521. These are usable screens, but much of the first viewport presents controls instead of choices. The smallest experiment is fitting the existing Quick Find trigger beside scoped search on phones, with a clear accessible name and 44px target, so it does not consume a separate row (`web/src/App.tsx:1121–1155`, `web/src/styles.css:948–964`). Retain the different scoped/global search behavior. This would expose choices earlier without shrinking artwork, removing search, adding settings, or introducing a new component system. This chrome largely predates the feature; it is a prioritization suggestion, not a regression claim.

2. **Hide an inapplicable Channels control when there are no channel options or active channel selections.** `web/src/App.tsx:1161` always renders it, and `web/src/FilterPicker.tsx:60` explicitly handles its empty state. The supplied fictional library shows Channels despite having no named YouTube channels. Conditional visibility would remove an irrelevant control from that overview. Keep it available when options or an active selection exist, and account for the `f c` shortcut if adopting this. This is optional simplification, not an access or correctness defect.

3. **Clarify the intended return destination from Discover.** I reproduced Up next → Discover → Library returning to Unfinished. `navigate("library")` and the hash handler explicitly clear `next` (`web/src/App.tsx:254`, `546`), while other status filters can survive a round trip. This can reasonably mean “Library navigation exits the priority filter,” so I am not treating it as a bug. It is an exception to the broad README statement that Library/Discover retain their filters. Either document that exception or preserve Up next when returning from Discover if literal filter persistence is preferred. Keep the brand's explicit Unfinished destination and initial Library default.

## Accepted tradeoffs and full-scope assessment

- Shared Mixed/Shelves/List layouts satisfy the revised direction. Artwork remains recognizable, priority adds little permanent row width, and the popover makes move/remove operations explicit. The rank is repeated in metadata and the control, but this supplies both visible membership and an action target; I would not remove one without checking discoverability.
- Grouped layouts can show #2/#4 above #1. That follows the agreed grouping and global-rank contract; List supplies total order. I do not recommend another queue page, dynamic shelf ordering, drag-and-drop, favorites, or a separate priority setting.
- Saving, priority and completion remain separate. Add is explicit and appends; queue removal retains media. Done/delete cleanup runs inside the media transaction. Undo sends an expected completion status and explicitly explains that priority is not restored.
- The singleton lock/version and separate queue DTO are justified mechanisms, not needless complexity. Static inspection found consistent queue-before-media locking for changed completion/deletion writers, version conflict responses without stale overwrite, and a repeatable-read bootstrap for queue/media consistency. Public/MCP/export/capture DTOs do not acquire priority fields; owner middleware protects the new routes.
- Removing blanket review flags from new deliberate browser/submission saves is appropriately small. Unresolved title-only ISBNs still set attention in `prepareMedia`; duplicates and existing flags are preserved. Automatic source review remains intact. Discover, sources, sharing and integrations remain present. No dependency was added, and no unrelated stack replacement is needed.

## Independent evidence and limits

Read the required product/domain/README/API material, compact implementation record and evidence README; inspected the feature source/test/documentation diff and relevant surrounding code. Viewed all six named final PNGs with `view_image`. Inspected sampled frames from the supplied 34.68-second recording via an in-memory contact sheet; this was sampled static evidence, not a frame-by-frame motion or persistence audit.

Shared T3 snapshot automation twice timed out after 15000ms; a click also timed out. Closed my preview tab. Local Playwright initially could not launch inside the sandbox (`Operation not permitted`); an approved isolated fallback succeeded. It used a separate browser context with synthetic preview authentication, blocked browser API mutations, and only navigated, opened a priority popover, and read state. Queue GET snapshots matched before/after the inspected queue/navigation flow. No records or priorities were changed, and no screenshots, traces, or other report artifacts were saved.

I did not independently rerun the reported DB/race/vet/build/browser suites, execute new queue mutations, test with assistive technology, or inspect production/personal data. Backend concurrency/privacy conclusions are code-review conclusions supported by existing test coverage, not new execution proof. The broken product test is outside the reported latest selected cases, so it does not invalidate their reported passes. No prior council conclusion file was consulted; no findings were shared with peers. Only this report was written.
