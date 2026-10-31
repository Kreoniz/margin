# Unlikely UI alpha.3 compatibility — 2026-10-31

Margin now pins `unlikely-ui` **0.1.0-alpha.3**, upgraded from **0.1.0-alpha.2**. The manifest and pnpm lockfile change together. This is a separate local change after the checked production rollout; it has not been deployed or published. Runtime pins and the current branch remain unchanged.

## App adaptations

- The shared `Modal` explicitly passes `showCloseButton={false}` to `Dialog.Content`. Margin retains its own labelled close control, busy dismissal guard, synchronous closing/inert lock and focus return. Compound imports remain intact. Deliberate cancellation of an edited draft still discards it; in-flight saves keep the dialog mounted and preserve failed drafts.
- The alpha.3 Tailwind adapter changes the generic `sm`–`xl` radius aliases. Actual-app comparison detected the narrow dialog changing from 8px to 12px. Margin explicitly retains its established 4/6/8/12px Tailwind scale after importing the adapter. Library-specific semantic radius tokens remain available.
- The static Unlikely UI license file includes alpha.3's bundled shadcn MIT notice.
- Pnpm generated `web/pnpm-workspace.yaml` with a release-age exclusion for **only** the explicitly requested `unlikely-ui@0.1.0-alpha.3` prerelease. No unrelated agent skills were approved.
- Margin does not use Combobox, so no bare/composed input or removable-chip migration is needed. No gallery experiments or broad import rewrite were introduced.

## Verification

- `mise exec -- pnpm check`, `pnpm build` and `pnpm test` passed from `web/` using its pinned tools. The existing advisory bundle-size warning remains.
- **116 existing desktop/mobile Chromium cases** passed after the dependency upgrade and close-button opt-out: editor refinement, modal exit, transition recovery, filters and interaction polish.
- After the radius compatibility fix, **32 focused existing cases** passed on the final assets, covering save/failure recovery, modal exit locks, real Tab traversal, nested help, menu/tooltip motion, and narrow/light/dark layouts.
- **Eight actual-app comparison probes** exercised alpha.2's deployed static artifacts and alpha.3 at 320px/1440px in dark/light themes. Each checked a single custom close control, no library corner close, save/cancel, dirty Escape/backdrop dismissal, busy Escape/backdrop rejection, failed-draft preservation, focus return, nested Select Escape and Tooltip portal themes. Measured surface/input styles, padding, radii, font sizes and ten native Tab destinations matched after the compatibility fix.
- Representative screenshots were inspected. Measurements, screenshots and logs are retained in ignored `.local/unlikely-ui-alpha3/`.

No remaining regression was established in these exercised paths. This is synthetic Chromium app verification, not a claim of cross-browser/assistive-technology certification or a production save test. Existing unrelated working-tree refinements were preserved rather than included in this dependency commit.

Version-matched references: [release](https://github.com/Kreoniz/unlikely-ui/releases/tag/v0.1.0-alpha.3) and [migration guide](https://github.com/Kreoniz/unlikely-ui/blob/v0.1.0-alpha.3/USAGE.md#upgrades-and-validation). The tagged guide and installed npm code/types were inspected locally when GitHub fetches were unavailable.
