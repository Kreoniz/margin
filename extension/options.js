import {
  normalizeOrigin,
  openShortcuts,
  readShortcuts,
  setStatus,
} from "./shared.js";

const form = document.querySelector("#connection");
const originInput = document.querySelector("#origin");
const tokenInput = document.querySelector("#token");
const status = document.querySelector("#status");
let saved = {};
try {
  saved = await chrome.storage.local.get(["origin", "token"]);
  originInput.value = saved.origin || "";
  tokenInput.value = saved.token || "";
} catch {
  setStatus(
    status,
    "Could not load the saved connection. Try saving it again.",
    "error",
  );
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  for (const input of [originInput, tokenInput])
    input.removeAttribute("aria-invalid");
  let origin;
  try {
    origin = normalizeOrigin(originInput.value);
  } catch (error) {
    originInput.setAttribute("aria-invalid", "true");
    originInput.focus();
    setStatus(status, error.message, "error");
    return;
  }
  const token = tokenInput.value.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    tokenInput.setAttribute("aria-invalid", "true");
    tokenInput.focus();
    setStatus(
      status,
      "Paste the browser capture token from Margin Settings.",
      "error",
    );
    return;
  }
  for (const control of form.elements) control.disabled = true;
  setStatus(status, "Saving connection…");
  try {
    const granted = await chrome.permissions.request({
      origins: [origin + "/*"],
    });
    if (!granted)
      throw new Error(
        "Allow access to this Margin site when your browser asks, then save again.",
      );
    await chrome.storage.local.set({ origin, token });
    if (saved.origin && saved.origin !== origin)
      await chrome.permissions.remove({ origins: [saved.origin + "/*"] });
    saved = { origin, token };
    originInput.value = origin;
    tokenInput.value = token;
    setStatus(
      status,
      "Connection saved. Open a web page and use Margin capture.",
      "success",
    );
  } catch (error) {
    setStatus(
      status,
      error.message || "Could not save the connection. Try again.",
      "error",
    );
  } finally {
    for (const control of form.elements) control.disabled = false;
  }
});
form.addEventListener("input", () => {
  setStatus(status, "Unsaved changes.");
});
document.querySelector("#show-token").addEventListener("click", (event) => {
  const show = tokenInput.type === "password";
  tokenInput.type = show ? "text" : "password";
  event.currentTarget.textContent = show ? "Hide" : "Show";
  event.currentTarget.setAttribute(
    "aria-label",
    show ? "Hide browser token" : "Show browser token",
  );
  event.currentTarget.setAttribute("aria-pressed", String(show));
});
document.querySelector("#shortcuts").addEventListener("click", openShortcuts);
const commands = await readShortcuts();
for (const [name, label] of [
  ["_execute_action", "Open capture"],
  ["save-page", "Save page directly"],
  ["done-page", "Mark done directly"],
]) {
  const row = document.createElement("div");
  const description = document.createElement("dt");
  const value = document.createElement("dd");
  const key = document.createElement("kbd");
  description.textContent = label;
  key.textContent =
    commands.find((command) => command.name === name)?.shortcut ||
    "Not assigned";
  value.append(key);
  row.append(description, value);
  document.querySelector("#command-list").append(row);
}
