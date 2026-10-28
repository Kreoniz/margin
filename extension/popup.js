const buttons = [...document.querySelectorAll("[data-action]")];
const status = document.querySelector("#status");
for (const button of buttons)
  button.addEventListener("click", async () => {
    buttons.forEach((b) => (b.disabled = true));
    status.textContent = "Sending to Margin…";
    try {
      const reply = await chrome.runtime.sendMessage({
        type: "capture",
        action: button.dataset.action,
      });
      if (reply.error) throw new Error(reply.error);
      status.textContent = reply.result.warning
        ? "Saved. " + reply.result.warning
        : button.dataset.action === "done"
          ? "Marked Done."
          : reply.result.created
            ? "Saved. Ready to review in Margin."
            : "Already in your library.";
      const link = document.querySelector("#edit");
      link.href = reply.result.editURL;
      link.hidden = false;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });
document
  .querySelector("#options")
  .addEventListener("click", () => chrome.runtime.openOptionsPage());
