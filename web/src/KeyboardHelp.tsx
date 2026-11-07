import { formatForDisplay } from "@tanstack/react-hotkeys";
import { Modal } from "./components";

export function KeyboardHelp({
  onClose,
  singleKeys,
}: {
  onClose: () => void;
  singleKeys: boolean;
}) {
  const groups = [
    {
      name: "Move around",
      rows: [
        ["← / ↓ / ↑ / →", "Move between items in that direction"],
        ["Home", "Page top & first item"],
        ["Ctrl+Home", "Page top (also with an empty list)"],
        ["End", "Last item"],
        ["Enter", "Open selected item"],
        [formatForDisplay("Mod+K"), "Quick Find · all saved items"],
        [formatForDisplay("Mod+,"), "Settings"],
        ["F1", "Keyboard help"],
      ],
    },
    {
      name: "Edit & save",
      rows: [
        [formatForDisplay("Mod+Shift+A"), "Add item"],
        [formatForDisplay("Mod+Enter"), "Save editor"],
        [formatForDisplay("Mod+Shift+D"), "Editor details"],
        [formatForDisplay("Mod+Shift+L"), "Toggle editor visibility"],
        [formatForDisplay("Mod+Z"), "Undo last status change"],
        ["Tab, then Enter / Space", "Up next: activate Up, Down, or Remove"],
        ["Tab / Shift+Tab", "Controls, filters & row actions"],
        ["Esc", "Close dialog / leave search"],
      ],
    },
    {
      name: "Vim navigation" + (singleKeys ? "" : " (off)"),
      rows: [
        ["h / j / k / l", "Move left / down / up / right"],
        ["Shift+h / Shift+l", "Library / Discover page"],
        ["g then g / G", "Page top & first item / last item"],
        ["[ / ]", "Previous / next status tab"],
        ["Ctrl+d / Ctrl+u", "Half page down / up"],
        ["g then n / l / d / s", "Up next / Library / Discover / Sources"],
        ["v then b / s / l", "Side by side / Shelves / List"],
        ["f then t / g / c", "Filter types / tags / channels"],
        ["/", "Search the current view"],
      ],
    },
    {
      name: "Vim item actions" + (singleKeys ? "" : " (off)"),
      rows: [
        ["o", "Open item"],
        ["s", "Save discovery"],
        ["r", "Read / unread"],
        ["x", "Dismiss discovery"],
        ["Space", "Done / to read"],
        ["d then d", "Remove library item (confirm)"],
        ["u", "Undo last status/review change"],
        ["e", "Edit library item"],
        ["a / n", "Add item (n is a legacy alias)"],
        ["Shift+r", "Check sources"],
        ["?", "Keyboard help"],
      ],
    },
  ];
  return (
    <Modal
      title="Keyboard shortcuts"
      onClose={onClose}
      className="keyboard-help"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map((group) => (
          <section key={group.name} className="min-w-0">
            <h3 className="mb-2 text-xs font-semibold text-[var(--u-muted)]">
              {group.name}
            </h3>
            <dl className="grid gap-1.5 text-xs">
              {group.rows.map(([key, description]) => (
                <div
                  key={key}
                  className="flex items-start justify-between gap-3"
                >
                  <dt className="text-[var(--u-muted)]">{description}</dt>
                  <dd className="m-0 shrink-0">
                    <kbd className="rounded border border-[var(--u-line-soft)] bg-[var(--u-well)] px-1 py-0.5 font-sans text-[11px]">
                      {key}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-[var(--u-muted)]">
        Vim quick keys {singleKeys ? "are on" : "are off"}; change them in Settings.
        Uppercase G means Shift+g. Typing and dialogs keep their own keys.
        {" "}In visual views, movement follows item positions; h/l do not wrap across rows.
        List and Discover use j/k or ↑/↓. The older v then g shortcut also opens Shelves.
        {" "}Quick Find ignores list filters. ↑/↓ select a result, Enter opens it,
        and Tab reaches Copy URL and Edit. Esc returns to your view.
      </p>
    </Modal>
  );
}
