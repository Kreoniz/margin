const form = document.querySelector("#options");
const originInput = document.querySelector("#origin");
const tokenInput = document.querySelector("#token");
const status = document.querySelector("#status");
const saved = await chrome.storage.local.get(["origin", "token"]);
originInput.value = saved.origin || "";
tokenInput.value = saved.token || "";
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const url = new URL(originInput.value);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname))
      )
    )
      throw new Error(
        "Use an HTTPS site address, or HTTP on localhost, without a path or credentials.",
      );
    const origin = url.origin;
    const token = tokenInput.value.trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new Error("Paste the browser token from Margin Settings.");
    const granted = await chrome.permissions.request({
      origins: [origin + "/*"],
    });
    if (!granted)
      throw new Error("Permission to reach this Margin site is required.");
    await chrome.storage.local.set({ origin, token });
    if (saved.origin && saved.origin !== origin)
      await chrome.permissions.remove({ origins: [saved.origin + "/*"] });
    saved.origin = origin;
    status.textContent =
      "Connection saved. Set your Save and Done shortcuts below.";
  } catch (error) {
    status.textContent = error.message;
  }
});
document
  .querySelector("#shortcuts")
  .addEventListener("click", () =>
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" }),
  );
