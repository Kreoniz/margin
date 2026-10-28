chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

// Runs only on the page the user explicitly captures via activeTab.
export function readPageMetadata(expectedURL) {
  if (location.href !== expectedURL) return null;
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
  if (location.href !== expectedURL) return null;
  return {
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

export async function capture(action, capturedTab) {
  if (!["save", "done"].includes(action))
    throw new Error("Unknown capture action.");
  const { origin, token } = await chrome.storage.local.get(["origin", "token"]);
  if (!origin || !token)
    throw new Error(
      "Set the Margin address and browser token in extension options.",
    );
  const allowed = await chrome.permissions.contains({
    origins: [origin + "/*"],
  });
  if (!allowed)
    throw new Error(
      "Grant access to the Margin address again in extension options.",
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
  try {
    const [page] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readPageMetadata,
      args: [tab.url],
    });
    if (page?.result?.title) pageMetadata = page.result;
  } catch {
    /* URL-only capture still works when the browser cannot read metadata. */
  }
  await chrome.action
    .setBadgeText({ text: "…", tabId: tab.id })
    .catch(() => {});
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
    }),
    signal: AbortSignal.timeout(35_000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Margin could not capture this page.");
  const current = chrome.tabs.get
    ? await chrome.tabs.get(tab.id).catch(() => null)
    : tab;
  if (current?.url !== tab.url)
    return {
      editURL: origin + "/dashboard#edit=" + encodeURIComponent(result.id),
      ...result,
    };
  await chrome.action.setBadgeBackgroundColor({
    color: result.warning ? "#9b732c" : "#357d65",
    tabId: tab.id,
  });
  await chrome.action.setBadgeText({
    text: result.warning ? "!" : action === "done" ? "Done" : "Saved",
    tabId: tab.id,
  });
  await chrome.action.setTitle({
    title: result.warning
      ? "Saved. Some details unavailable; open Margin to retry."
      : action === "done"
        ? "Marked Done in Margin"
        : "Saved to Margin",
    tabId: tab.id,
  });
  return {
    editURL: origin + "/dashboard#edit=" + encodeURIComponent(result.id),
    ...result,
  };
}
async function run(action) {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return await capture(action, tab);
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
  void run(message.action).then(
    (result) => reply({ result }),
    (error) => reply({ error: error.message }),
  );
  return true;
});

chrome.tabs.onUpdated?.addListener((tabId, change) => {
  if (change.status === "loading" || change.url) {
    void chrome.action.setBadgeText({ text: "", tabId });
    void chrome.action.setTitle({ title: "Margin capture", tabId });
  }
});
