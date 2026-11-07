# Capture into Margin

You can save from the browser extension or ask Marvin in Telegram. They connect to the same Margin library with **different tokens**.

**Marvin is already configured as of 2026-10-31** in its default and groq-lite profiles. Both connections were reverified against the [current production release](deployment-2026-10-31-library.md). In Telegram, send `/reload-skills` once in the profile you use, then `/margin_save URL`. No new bot or token is needed. The steps below explain setup on a new installation. See the [installation record](deployment-marvin-capture-2026-10-31.md).

| Where you save | Token in Margin Settings | What it can do |
| --- | --- | --- |
| Helium / Chromium extension | Helium / browser capture → Create browser token | Save a page or mark its URL Done |
| Marvin / Hermes / Telegram | Telegram & Hermes → Create submission token | Add private items for later |

Both create private saved items. Deliberate saves do not automatically require review; unresolved identity/details remain editable. Neither token grants access to browse your library, notes, sources or sharing settings. Review and completion are separate actions.

## Browser: four steps

1. Open `chrome://extensions` in Helium/Chromium, turn on **Developer mode**, click **Load unpacked**, and choose `/home/kreoniz/code/margin/extension`. It contains `manifest.json`; there is no build step. If already installed, click its **Reload** button after updating the project files.
2. In the Margin instance you want to save into, open **Settings → Helium / browser capture → Create browser token**, and copy the once-shown token.
3. Open the extension's **Settings**. Enter that Margin site's address and the browser token, click **Save connection**, and allow access to that site. Current laptop preview: `http://localhost:18790`; deployed site: `https://margin.kreoniz.ru`. Tokens belong to the instance that created them.
4. Visit a page and open the Margin icon, or press **Ctrl+Shift+Y**. Press **s** to save or **d** to mark Done. If the browser shortcut is occupied, change it at `chrome://extensions/shortcuts`.

A saved receipt confirms capture; details may still be loading. Open Margin to retry incomplete metadata. New items appear in Library; choose explicitly which unfinished items to add to Up next. Done removes queue membership and preserves any existing review flag. A full dashboard URL is accepted by extension setup and reduced to the site address.

## Marvin in Telegram: connect once

Marvin already is your Hermes agent. This project does not need a second Telegram bot. The supplied [`margin-save` skill](../integrations/hermes/margin-save/SKILL.md) gives Hermes a repeatable add-only capture command using Python 3, with no extra packages.

1. **Choose a reachable Margin instance.** For Marvin on `vdsina-ru`, use `https://margin.kreoniz.ru`. `localhost:18790` on the VPS means the VPS itself, not your laptop. The [current Library release](deployment-2026-10-31-library.md) is deployed there. On other installations, deploy the intended version before connecting.
2. **Install the skill on Marvin's host**, under the same OS account and Hermes profile used by its Telegram gateway. Copy the complete `integrations/hermes/margin-save` directory into that profile's `skills` directory. The default is `~/.hermes/skills/margin-save/`; named profiles can use a different `HERMES_HOME`. This folder belongs on the VPS, not only your laptop.
3. **Configure credentials in that profile's local Hermes CLI.** In Margin, choose **Settings → Telegram & Hermes → Create submission token**. Run Hermes on Marvin's host in the correct profile and load `/margin-save`. Hermes can prompt locally for the declared `MARGIN_URL` and `MARGIN_SUBMISSION_TOKEN`. Enter the HTTPS site address without `/dashboard` and paste the token into its secure prompt. Do not send it through Telegram. On installations without secure skill setup, use that profile's local environment/secret configuration. Marvin's existing profile settings and installed SDK readiness have been verified; do not replace its working token just to repeat these steps.
4. **Refresh the skill catalogue** by sending `/reload-skills` in the Telegram profile you use. The currently installed Hermes reads profile credentials on each turn, so this installation required no gateway restart. On an older Hermes version, follow its existing service/runbook if a restart is needed. Then send:

   ```text
   /margin_save https://www.youtube.com/watch?v=NBCM_ZoWZo8
   ```

   Or ask: “Save Designing Data-Intensive Applications by Martin Kleppmann in Margin as a book, tagged systems.”

