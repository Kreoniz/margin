import { normalizeOrigin } from "./shared.js";

chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

function captureError(message, code) {
  return Object.assign(new Error(message), { code });
}

// Runs only on the page the user explicitly captures via activeTab.
export function readPageMetadata(expectedURL, includeSelection = false) {
  if (location.href !== expectedURL) return { page_changed: true };
  let selection;
  if (includeSelection) {
    const text = window.getSelection()?.toString() || "";
    if (!text.trim()) return { selection_error: "Select some text on the page first, or turn off Include selected text." };
    if (new TextEncoder().encode(text).length > 10000)
      return { selection_error: "Select less text (at most 10,000 UTF-8 bytes), or turn off Include selected text." };
    selection = { text, source_url: expectedURL };
  }
  const meta = (...keys) =>
    keys
      .map((key) =>
        document
          .querySelector(`meta[property="${key}"],meta[name="${key}"]`)
          ?.content?.trim(),
      )
      .find(Boolean) || "";
  let cover = meta("og:image", "twitter:image");
  try {
    const url = new URL(cover, document.baseURI);
    cover =
      /^https?:$/.test(url.protocol) && !url.username && !url.password && cover
        ? url.href
        : "";
  } catch {
    cover = "";
  }
  if (location.href !== expectedURL) return { page_changed: true };
  return {
    ...(selection ? { selection } : {}),
    title: (meta("og:title", "twitter:title") || document.title || "").slice(
      0,
      1000,
    ),
    author: meta("author", "article:author").slice(0, 1000),
    description: meta(
      "og:description",
      "description",
      "twitter:description",
    ).slice(0, 20000),
    cover_url: cover.slice(0, 4096),
  };
}

