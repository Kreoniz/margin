# Margin capture for Helium / Chromium

Version 1.2.0 uses the selected Margin icon and a compact, keyboard-friendly popup. Load this folder with **Extensions → Developer mode → Load unpacked**; no build step is needed. Load it once: the browser remembers this folder across restarts. Changes to popup/options pages appear when reopened; changes to the manifest or background worker require **Reload** on the extension card. Reload after project updates to pick up the whole package consistently. See [Chrome’s reload rules](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#when-to-reload-the-extension).

## Connect once

1. Load `/home/kreoniz/code/margin/extension` (the folder containing `manifest.json`), or extract the supplied ZIP and select that folder.
2. Open [Margin](https://margin.kreoniz.ru/dashboard) → **Settings → Helium / browser capture → Create browser token**. Use `https://margin.kreoniz.ru` as the extension's Margin address for production. The local review remains available at `http://localhost:18790/dashboard`.
3. Open the extension’s **Settings**, paste your Margin address and browser token, then choose **Save connection**. Pasting a full dashboard URL works: setup keeps its site address. HTTPS is required except for HTTP on localhost or 127.0.0.1.
4. Allow access to that Margin site when the browser asks. The connection is stored locally; saving it does not verify the token against the server. A rejected token or unavailable server produces a clear error when capturing, with a **Check connection** action.

For a deployed Margin instance, use its HTTPS address and create its browser token there. The extension is loaded locally, not published to an extension store or automatically installed in your browser.

## Capture and shortcuts

Open a web page, then click the Margin toolbar icon or use **Ctrl+Shift+Y** (**⌘Shift+Y** on macOS) to open capture. This is a suggested browser shortcut; another extension, browser, or OS can reserve it. The popup and Settings display the actual assigned shortcut.

The popup previews the page title and site before you capture:

- **S**: Save for later.
- **D**: Mark done.
- **H / L** or **← / →**: focus the capture actions; **Enter** activates the focused action.
- **Tab / Shift+Tab**: move through all controls; **Escape** closes the browser popup.

Letter shortcuts work only inside the popup. The **Shortcuts** button opens `chrome://extensions/shortcuts` (or the browser’s equivalent). Optional **Save current page** and **Mark current page Done** commands capture directly without opening the popup. They have no suggested bindings, and their existing command IDs are preserved when updating. Choose separate shortcuts there if desired.

To save an excerpt, select text on the page, open capture, and turn on **Include selected text** before Save or Done. It is off by default; direct browser shortcuts never capture selected text. Excerpts are private, labeled separately from publisher text, and retain their source URL including its fragment. The maximum is 10,000 UTF-8 bytes; an empty, inaccessible or oversized selection stops the request instead of silently saving without it.

An existing URL is never merged with a second selection: the receipt explains that the selection was not added and offers Open saved item. Existing notes and excerpts remain unchanged. Page navigation invalidates the selection request.

Save creates a private pending item. Done creates a private done item when the URL is new, or marks a canonical URL match done without changing its title, notes, visibility, or review state. Repeated saves preserve existing items. Deliberate capture does not set a blanket review flag. Concrete incomplete details remain editable in Margin; duplicate captures preserve existing review state. Saves never add to Up next; Done removes existing membership transactionally. The popup’s receipt links directly to the item’s editor in Margin.

Margin saves a new capture before fetching remote metadata in the background. The extension also supplies title, author, summary, and image hints from the page you explicitly capture, so a publisher blocking the server can still have useful details. Known YouTube placeholder-page hints are discarded so first-party metadata can fill them. A saved receipt with `metadata_state:pending` reports that details are still loading, using a neutral `…` badge; open Margin to check or retry. A later enrichment failure is shown in Margin, without extension polling. A popup capture is bound to its previewed tab and URL. Navigation detected during extraction or the final pre-send check asks you to check the new page before retrying; navigation after submission starts cannot cancel an already committed capture. Success and failure badges belong to the captured page and clear on navigation. Badge failures do not invalidate a saved receipt. A red `!` badge means capture failed; hover the toolbar icon for the error. An amber `!` means the page saved with known missing details.

## Access and validation

The browser token can create private items and mark a URL done. It cannot read the library, edit metadata, delete items, or publish. Existing bot submission tokens remain add-only and cannot call the browser endpoint. Rotate or revoke the browser token independently in Margin Settings.

Tokens stay in extension-local storage, accessible only to trusted extension contexts. There are no persistent content scripts or full-page capture. The scripting permission reads metadata when you invoke Save or Done, and selected text only when explicitly included, limited by activeTab. Only the configured Margin site receives a requested host permission; switching sites removes the old permission.

The toolbar and extension-manager icons include PNG sizes 16, 32, 48, and 128. Popup and setup use a bundled Inter font, with its license in `fonts/`.

Run command, origin validation, and recovery tests from the repository root:

```sh
mise exec -- node --test extension/*.test.mjs
```

Browser UI regression tests live in `web/tests/e2e/extension.spec.ts` and use mocked Chromium APIs for deterministic setup, shortcut, capture, and error states. Loading the unpacked package in Chromium separately verifies the manifest, service worker, icons, local font, and native command registration. Actual Helium shortcut conflicts still depend on your browser configuration.
