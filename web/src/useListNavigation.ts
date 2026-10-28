import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useHotkeys } from "@tanstack/react-hotkeys";

export type RowAction = "open" | "save" | "read" | "dismiss" | "done" | "edit";

export function useListNavigation<T extends { id: string }>({
  items,
  root,
  limit,
  onLimit,
  scope,
  enabled,
  singleKeys,
  actions,
}: {
  items: T[];
  root: RefObject<HTMLDivElement | null>;
  limit: number;
  onLimit: (limit: number) => void;
  scope: string;
  enabled: boolean;
  singleKeys: boolean;
  actions: Partial<Record<RowAction, (item: T) => void>>;
}) {
  const [activeId, setActiveId] = useState<string>();
  const [active, setActive] = useState(false);
  const focusedRow = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<string | undefined>(undefined);
  const index = useRef(0);
  const previousScope = useRef(scope);
  const visible = items.slice(0, limit);
  const signature = visible.map((item) => item.id).join("|");
  const selected =
    visible.find((item) => item.id === activeId) ||
    visible[Math.min(index.current, visible.length - 1)];
  const canNavigate = enabled && items.length > 0;

  function row(id: string) {
    return root.current?.querySelector<HTMLElement>(
      `[data-row-id="${CSS.escape(id)}"]`,
    );
  }
  function focusAt(next: number) {
    if (!items.length) return;
    const position = Math.max(0, Math.min(next, items.length - 1));
    const item = items[position];
    index.current = position;
    setActive(true);
    setActiveId(item.id);
    if (position >= limit) onLimit(Math.ceil((position + 1) / 40) * 40);
    const element = row(item.id);
    if (element) {
      pendingFocus.current = undefined;
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: "nearest", behavior: "instant" });
    } else pendingFocus.current = item.id;
  }
  function move(offset: number) {
    const current = items.findIndex((item) => item.id === activeId);
    focusAt(
      !active || current < 0
        ? offset > 0
          ? 0
          : items.length - 1
        : current + offset,
    );
  }
  function invoke(action: RowAction) {
    if (selected) actions[action]?.(selected);
  }
  useHotkeys(
    [
      {
        hotkey: "ArrowDown",
        callback: () => move(1),
        options: { requireReset: false },
      },
      {
        hotkey: "ArrowUp",
        callback: () => move(-1),
        options: { requireReset: false },
      },
      { hotkey: "Home", callback: () => focusAt(0) },
      { hotkey: "End", callback: () => focusAt(items.length - 1) },
      {
        hotkey: "J",
        callback: () => move(1),
        options: { enabled: canNavigate && singleKeys, requireReset: false },
      },
      {
        hotkey: "K",
        callback: () => move(-1),
        options: { enabled: canNavigate && singleKeys, requireReset: false },
      },
      {
        hotkey: "Shift+G",
        callback: () => focusAt(items.length - 1),
        options: { enabled: canNavigate && singleKeys },
      },
      { hotkey: "Enter", callback: () => invoke("open") },
      ...(
        [
          ["O", "open"],
          ["S", "save"],
          ["R", "read"],
          ["X", "dismiss"],
          ["D", "done"],
          ["E", "edit"],
        ] as const
      ).map(([hotkey, action]) => ({
        hotkey,
        callback: () => invoke(action),
        options: {
          enabled: canNavigate && singleKeys && Boolean(actions[action]),
        },
      })),
    ],
    { enabled: canNavigate, ignoreInputs: "auto", requireReset: true },
  );

  useLayoutEffect(() => {
    const changedScope = previousScope.current !== scope;
    previousScope.current = scope;
    const found = visible.findIndex((item) => item.id === activeId);
    const nextIndex = changedScope
      ? 0
      : found >= 0
        ? found
        : Math.min(index.current, visible.length - 1);
    const next = visible[nextIndex];
    if (
      pendingFocus.current &&
      !visible.some((item) => item.id === pendingFocus.current)
    )
      pendingFocus.current = undefined;
    index.current = Math.max(0, nextIndex);
    if (!next) {
      if (activeId !== undefined) setActiveId(undefined);
      if (
        enabled &&
        focusedRow.current &&
        !focusedRow.current.isConnected &&
        document.activeElement === document.body
      )
        document.getElementById("content")?.focus({ preventScroll: true });
      return;
    }
    if (next.id !== activeId) setActiveId(next.id);
    const lostFocus =
      focusedRow.current &&
      !focusedRow.current.isConnected &&
      (document.activeElement === document.body ||
        document.activeElement?.id === "content");
    if (enabled && (pendingFocus.current === next.id || lostFocus)) {
      const element = row(next.id);
      if (element) {
        element.focus({ preventScroll: true });
        element.scrollIntoView({ block: "nearest", behavior: "instant" });
        pendingFocus.current = undefined;
      }
    }
  }, [signature, activeId, scope, enabled]);

  return {
    selectedId: selected?.id,
    active,
    focusFirst: () => focusAt(0),
    onFocus: (item: T, element: HTMLElement) => {
      setActiveId(item.id);
      setActive(true);
      index.current = items.findIndex((candidate) => candidate.id === item.id);
      focusedRow.current = element;
    },
  };
}
