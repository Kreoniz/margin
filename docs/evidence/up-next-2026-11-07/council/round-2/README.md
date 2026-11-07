# Additional council round with Astra — 2026-11-07

After the first round and its fixes, the owner explicitly requested one more round and added Astra. Four fresh reviewers independently reviewed the full feature against `dea2ad2`, frozen at `4a9c7b286d4d3761ad7f75dc7f3ca4601f7444b3`: Sol 6.1, two Terra 6.1 reviewers, and Astra, all at xhigh. They received the same scope, constraints, prior findings and evidence. They did not read current-round peers' conclusions. No scores were requested or supplied.

## Findings and reconciliation

| Member | Verdict and evidence |
| --- | --- |
| [Terra correctness](terra-correctness.md) | Identified a P2 reverse response-ordering issue by code analysis: an old Done response can replace a newer pending/reprioritized snapshot. No independent execution. |
| [Terra simplicity](terra-simplicity.md) | No actionable P1–P3 finding. Supported the design and the prior queue-response guard. Static and visual review. |
| [Sol](sol.md) | Independently reproduced the same reverse race and rated it P3 because durable state remains intact and failed refresh is required for persistent display error. Also passed 16 targeted browser cases. |
| [Astra](astra.md) | Independently reproduced the same P3. Two other response-order probes passed. No design replacement or additional UX change requested. |

The reports agree on the product direction. The apparent difference in concurrency findings comes from coverage and severity assessment: three members found the same issue, two executed it, and one did not identify it. The coordinator accepted and fixed it regardless of the P2/P3 distinction. No optional design preference was turned into new scope.

## Improvement

Media acknowledgements now check the update timestamp of the state already accepted by the client before replacing media, removing priority, or invalidating reads. Rejected old replies also do not produce a misleading Done/review Undo toast. The check uses the existing server timestamps and retains PostgreSQL's sub-millisecond precision instead of truncating it through JavaScript Date parsing. The guard is shared by row mutations and editor-save acknowledgements; existing queue-version and cleanup-generation guards remain.

The coordinator added a browser regression that holds Done, loads a newer explicit return-and-re-add, then fails refresh and releases the old response. It failed on the reviewed build because the item disappeared from Up next. The regression also covers two updates one microsecond apart. Utility checks cover precision, equivalent timestamp representations, UTC offsets and invalid values. The layout and API contract are unchanged.

## Validation and limits

See the [evidence summary](../../README.md) for the final coordinator test results. Reviewers' independent executions are described in their individual reports. There was no additional review round or rescore after this fix; their verdicts apply to `4a9c7b2`.

This is a guard against older observed media timestamps, not a new globally monotonic revision contract for every media writer. Transaction-start timestamps do not strictly order every possible concurrent database commit; a general media revision protocol remains outside this narrow fix. Controlled browser responses reproduce the confirmed scenario, including microsecond precision and failed refresh. The backend, API and visual design did not change, so the existing real-server screenshots, screencast and database checks were retained rather than repeated. Full assistive-technology and production multi-client network testing remain outside the pass. No personal data, deployment or publication was involved.
