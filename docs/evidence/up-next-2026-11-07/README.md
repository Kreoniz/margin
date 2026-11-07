# Up next — review evidence

Margin now opens the owner's private Up next shortlist. Explicitly add unfinished library items and put them in a mixed manual order. Removing an item keeps it in Library; completion removes it from the shortlist. Deliberate browser and integration saves no longer create a routine review task. Concrete unresolved identity problems still appear under Needs attention.

## Before and after

All records and artwork in these captures are fictional. Both instances use the real Go application and isolated PostgreSQL databases, with no request interception and no followed sources. Desktop is 1440×1000; mobile is 390×844. Mobile images show the top of the scrollable page.

| View | Before | After |
| --- | --- | --- |
| Desktop | [Library](before-desktop.png) | [Ordered shortlist](after-desktop.png) |
| Mobile | [Library](before-mobile.png) | [Ordered shortlist](after-mobile.png) |
| Empty shortlist | — | [Desktop](after-empty-desktop.png), [mobile](after-empty-mobile.png) |

[Watch the 30-second desktop screencast](after-flow.webm). It is edited from separate real UI recordings, not one uninterrupted session. It shows explicit additions, completion, ordering, removal, and Library views. The final screenshots also include the subsequent mobile artwork alignment fix; the accessibility-name correction does not change visible labels.

The final four-item shortlist places the 45-day-old game ahead of a one-day-old book. Reload preserves that order. The removed video remains in Library, and the completed movie appears under Done.

## Validation

- Full database-backed Go app suite, queue race tests, Go vet, production TypeScript/Vite build, web utility and extension tests passed during implementation.
- Seventy-four selected mocked desktop/mobile browser cases passed across the implementation run and focused rechecks; these are separate from the real-server evidence above.
- Independent review found a bootstrap snapshot race and an obsolete capture-policy test. Controlled concurrent completion/deletion tests reproduced the race, then passed after bootstrap began reading queue and media in one repeatable-read snapshot. Queue race tests passed after the fix.
- Two corrected real-server product scenarios passed on desktop and mobile (four cases): deliberate captures versus unresolved ISBNs, and attention/filter/editor hints.
- All 40 final focused queue/filter/Quick Find browser checks passed, covering accessible filter names and artwork remaining beside the title on mobile.
- Final real-server axe checks at 1440, 390 and 320 px report no violations, page errors, or horizontal overflow. This is automated coverage of the tested screen, not a complete accessibility audit.

## Deliberate limits

Reordering is disabled while search or filters are active, with a clear-filters action. Undoing Done restores unfinished status without restoring shortlist membership, and the UI explicitly says so. Existing library layouts, Discover, source settings, public sharing, and integrations remain available. Existing review flags are preserved; only new deliberate saves use the changed default.

The feature PR is based on `baseline/pre-up-next-20261107` (`dea2ad2`), a snapshot of application work already present before this task. The baseline is separate so the feature diff does not mix in earlier unpublished changes. Production was not deployed.
