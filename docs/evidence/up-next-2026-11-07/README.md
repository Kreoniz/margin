# Library priorities — review evidence

Margin opens the compact Library overview in its remembered Mixed, Shelves, or List layout. Up next is an optional filter with the same layouts, discreet ranks, and contextual priority controls. Removing an item from Up next keeps it in Library; completion removes its priority. Direct browser and integration saves no longer create a routine review task. Concrete unresolved identity problems still need attention.

## Before and after

All records and artwork are fictional. Both instances use the real Go application and isolated PostgreSQL databases, without request interception or followed sources. Desktop viewport captures are 1440×1000; mobile captures are 390×844. Mobile overview images show the top of the scrollable page; priority-filter images include the full page.

| View | Before | After |
| --- | --- | --- |
| Desktop overview | [Library](before-desktop.png) | [Library with priority controls](after-desktop.png) |
| Mobile overview | [Library](before-mobile.png) | [Library with priority controls](after-mobile.png) |
| Priority filter | — | [Desktop](after-next-desktop.png), [mobile](after-next-mobile.png) |
| Contextual controls | — | [Desktop](after-actions-desktop.png), [mobile](after-actions-mobile.png) |
| Empty priority filter | — | [Desktop](after-empty-desktop.png), [mobile](after-empty-mobile.png) |

[Watch the approximately 41-second desktop screencast](after-flow.webm). This is one continuous local UI recording played at half speed for readability. It shows Mixed and Shelves, explicit addition, the Up next filter, List's full priority order, moving an item, reload persistence, removal retaining the library item, completion, and returning to unfinished without restoring priority.

The original fixture has seven items. Before shows six unfinished; after shows five because the movie was completed in the earlier behavioral check. The final four-item priority order puts the older game ahead of a recent book. The video remains unfinished and unqueued. Recording temporarily changed the synthetic queue and video status, then restored both. Empty-filter screenshots were captured through real removals followed by restoration of the same queue order.

## Validation

- Backend foundation: full database-backed Go app suite, queue race tests, Go vet, web utility and extension tests passed. Independent review's bootstrap snapshot race was reproduced and fixed with a consistent read transaction; controlled completion/deletion regressions and queue race tests passed afterward.
- Four focused real-server product cases passed for deliberate captures, unresolved ISBNs, and attention/filter/editor hints before the layout revision.
- Initial compact revision: TypeScript check, production build, utility tests, and 80 selected desktop/mobile browser cases passed across the main selection and focused rechecks. These browser cases use synthetic intercepted responses and cover defaults/layout persistence, grouped global ranks, filtered reordering, errors/conflicts, focus, deletion, Done/Undo, Quick Find, and narrow-screen controls.
- Real-server audits covered all three priority layouts at widths 1440, 390, and 320: zero axe violations, horizontal overflow, and page/console errors in all nine checks, including open priority controls. This is automated and targeted keyboard/touch coverage, not a complete assistive-technology audit.
- Final real-server recording confirmed persistence, non-destructive priority removal, transactional completion cleanup, and restored synthetic state, with no page or console errors.
- An independent Terra review of the compact revision found no blocking P1/P2 issues in navigation, filtering/order, actions/focus, async updates, mobile styles, tests, or documentation. It was a static review; the reviewer did not rerun suites or inspect the recording.

## One council round and improvements

The owner requested one round, followed by improvements. Sol and two Terra reviewers independently reviewed frozen revision `e5589e6`; their findings and the coordinator's dispositions are in the [council report](council/README.md). Later fixes were checked by the coordinator, not independently reviewed in another round.

- Reproduced and fixed delayed queue acknowledgements restoring outdated ranks after newer completion/deletion, including failed refresh and Undo paths.
- Corrected the retained keyboard regression's status cycle and obsolete navigation expectation. Both desktop/mobile real-server cases passed.
- Reduced the 390px toolbar by 42px by placing Quick Find beside scoped search. Hid Channels only when there are no options or active selections; verified keyboard and focus recovery when it disappears. Added an outline and chevron to the priority control.
- Passed 64 distinct focused synthetic browser cases across the main run and narrow channel rechecks, plus TypeScript/production build and utility tests. Repeated all nine real-backend layout/viewport checks with zero axe violations, overflow, or page/console errors. Refreshed all after captures and the continuous screencast, restoring synthetic queue and completion state afterward.

## Behavior and scope

Mixed and Shelves preserve priority within their type groups; rank numbers refer to the full queue. List shows the full global order. Moves swap global neighbors. Reordering is disabled under search/type/tag/channel filters and attention or hidden-automatic subsets, with recovery guidance. Undoing Done restores unfinished status without restoring priority, as stated in the UI.

Discover, source settings, public sharing, and integrations remain available. Existing review flags are preserved; only new deliberate saves use the changed default. [Product criteria](../../product-direction.md) describe the purpose and criteria for further simplification.

The feature branch is based on `baseline/pre-up-next-20261107` (`dea2ad2`), a snapshot of application work already present before this task. The baseline keeps this feature's diff separate from earlier unpublished changes. No production deployment was performed.
