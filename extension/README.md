# Margin capture for Helium / Chromium

Load this folder with **Extensions → Developer mode → Load unpacked**. No build step is needed. Open Margin’s `/dashboard`, then **Settings → Helium / browser capture** and create a browser token. In the extension’s options, save the Margin origin (HTTPS, or HTTP on localhost) and that token. Grant access to that site when prompted.

For the current local review:

1. In Helium’s Extensions page, enable Developer mode and choose **Load unpacked**. Select `/home/kreoniz/code/margin/extension` (the folder containing `manifest.json`), or extract the supplied ZIP and select that folder.
2. Open `http://localhost:5178/dashboard` → **Settings → Helium / browser capture** → **Create browser token**.
3. Open the extension’s **Connection & shortcuts** options. Set **Margin address** to `http://localhost:5178` (no `/dashboard` path), paste the browser token, and save. Allow access to that local site when prompted.
4. Open a public article, book, or video page and use **Save page** or **Mark Done**. New captures appear in the dashboard’s **To review** filter. Use the popup’s edit link to adjust metadata or visibility.

The extension is loaded locally, not installed automatically or published to an extension store. For a deployed Margin instance, use that instance’s HTTPS origin and create its browser token there.

Choose separate shortcuts for **Save current page** and **Mark current page Done** at `chrome://extensions/shortcuts` (or Helium’s equivalent). They deliberately have no defaults, avoiding browser and OS conflicts. Both commands also appear in the popup. The extension sends only the current URL and action; Margin fetches metadata. The popup offers a secondary link to edit details or visibility in the dashboard.

Save creates a private pending item. Done creates a private done item when the URL is new, or marks a canonical URL match done without changing its title, notes, visibility, or review state. Repeated saves preserve existing items. New external captures remain in **To review** until explicitly marked reviewed; viewing, scrolling, and completion do not clear that flag.

The browser token can create private items and mark a URL done. It cannot read the library, edit metadata, delete items, or publish. Existing bot submission tokens remain add-only and cannot call the browser endpoint. Rotate/revoke the browser token independently in Settings. Tokens stay in extension-local storage, accessible only to trusted extension contexts. There are no content scripts, page scraping, or broad mandatory host permissions; only the configured Margin origin receives a requested host permission.

Run the command tests from the repository root:

```sh
mise exec -- node --test extension/background.test.mjs
```

This extension uses Manifest V3 and Chromium APIs. Actual installation and shortcut conflicts depend on the Helium/browser build; verify the selected shortcuts there. A red `!` badge means capture failed; hover the toolbar icon or open the popup for the error.
