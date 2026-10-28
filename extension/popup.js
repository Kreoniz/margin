import {
  normalizeOrigin,
  openShortcuts,
  readShortcuts,
  setStatus,
} from "./shared.js";

const buttons = [...document.querySelectorAll("[data-action]")];
const status = document.querySelector("#status");
const edit = document.querySelector("#edit");
const reconnect = document.querySelector("#reconnect");
let tab;
let ready = false;
let busy = false;

async function loadPage() {
  [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  let url;
  try {
    url = new URL(tab?.url);
  } catch {
    /* Browser pages have no usable URL. */
  }
  const supported =
    url &&
    ["https:", "http:"].includes(url.protocol) &&
    !url.username &&
    !url.password;
  document.querySelector("#page-title").textContent = supported
    ? tab.title || url.hostname
    : "This page can’t be saved";
  document.querySelector("#page-host").textContent = supported
    ? url.host
    : "Open a web page to save it to Margin.";
  return Boolean(supported);
}

async function initialize() {
  try {
    const [saved, supported] = await Promise.all([
      chrome.storage.local.get(["origin", "token"]),
      loadPage(),
    ]);
    let origin;
    try {
      if (saved.origin && saved.token) origin = normalizeOrigin(saved.origin);
    } catch {
      /* Offer setup for an invalid saved address. */
    }
    const allowed =
      origin &&
      (await chrome.permissions.contains({ origins: [origin + "/*"] }));
    document.querySelector("#setup").hidden = Boolean(allowed);
    const library = document.querySelector("#library");
    library.hidden = !origin;
    if (origin) library.href = origin + "/dashboard";
    ready = Boolean(allowed && supported);
    buttons.forEach((button) => {
      button.disabled = !ready;
    });
    setStatus(
      status,
      ready
        ? "Ready to save this page."
        : allowed
          ? "Web pages with an HTTP or HTTPS address can be saved."
          : "Connect to your Margin library to continue.",
    );
  } catch {
    setStatus(
      status,
      "Could not load the connection. Open Settings to try again.",
      "error",
    );
    reconnect.hidden = false;
  }
  const commands = await readShortcuts();
  const shortcut = commands.find(
    (command) => command.name === "_execute_action",
  )?.shortcut;
  document.querySelector("#shortcut-hint").textContent =
    (shortcut ? shortcut + " opens capture · " : "") +
    "S save · D done · H/L choose";
  for (const button of buttons) {
    const shortcut = commands.find(
      (command) => command.name === button.dataset.action + "-page",
    )?.shortcut;
    button.setAttribute(
      "aria-label",
      (button.dataset.action === "save" ? "Save for later" : "Mark done") +
        (shortcut ? ". Browser shortcut: " + shortcut : ""),
    );
  }
}

async function send(action) {
  if (!ready || busy) return;
  busy = true;
  buttons.forEach((button) => {
    button.disabled = true;
  });
  edit.hidden = true;
  reconnect.hidden = true;
  setStatus(
    status,
    action === "done" ? "Marking this page done…" : "Saving this page…",
  );
  document.querySelector(".actions").setAttribute("aria-busy", "true");
  try {
    const reply = await chrome.runtime.sendMessage({
      type: "capture",
      action,
      tab: { id: tab.id, url: tab.url },
    });
    if (!reply || reply.error) {
      if (reply?.code === "connection") reconnect.hidden = false;
      if (reply?.code === "page_changed") ready = await loadPage();
      throw new Error(
        reply?.error || "The capture service did not respond. Try again.",
      );
    }
    const result = reply.result;
    const message =
      action === "done"
        ? "Marked done."
        : result.created
          ? "Saved for later. Ready to review in Margin."
          : "Already in your library.";
    setStatus(
      status,
      message + (result.warning ? " " + result.warning : ""),
      result.warning ? "warning" : "success",
    );
    edit.href = result.editURL;
    edit.textContent = result.created
      ? "Review in Margin ↗"
      : "Open saved item ↗";
    edit.hidden = false;
  } catch (error) {
    setStatus(
      status,
      error.message || "Could not save this page. Try again.",
      "error",
    );
  } finally {
    busy = false;
    buttons.forEach((button) => {
      button.disabled = !ready;
    });
    document.querySelector(".actions").removeAttribute("aria-busy");
  }
}

for (const button of buttons)
  button.addEventListener("click", () => void send(button.dataset.action));
for (const id of ["options", "connect", "reconnect"])
  document
    .querySelector("#" + id)
    .addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#shortcuts").addEventListener("click", openShortcuts);
document.addEventListener("keydown", (event) => {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    event.target.closest("input,textarea,select,[contenteditable=true]")
  )
    return;
  const key = event.key.toLowerCase();
  if (!ready || busy || event.repeat) return;
  if (["s", "d"].includes(key)) {
    event.preventDefault();
    void send(key === "s" ? "save" : "done");
  } else if (["h", "l", "arrowleft", "arrowright"].includes(key)) {
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement);
    const next =
      key === "h" || key === "arrowleft"
        ? Math.max(0, current - 1)
        : current < 0
          ? 0
          : Math.min(buttons.length - 1, current + 1);
    buttons[next].focus();
  }
});
await initialize();
