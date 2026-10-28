export function normalizeOrigin(value) {
  const raw = value.trim();
  const local = /^(localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(raw);
  let url;
  try {
    url = new URL(
      raw.includes("://") ? raw : (local ? "http://" : "https://") + raw,
    );
  } catch {
    throw new Error("Enter your Margin site address.");
  }
  if (
    !raw ||
    url.username ||
    url.password ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname))
    )
  )
    throw new Error(
      "Use HTTPS, or HTTP on localhost, without a username or password.",
    );
  return url.origin;
}

export async function readShortcuts() {
  try {
    return await chrome.commands.getAll();
  } catch {
    return [];
  }
}

export function openShortcuts() {
  return chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
}

export function setStatus(element, message, tone = "neutral") {
  element.dataset.tone = tone;
  element.setAttribute("role", tone === "error" ? "alert" : "status");
  element.textContent = message;
  element.hidden = !message;
}
