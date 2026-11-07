# Sol independent review — additional council round

Reviewed frozen `4a9c7b286d4d3761ad7f75dc7f3ca4601f7444b3` against feature base `dea2ad2423a127ec8f306d1fac3834ae3b5e0b0e`, with particular attention to `e5589e6..4a9c7b2`. No current-round peer reports consulted. No scores requested or supplied.

## Verdict

Accept the product direction and implementation with one non-blocking P3 client-concurrency finding below. I found no P1/P2 defect. The revised interface satisfies the compact-library constraint: Library remains the starting point, artwork and established layouts survive, and prioritizing a few saved items does not require maintaining a separate dashboard. The previously reported delayed queue acknowledgement issue is addressed for its tested direction. The inverse response ordering still has a narrow failure mode.

## Finding

### P3 — A delayed media Done acknowledgement can discard an already loaded, newer explicit priority

**Location:** `web/src/App.tsx:612–619` (`acknowledgeMedia`), called at `:623` and by the editor's `onSaved` at `:1607`. The new centralized completion cleanup applies every arriving Done response to the current queue without checking whether the corresponding media response is older than the media/queue snapshot already displayed. `latestQueueVersion` protects queue acknowledgements and bootstrap, but not this path.

**Reproduction, independently executed with intercepted fictional fixtures:**

1. Load Up next in List with pending Book and Game, queue version 1, `[book, game]`.
2. Mark Book done. The synthetic server commits Done and queue version 2, `[game]`, but hold that PATCH response after commit. Its Book `updated_at` is `10:01`.
3. Simulate another owner tab returning Book to unfinished and explicitly adding it again. Publish pending Book with `updated_at=10:02` and queue version 3, `[book, game]`.
4. Dispatch window focus in the first context, allowing its bootstrap to load that newer consistent snapshot. Confirm Book is present and Game visibly has rank #2.
5. Fail subsequent bootstraps, then release the held `10:01` Done acknowledgement.

**Observed:** Book disappears from Up next and Game becomes #1, despite that context already having received the newer pending/reprioritized state. The refresh error is visible. The durable synthetic server queue remains `[book, game]`; this is a client display regression, not demonstrated database loss. A subsequent successful refresh repairs it. Without refresh failure it is transient.

This is narrower than the original queue-response finding: it needs a delayed media acknowledgement, an intervening owner change, and a failed corrective refresh for persistence. It is nevertheless a distinct feature-level regression because the new cleanup removes membership from a newer acknowledged queue. The older baseline's general media-response reconciliation is not being attributed to this feature.

**Smallest fix:** reject an older media acknowledgement before applying either its media replacement or its queue cleanup, using the current item's `updated_at` or an equivalent reliable media revision check. Keep the queue guards already added. Add one regression with this inverse ordering and failed refresh; the existing delayed queue tests exercise the opposite direction. Do not change Undo into automatic reprioritization.

## Assessment across the agreed scope

- **Choosing, density, discoverability:** The six required after screenshots show recognizable titles, artwork, type, compact ranks, and consistent Library/Discover/Sources navigation. At 390px the first overview card starts around y=431 versus y=473 in the supplied before image; search and Quick Find sharing a row produces the reported 42px saving. The small outlined rank/chevron and +Next controls disclose actions without permanent move/remove strips. The contextual panel is larger while open, appropriately reserving touch-sized actions for the moment they are needed. Empty Up next offers a compact route back to unfinished items. Sparse shelf whitespace is inherited from the existing layout and fictional item distribution, not a new feature defect.
- **Ordering and persistence:** Static review supports append-only explicit addition, non-destructive removal, adjacent global moves, within-shelf order, global ranks, and full mixed order in List. Search/type/tag/channel and attention/hidden-automatic subsets disable ambiguous moves. Explicit Up next intentionally overrides hidden automatic additions. No drag-and-drop, extra ordering model, dependency, or maintenance mechanism is needed.
- **Backend concurrency:** The singleton queue lock serializes version-checked writes. Patch, delete, browser Done and fixture cleanup remove membership transactionally. Repeatable-read bootstrap reads media and queue consistently. Capture's credential/URL gates precede queue/media locking; I found no reverse dependency introduced by this diff. Returning to pending does not insert membership.
- **Auth/privacy:** Queue endpoints remain behind owner-session middleware and same-origin mutation checks. Queue data is separate from Media, public DTOs, MCP read/save structures, exports and capture/submission receipts. I found no priority disclosure or new credential authority in the reviewed paths. These conclusions are static review, not a newly executed backend security suite.
- **Low-maintenance saving:** Removing blanket review flags is confined to new deliberate browser/integration/MCP saves. Existing duplicate flags remain intact; the unresolved title-only ISBN branch still sets attention. Automatic-source behavior is retained. Discover, sources, sharing and integrations are preserved rather than removed to simplify the UI.
- **Keyboard/focus:** The revised retained keyboard test includes Up next in both status-cycle directions and the documented `g l`. The popover suspends quick keys, supports native activation/Escape, and restores row/trigger focus. Channel hiding checks options and active selections; its disappearance recovery and absent-trigger shortcut guard passed targeted tests. Library-return and brand behavior match the explicitly documented exception. Editor Done now shares the cleanup function; its centralization was inspected statically, not separately driven through the editor during this pass.

## Independent coverage and limits

- Read product direction, CONTEXT, README/current API contract, the feature evidence README, final audit/recording JSON, and the three final browser logs. Reviewed the whole feature production diff and associated test/document changes, emphasizing the latest fix diff. Earlier unpublished baseline code was context only.
- Inspected all six required after PNGs using `view_image`, both after-empty PNGs, and both before overview PNGs. Inspected the 41.4-second video through a contact sheet sampled across its timeline at approximately four-second intervals; this is sampled visual inspection, not continuous playback or independent replay of its backend mutations.
- Independently ran **16 existing synthetic browser cases; all passed**: desktop and mobile versions of disappearing channel focus, native priority keyboard/focus/removal, 320px actions in all layouts, attention/hidden-automatic move restrictions, delayed success/conflict queue responses after newer completion, and delayed queue responses after local Done/Undo or deletion with failed refresh.
- Independently executed **one additional desktop intercepted-fixture scenario**, reproducing the finding above. It used the existing fixture helper and supplied production bundle, with a held synthetic PATCH acknowledgement and no shared-server data changes.
- Shared preview snapshots twice failed with `Preview automation snapshot timed out after 15000ms`; used the authorized local Playwright fallback in independent contexts. The opened shared preview tab was closed. Initial sandboxed Chromium launch failed; the narrowly scoped runs succeeded with sandbox escalation.
- Did not rerun the full Go/database/race/security suite, production build, extension suite, full browser suite, or real-server Vim tests; their supplied results remain reported evidence. Did not independently repeat the nine real-server axe audits or a screen-reader audit. No shared library/queue mutations were performed. Source, index, HEAD and branches remain unchanged.

## Preferences and coverage suggestions

No additional UX redesign is necessary for acceptance. The repeated textual membership and clickable rank are a reasonable discoverability tradeoff at the current density; changing them is optional, not a defect. Keep any next change limited to the reproduced response-ordering regression and its narrow test. A broader assistive-technology or large-library audit can remain separate coverage work.
