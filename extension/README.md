# Margin capture for Helium / Chromium

Version 1.1.0 uses the selected Margin icon and a compact, keyboard-friendly popup. Load this folder with **Extensions → Developer mode → Load unpacked**; no build step is needed. If it is already installed, reload the unpacked extension after updating these files.

## Connect once

1. Load `/home/kreoniz/code/margin/extension` (the folder containing `manifest.json`), or extract the supplied ZIP and select that folder.
2. Open Margin → **Settings → Helium / browser capture → Create browser token**. The current local review is at `http://localhost:5178/dashboard`.
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

Save creates a private pending item. Done creates a private done item when the URL is new, or marks a canonical URL match done without changing its title, notes, visibility, or review state. Repeated saves preserve existing items. New captures appear in **To review** until explicitly marked reviewed; viewing, scrolling, and completion do not clear that flag. The popup’s receipt links directly to the item’s editor in Margin.

Margin fetches URL metadata. The extension also supplies title, author, summary, and image hints from the page you explicitly capture, so a publisher blocking the server can still have useful details. Incomplete metadata produces a warning with a review link. A popup capture is bound to its previewed tab and URL; if the page changes, it asks you to check the new page before retrying. Success and failure badges belong to the captured page and clear on navigation. A red `!` badge means capture failed; hover the toolbar icon for the error. An amber `!` means the page saved with missing details.

## Access and validation

The browser token can create private items and mark a URL done. It cannot read the library, edit metadata, delete items, or publish. Existing bot submission tokens remain add-only and cannot call the browser endpoint. Rotate or revoke the browser token independently in Margin Settings.

Tokens stay in extension-local storage, accessible only to trusted extension contexts. There are no persistent content scripts or full-page capture. The scripting permission reads metadata only when you invoke Save or Done, limited by activeTab. Only the configured Margin site receives a requested host permission; switching sites removes the old permission.

The toolbar and extension-manager icons include PNG sizes 16, 32, 48, and 128. Popup and setup use a bundled Inter font, with its license in `fonts/`.

Run command, origin validation, and recovery tests from the repository root:

```sh
mise exec -- node --test extension/*.test.mjs
```

Browser UI regression tests live in `web/tests/e2e/extension.spec.ts` and use mocked Chromium APIs for deterministic setup, shortcut, capture, and error states. Loading the unpacked package in Chromium separately verifies the manifest, service worker, icons, local font, and native command registration. Actual Helium shortcut conflicts still depend on your browser configuration.
