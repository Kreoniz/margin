chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

export async function capture(action) {
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
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (!tab?.url || !/^https?:\/\//i.test(tab.url))
    throw new Error("Open a public HTTP or HTTPS page to capture.");
  const response = await fetch(origin + "/api/integrations/capture", {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ url: tab.url, action }),
    signal: AbortSignal.timeout(35_000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Margin could not capture this page.");
  await chrome.action.setBadgeBackgroundColor({
    color: "#357d65",
    tabId: tab.id,
  });
  await chrome.action.setBadgeText({
    text: action === "done" ? "Done" : "Saved",
    tabId: tab.id,
  });
  await chrome.action.setTitle({
    title: action === "done" ? "Marked Done in Margin" : "Saved to Margin",
    tabId: tab.id,
  });
  return {
    editURL: origin + "/dashboard#edit=" + encodeURIComponent(result.id),
    ...result,
  };
}
async function run(action) {
  try {
    return await capture(action);
  } catch (error) {
    const [tab] = await chrome.tabs
      .query({ active: true, lastFocusedWindow: true })
      .catch(() => []);
    const target = tab?.id === undefined ? {} : { tabId: tab.id };
    await chrome.action.setBadgeBackgroundColor({
      color: "#a23f46",
      ...target,
    });
    await chrome.action.setBadgeText({ text: "!", ...target });
    await chrome.action.setTitle({ title: error.message, ...target });
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