export async function capture(action, capturedTab, includeSelection = false) {
  if (!["save", "done"].includes(action))
    throw new Error("Unknown capture action.");
  const saved = await chrome.storage.local.get(["origin", "token"]);
  if (!saved.origin || !saved.token)
    throw captureError(
      "Connect to Margin in extension Settings first.",
      "connection",
    );
  let origin;
  try {
    origin = normalizeOrigin(saved.origin);
  } catch {
    throw captureError(
      "Check your Margin address in extension Settings.",
      "connection",
    );
  }
  const token = saved.token;
  const allowed = await chrome.permissions.contains({
    origins: [origin + "/*"],
  });
  if (!allowed)
    throw captureError(
      "Grant access to your Margin site again in extension Settings.",
      "connection",
    );
  const [tab] = capturedTab
    ? [capturedTab]
    : await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
  if (!tab?.url || !/^https?:\/\//i.test(tab.url))
    throw new Error("Open a public HTTP or HTTPS page to capture.");
  let pageMetadata;
  let selection;
  let page;
  try {
    [page] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readPageMetadata,
      args: [tab.url, includeSelection],
    });
  } catch {
    /* URL-only capture still works when the browser cannot read metadata. */
  }
  if (page?.result?.page_changed)
    throw captureError("The page changed. Check the new page and try again.", "page_changed");
  if (includeSelection) {
    if (page?.result?.selection_error)
      throw captureError(page.result.selection_error, "selection");
    selection = page?.result?.selection;
    if (!selection?.text || selection.source_url !== tab.url)
      throw captureError("Could not read selected text. Select text on this page and retry, or turn off Include selected text.", "selection");
  }
  if (page?.result?.title) {
    const { title, author, cover_url, description } = page.result;
    pageMetadata = { title, author, cover_url, description };
  }
  await chrome.action
    .setBadgeText({ text: "…", tabId: tab.id })
    .catch(() => {});
  const beforeSend = chrome.tabs.get ? await chrome.tabs.get(tab.id).catch(() => null) : tab;
  if (beforeSend?.url !== tab.url)
    throw captureError("The page changed. Check the new page and try again.", "page_changed");
  const response = await fetch(origin + "/api/integrations/capture", {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({
      url: tab.url,
      action,
      ...(pageMetadata ? { page_metadata: pageMetadata } : {}),
      ...(selection ? { selection } : {}),
    }),
    signal: AbortSignal.timeout(35_000),
  }).catch((error) => {
    throw captureError(
      error.name === "TimeoutError"
        ? "Margin took too long to respond. Try again."
        : "Could not reach Margin. Check the address and whether the app is running.",
      "connection",
    );
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw captureError(
      "That address did not return a Margin response. Check the connection in Settings.",
      "connection",
    );
  }
  if (!response.ok)
    throw captureError(
      [401, 403].includes(response.status)
        ? "Your browser token was rejected. Update the connection in Settings."
        : result?.error || "Margin could not capture this page.",
      [401, 403].includes(response.status) ? "connection" : undefined,
    );
  if (typeof result?.id !== "string" || typeof result.created !== "boolean")
    throw captureError(
      "That address did not return a valid Margin receipt. Check Settings.",
      "connection",
    );
  if (selection && typeof result.selection_saved !== "boolean")
    result.warning = "Page saved. Selected-text storage could not be confirmed; open Margin to check it.";
  else if (selection && !result.selection_saved && !result.warning)
    result.warning = "Already saved. The selected text was not added. Open Margin to review the existing item.";
  const current = chrome.tabs.get
    ? await chrome.tabs.get(tab.id).catch(() => null)
    : tab;
  if (current?.url !== tab.url)
    return {
      editURL: origin + "/dashboard#edit=" + encodeURIComponent(result.id),
      ...result,
    };
  const pending = result.metadata_state === "pending";
  try {
    await chrome.action.setBadgeBackgroundColor({
      color: result.warning ? "#9b732c" : pending ? "#536b86" : "#357d65",
      tabId: tab.id,
    });
    await chrome.action.setBadgeText({
      text: result.warning ? "!" : pending ? "…" : action === "done" ? "Done" : "Saved",
      tabId: tab.id,
    });
    await chrome.action.setTitle({
      title: result.warning
        ? "Saved. Some details unavailable; open Margin to retry."
        : pending
          ? "Saved. Details are still loading in Margin."
          : action === "done"
          ? "Marked Done in Margin"
          : "Saved to Margin",
      tabId: tab.id,
    });
  } catch { /* Cosmetic feedback must not turn a committed capture into failure. */ }
  return {
    editURL: origin + "/dashboard#edit=" + encodeURIComponent(result.id),
    ...result,
  };
}
async function run(action, expectedTab, includeSelection = false) {
  let tab;
  try {
    if (expectedTab) {
      if (
        !Number.isInteger(expectedTab.id) ||
        typeof expectedTab.url !== "string"
      )
        throw captureError(
          "Reopen Margin capture to choose the current page.",
          "page_changed",
        );
      tab = { id: expectedTab.id, url: expectedTab.url };
      const current = await chrome.tabs.get(tab.id).catch(() => null);
      if (current?.url !== tab.url)
        throw captureError(
          "The page changed. Check the new page and try again.",
          "page_changed",
        );
      tab = current;
    } else {
      [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
    }
    return await capture(action, tab, includeSelection);
  } catch (error) {
    const current =
      tab &&
      (chrome.tabs.get ? await chrome.tabs.get(tab.id).catch(() => null) : tab);
    if (tab?.url && current?.url === tab.url) {
      await chrome.action
        .setBadgeBackgroundColor({ color: "#a23f46", tabId: tab.id })
        .catch(() => {});
      await chrome.action
        .setBadgeText({ text: "!", tabId: tab.id })
        .catch(() => {});
      await chrome.action
        .setTitle({ title: error.message, tabId: tab.id })
        .catch(() => {});
    }
    throw error;
  }
}
chrome.commands.onCommand.addListener((command) => {
  if (["save-page", "done-page"].includes(command))
    void run(command === "done-page" ? "done" : "save").catch(() => {});
});
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.type !== "capture") return;
  void run(message.action, message.tab, message.includeSelection === true).then(
    (result) => reply({ result }),
    (error) => reply({ error: error.message, code: error.code }),
  );
  return true;
});

chrome.tabs.onUpdated?.addListener((tabId, change) => {
  if (change.status === "loading" || change.url) {
    void chrome.action.setBadgeText({ text: "", tabId }).catch(() => {});
    void chrome.action.setTitle({ title: "Margin capture", tabId }).catch(() => {});
  }
});
