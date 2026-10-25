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
        ["↑ / ↓", "Previous / next item"],
        ["Home / End", "First / last item"],
        ["Enter", "Open selected item"],
        [formatForDisplay("Mod+K"), "Search"],
        ["Alt+1 / Alt+2", "Library / Discover"],
        ["[ / ]", "Previous / next status filter"],
        [formatForDisplay("Mod+,"), "Settings"],
        ["Alt+S", "Sources"],
        ["F1", "Keyboard help"],
      ],
    },
    {
      name: "Edit & save",
      rows: [
        [formatForDisplay("Mod+Shift+A"), "Add item"],
        [formatForDisplay("Mod+Enter"), "Save editor"],
        [formatForDisplay("Mod+Z"), "Undo last status change"],
        ["Tab / Shift+Tab", "Controls, filters & row actions"],
        ["Esc", "Close dialog / leave search"],
      ],
    },
    {
      name: "Quick keys",
      rows: [
        ["J / K", "Next / previous"],
        ["O", "Open item"],
        ["S", "Save discovery"],
        ["R", "Read / unread"],
        ["X", "Dismiss discovery"],
        ["D", "Done / to read"],
        ["E", "Edit library item"],
        ["/ / N", "Search / add"],
        ["G then L / D", "Library / Discover"],
        ["Shift+R", "Check sources"],
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
                    <kbd className="rounded border border-[var(--u-line-soft)] bg-[var(--u-well)] px-1 py-0.5 font-sans text-[10px]">
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
        Quick keys {singleKeys ? "are on" : "are off"}; change them in Settings.
        Typing and dialogs keep their own keys.
      </p>
    </Modal>
  );
}
