# One council round — 2026-11-07

The owner requested exactly one round followed by improvements. One Sol 6.1 and two Terra 6.1 reviewers, all at xhigh, independently reviewed the complete feature against `dea2ad2`, frozen at `e5589e61bdad20d5ad50418c129c285557a33c2e`. Each received the same goal, constraints and evidence and covered the whole scope, with different emphases. They did not share findings before returning. No scores were requested or supplied.

## Findings and disposition

| Member | Findings | Disposition |
| --- | --- | --- |
| [Sol](round-1-sol.md) | P2: the retained keyboard test skips Up next. Optional: shorten the mobile toolbar, hide inapplicable Channels, clarify returning from Discover. | Corrected the status cycle in both directions. Running it also exposed a pre-existing `g ]` navigation expectation; the test now uses the documented `g l`. Placed Quick Find beside scoped search on phones, hid Channels only when both options and selections are empty, and documented the existing Library-return behavior. |
| [Terra correctness](round-1-terra-correctness.md) | P3: a delayed queue response can replace a newer snapshot when its follow-up refresh fails. | Reproduced before the fix: a remaining item incorrectly changed from rank #2 to #3. Queue acknowledgements and conflict snapshots now respect the newest known version and intervening completion/deletion. Earlier bootstrap responses cannot undo acknowledged mutations. Added controlled success/conflict, Done/Undo, and deletion timing cases. |
| [Terra simplicity](round-1-terra-simplicity.md) | No blocking defect. Optional: clearer rank-button affordance and less mobile toolbar space. | Added a subtle outline and chevron to the existing priority control, preserving its target size. Adopted the toolbar adjustment above. |

All three accepted the compact Library, shared layouts, and distinct save/priority/completion actions. There was no conflicting recommendation that required replacing the design. The asynchronous issue was raised by one reviewer and accepted after reproduction. The broader mobile-density suggestions were treated as preferences; this pass removes one toolbar row without changing artwork or adding another setting.

Navigation behavior remains intentional: Library navigation exits Up next to Unfinished; other Library status selections survive a Discover round trip. The brand also returns to Unfinished. Channel selections stay clearable if their options disappear, and closing a now-inapplicable picker restores usable keyboard focus.

## Verification and limits

The coordinator applied and checked these changes after the reviewed revision. This request ended after one round; its reviewers' verdicts apply to `e5589e6`, not the later fixes. The owner subsequently requested [one additional round with Astra](round-2/README.md), which reviewed those fixes at `4a9c7b2`.

The targeted validation and refreshed screenshot/video results are recorded in the [evidence summary](../README.md). The async regression uses controlled browser responses; the real-server recording exercises ordinary priority operations. No new database code or API changes were needed. Full assistive-technology testing, a large personal collection, and a real two-owner-tab network-timing experiment remain outside this pass. No production or personal library data was used, and no publication was attempted.
