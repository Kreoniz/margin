import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useHotkeys } from "@tanstack/react-hotkeys";

export type RowAction = "open" | "save" | "read" | "dismiss" | "done" | "edit" | "remove";
type Direction = "left" | "down" | "up" | "right";

export function useListNavigation<T extends { id: string }>({
  items,
  root,
  limit,
  onLimit,
  visibleItems,
  onReveal,
  spatial = false,
  group = () => "all",
  scope,
  enabled,
  singleKeys,
  actions,
  hasMore = false,
  onMore,
  onEnd,
  pageScope = scope,
}: {
  items: T[];
  root: RefObject<HTMLDivElement | null>;
  limit: number;
  onLimit: (limit: number) => void;
  visibleItems?: T[];
  onReveal?: (item: T) => void;
  spatial?: boolean;
  group?: (item: T) => string;
  scope: string;
  enabled: boolean;
  singleKeys: boolean;
  actions: Partial<Record<RowAction, (item: T) => void>>;
  hasMore?: boolean;
  onMore?: () => Promise<void>;
  onEnd?: () => Promise<void>;
  pageScope?: string;
}) {
  const [activeId, setActiveId] = useState<string>();
  // Remember the navigation cursor without keeping its visual focus active.
  const [hasSelection, setHasSelection] = useState(false);
  const [directFocus, setDirectFocus] = useState(false);
  const focusedRow = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<string | undefined>(undefined);
  const pendingDirection = useRef<Direction | undefined>(undefined);
  const index = useRef(0);
  const previousScope = useRef(scope);
  const pendingPage = useRef<number | "end" | undefined>(undefined);
  const paging = useRef(false);
  const previousPageScope = useRef(pageScope);
  const visible = visibleItems || items.slice(0, limit);
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
  function reveal(element: HTMLElement) {
    const first = root.current?.querySelector<HTMLElement>("[data-row-id]");
    // Returning to the first visual row should reveal the heading and filters,
    // rather than leave them hidden above the sticky application header.
    if (first && element.getBoundingClientRect().top <= first.getBoundingClientRect().top + 1)
      window.scrollTo({ top: 0, behavior: "instant" });
    else element.scrollIntoView({ block: "nearest", behavior: "instant" });
  }
  function focusFirst() {
    if (items.length) focusAt(0);
    else document.getElementById("content")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function focusAt(next: number) {
    if (!items.length) return;
    const position = Math.max(0, Math.min(next, items.length - 1));
    const item = items[position];
    index.current = position;
    setHasSelection(true);
    setActiveId(item.id);
    if (!visible.some(candidate => candidate.id === item.id)) {
      if (onReveal) onReveal(item);
      else onLimit(Math.ceil((position + 1) / 40) * 40);
    }
    const element = row(item.id);
    if (element) {
      pendingFocus.current = undefined;
      element.focus({ preventScroll: true });
      reveal(element);
    } else pendingFocus.current = item.id;
  }
  function move(offset: number) {
    const current = items.findIndex((item) => item.id === activeId);
    if (offset > 0 && hasSelection && current === items.length - 1 && hasMore && onMore) {
      if (!paging.current) {
        pendingPage.current = items.length;
        paging.current = true;
        void onMore().finally(() => { paging.current = false; });
      }
      return;
    }
    focusAt(
      !hasSelection || current < 0
        ? offset > 0
          ? 0
          : items.length - 1
        : current + offset,
    );
  }
  function moveDirection(direction: Direction) {
    if (!spatial) {
      if (direction === "down" || direction === "up") move(direction === "down" ? 1 : -1);
      return;
    }
    const current = items.findIndex(item => item.id === activeId);
    const origin = current >= 0 && row(items[current].id);
    if (!hasSelection || !origin) {
      focusAt(direction === "up" || direction === "left" ? items.length - 1 : 0);
      return;
    }
    const bounds = origin.getBoundingClientRect();
    const positions = visible.flatMap(item => {
      const element = row(item.id);
      return element?.getClientRects().length ? [{ item, rect: element.getBoundingClientRect() }] : [];
    });
    // Reveal the next local batch before measuring an incomplete last grid row.
    // Each section has its own batch so the reading rail is available immediately.
    if (onReveal && (direction === "down" || direction === "right")) {
      const sameGroup = positions.filter(position => group(position.item) === group(items[current]));
      const lastTop = Math.max(...sameGroup.map(position => position.rect.top));
      const hidden = items.find(item => group(item) === group(items[current]) && !visible.some(candidate => candidate.id === item.id));
      if (hidden && bounds.bottom + bounds.height >= lastTop) {
        pendingDirection.current = direction;
        onReveal(hidden);
        return;
      }
    }
    const horizontal = direction === "left" || direction === "right";
    const center = (r: DOMRect, axis: "x" | "y") => axis === "x" ? r.left + r.width / 2 : r.top + r.height / 2;
    const candidates = positions.filter(({ item, rect }) => item.id !== activeId && (
      direction === "down" ? rect.top >= bounds.bottom - 1 :
      direction === "up" ? rect.bottom <= bounds.top + 1 :
      direction === "right" ? rect.left >= bounds.right - 1 && rect.bottom > bounds.top + 1 && rect.top < bounds.bottom - 1 :
      rect.right <= bounds.left + 1 && rect.bottom > bounds.top + 1 && rect.top < bounds.bottom - 1
    )).map(position => {
      const r = position.rect;
      return { ...position,
        lane: horizontal || r.right > bounds.left + 1 && r.left < bounds.right - 1 ? 0 : 1,
        distance: direction === "down" ? r.top - bounds.bottom : direction === "up" ? bounds.top - r.bottom : direction === "right" ? r.left - bounds.right : bounds.left - r.right,
        alignment: Math.abs(center(r, horizontal ? "y" : "x") - center(bounds, horizontal ? "y" : "x")),
      };
    }).sort((a, b) => a.lane - b.lane || a.distance - b.distance || a.alignment - b.alignment);
    if (candidates[0]) focusAt(items.findIndex(item => item.id === candidates[0].item.id));
  }
  function end() {
    if (hasMore && onEnd) {
      if (!paging.current) {
        pendingPage.current = "end";
        paging.current = true;
        void onEnd().finally(() => { paging.current = false; });
      }
    } else focusAt(items.length - 1);
  }
  function invoke(action: RowAction) {
    if (selected) actions[action]?.(selected);
  }
  function halfPage(direction: number) {
    if (!visible.length) return;
    const start = Math.max(0, visible.findIndex(item => item.id === selected?.id));
    if (direction > 0 && start === visible.length - 1) {
      if (items.length > visible.length) {
        focusAt(items.findIndex(item => item.id === visible[start].id) + 1);
        return;
      }
      if (hasMore) {
        move(1);
        return;
      }
    }
    const origin = row(visible[start].id)?.getBoundingClientRect().top;
    if (origin === undefined) return;
    const target = origin + direction * window.innerHeight / 2;
    let nearest = start;
    let distance = Infinity;
    for (let position = start + direction; position >= 0 && position < visible.length; position += direction) {
      const top = row(visible[position].id)?.getBoundingClientRect().top;
      if (top === undefined) continue;
      const nextDistance = Math.abs(top - target);
      if (nextDistance > distance) break;
      nearest = position;
      distance = nextDistance;
    }
    focusAt(items.findIndex(item => item.id === visible[nearest].id));
  }
  useHotkeys(
    [
      {
        hotkey: "ArrowDown",
        callback: () => moveDirection("down"),
        options: { requireReset: false },
      },
      {
        hotkey: "ArrowUp",
        callback: () => moveDirection("up"),
        options: { requireReset: false },
      },
      { hotkey: "ArrowLeft", callback: () => moveDirection("left"), options: { enabled: canNavigate && spatial, requireReset: false } },
      { hotkey: "ArrowRight", callback: () => moveDirection("right"), options: { enabled: canNavigate && spatial, requireReset: false } },
      { hotkey: "Home", callback: focusFirst },
      { hotkey: "End", callback: end },
      {
        hotkey: "J",
        callback: () => moveDirection("down"),
        options: { enabled: canNavigate && singleKeys, requireReset: false },
      },
      {
        hotkey: "K",
        callback: () => moveDirection("up"),
        options: { enabled: canNavigate && singleKeys, requireReset: false },
      },
      { hotkey: "H", callback: () => moveDirection("left"), options: { enabled: canNavigate && singleKeys && spatial, requireReset: false } },
      { hotkey: "L", callback: () => moveDirection("right"), options: { enabled: canNavigate && singleKeys && spatial, requireReset: false } },
      {
        hotkey: "Shift+G",
        callback: end,
        options: { enabled: canNavigate && singleKeys },
      },
      { hotkey: "Enter", callback: () => invoke("open") },
      { hotkey: "Space", callback: () => invoke("done"), options: { enabled: canNavigate && singleKeys && Boolean(actions.done) } },
      { hotkey: ["D", "D"], callback: () => invoke("remove"), options: { enabled: canNavigate && singleKeys && Boolean(actions.remove) } },
      { hotkey: "Control+D", callback: () => halfPage(1), options: { enabled: canNavigate && singleKeys, ignoreInputs: true } },
      { hotkey: "Control+U", callback: () => halfPage(-1), options: { enabled: canNavigate && singleKeys, ignoreInputs: true } },
      ...(
        [
          ["O", "open"],
          ["S", "save"],
          ["R", "read"],
          ["X", "dismiss"],
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
    if (!enabled) {
      setDirectFocus(false);
      pendingPage.current = undefined;
      pendingFocus.current = undefined;
      pendingDirection.current = undefined;
    }
    const changedScope = previousScope.current !== scope;
    previousScope.current = scope;
    if (previousPageScope.current !== pageScope) {
      pendingPage.current = undefined;
      pendingDirection.current = undefined;
    }
    previousPageScope.current = pageScope;
    if (changedScope) pendingPage.current = undefined;
    if (enabled && pendingDirection.current) {
      const direction = pendingDirection.current;
      pendingDirection.current = undefined;
      moveDirection(direction);
      return;
    }
    if (enabled && pendingPage.current !== undefined && (pendingPage.current === "end" ? !hasMore : items.length > pendingPage.current)) {
      const target = pendingPage.current === "end" ? items.length - 1 : pendingPage.current;
      pendingPage.current = undefined;
      focusAt(target);
      return;
    }
    const found = visible.findIndex((item) => item.id === activeId);
    const nearest = visible.findIndex(item => items.findIndex(candidate => candidate.id === item.id) >= index.current);
    const nextIndex = changedScope
      ? 0
      : found >= 0
        ? found
      : nearest >= 0 ? nearest : visible.length - 1;
    const next = visible[nextIndex];
    if (
      pendingFocus.current &&
      !visible.some((item) => item.id === pendingFocus.current)
    )
      pendingFocus.current = undefined;
    index.current = next ? items.findIndex(item => item.id === next.id) : 0;
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
        reveal(element);
        pendingFocus.current = undefined;
      }
    }
  }, [signature, activeId, scope, enabled, hasMore, pageScope, spatial]);

  return {
    selectedId: selected?.id,
    active: enabled && directFocus,
    focusFirst,
    focusIndex: focusAt,
    onFocus: (item: T, element: HTMLElement) => {
      if (!element.contains(document.activeElement)) return;
      setActiveId(item.id);
      setHasSelection(true);
      setDirectFocus(document.activeElement === element);
      index.current = items.findIndex((candidate) => candidate.id === item.id);
      focusedRow.current = element;
    },
    onBlur: (element: HTMLElement, next: EventTarget | null) => {
      if (next instanceof Node && element.contains(next)) return;
      setDirectFocus(false);
      pendingPage.current = undefined;
      pendingFocus.current = undefined;
      pendingDirection.current = undefined;
    },
  };
}