The helper reports a receipt only after the server responds: **Saved privately** for a new item, **Already in Margin** for a duplicate. Errors stop without automatic retries. Check Library in Margin after your first deliberate save. A title-only book submission does not run the editor's interactive edition picker; its title is saved for later refinement.

The installed SDK accepts both `/margin_save` and `/margin-save`; the underscore form fits Telegram's command syntax. `/reload-skills` refreshes the skill catalogue without reloading native plugins.

Hermes documents its [skill directories and messaging slash commands](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills), and [local secure setup and environment passthrough](https://hermes-agent.nousresearch.com/docs/developer-guide/creating-skills). These describe current upstream Hermes; they do not establish what is installed or loaded on Marvin.

For a local configuration-only check, run the helper where those environment variables are already configured:

```sh
python3 /path/to/margin-save/scripts/save.py --check-config
```

This checks presence and address format without a request. It does not verify connectivity or token validity. The deployed Margin API accepts `POST /api/integrations/items`, not the browser capture endpoint. It rejects status/visibility overrides; the helper never sends them.

## What changed during this work

**Browser capture code changed:** the current 1.1.0 source has separate browser credentials, Save/Done actions, shortcut configuration, private review receipts, background enrichment status, placeholder-title recovery for YouTube, and checks binding capture to the previewed page. Reliability fixes prevent stale-page metadata being silently submitted after a detected navigation. Reload an unpacked extension to pick up source changes; it was not automatically installed or refreshed in your browser.

**Margin's submission API supports bots:** private pending captures, explicit title/author/type/tags/notes, duplicate receipts, and an independently revocable add-only token. This work adds the portable Hermes skill/helper and these instructions. On 2026-10-31 the owner requested installation: both Marvin profiles have the skill and its two connection settings. Installed SDK readiness and both profiles' real submission credentials were reverified after the [current application rollout](deployment-2026-10-31-library.md), without creating an item. The gateway was not restarted, and no Telegram/model save round trip was test-sent. Existing credentials were preserved.

YouTube metadata handles multiple link formats, but generic URL identity still allows share/watch/query aliases to remain separate records. Existing records are not merged. Metadata providers can fail or block server requests; capture and metadata completion are distinct.

## Library shortcuts and filters

| Keys, in sequence | Action |
| --- | --- |
| `v l` | List view |
| `v b` | Side by side view |
| `v s` | Shelves view (`v g` also works) |
| `f t` | Types picker |
| `f g` | Tags picker |
| `f c` | Channels picker |
| `/` or `Ctrl/⌘ K` | Search |
| `F1` | All shortcuts |
| `Home`, `Ctrl Home` or `g g` | Page top (`g g` uses Vim quick keys) |

Vim quick keys must be enabled in Settings. They leave text inputs and open dialogs/pickers alone.

Pick several checkboxes without reopening a menu. Selections apply immediately; **Done** or Escape closes the picker. Options have their own search, and each group can be cleared. **Any selected value matches within a group**; groups combine with search and status. Example: Book **or** Video, carrying Design **or** Code. Selecting a channel additionally limits results to its YouTube videos. Click a saved YouTube channel name to toggle that filter. Channel filtering uses the saved display name, not a verified YouTube channel ID, so identical names are grouped.

Filters stay selected when switching Side by side, Shelves and List. Remove individual chips or use **Clear selections**. Navigating between Library and Discover starts a fresh search/filter scope.

Book search uses Open Library. Empty results can be retried immediately, subject to its request rate limit; valid bare and path-shaped catalogue IDs are accepted. A provider error is shown as unavailable, rather than a confident “No match.” Your exact title returned catalogue matches during the 2026-10-31 check; the screenshot's original failure was not independently reproduced. Use **Retry book lookup** or correct the query/author, then choose an edition. You can always save the title manually.

## Local verification

No personal tokens or live submissions are needed:

```sh
python3 -m unittest discover -s integrations/hermes/tests -v
mise exec -- node --test extension/*.test.mjs
```

The helper tests use a synthetic token and temporary loopback server. They cover payloads, duplicate receipts, redirects, authentication errors, missing setup and the configuration-only check.
