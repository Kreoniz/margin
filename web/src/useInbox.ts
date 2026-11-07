import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { InboxItem, InboxPage } from "./types";

export function useInbox(
  state: string,
  source: string,
  query: string,
  refresh: unknown,
  enabled: boolean,
) {
  const scope = JSON.stringify([state, source, query]);
  const [result, setResult] = useState<InboxPage & { scope: string }>({
    items: [],
    total: 0,
    scope: "",
  });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failure, setFailure] = useState<{ scope: string; message: string; more: boolean; all: boolean }>();
  const current = useRef(result);
  const controller = useRef<AbortController | null>(null);
  const desired = useRef(40);
  const previousScope = useRef(scope);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const load = useCallback(async (more = false, all = false) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setLoadingMore(more || all);
    const previous = current.current.scope === scope ? current.current : undefined;
    if (more) desired.current = (previous?.items.length || 0) + 40;
    const items: InboxItem[] = more ? [...(previous?.items || [])] : [];
    let cursor = more ? previous?.next_cursor : undefined;
    try {
      let page: InboxPage;
      do {
        const params = new URLSearchParams({ state, q: query });
        if (source !== "all") params.set("source", source);
        if (cursor) params.set("cursor", cursor);
        page = await api<InboxPage>("/inbox?" + params, {
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25_000)]),
        });
        items.push(...page.items);
        cursor = page.next_cursor;
      } while (cursor && (all || items.length < desired.current));
      if (abort.signal.aborted) return false;
      if (all) desired.current = Math.max(desired.current, items.length);
      const next = { items, total: page.total, next_cursor: cursor, scope };
      current.current = next;
      setResult(next);
      setFailure(undefined);
      return true;
    } catch (e) {
      if (!abort.signal.aborted)
        setFailure({ scope, message: e instanceof Error ? e.message : "Could not load discoveries.", more, all });
      return false;
    } finally {
      if (!abort.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [scope, state, source, query]);
  useEffect(() => {
    if (previousScope.current !== scope) desired.current = 40;
    previousScope.current = scope;
    if (!enabled) {
      controller.current?.abort();
      return;
    }
    const timer = setTimeout(() => void load(), query ? 200 : 0);
    return () => {
      clearTimeout(timer);
      controller.current?.abort();
    };
  }, [load, refresh, enabled]);
  const visible = result.scope === scope
    ? result
    : { items: [], total: 0, next_cursor: undefined };
  return {
    ...visible,
    loading: loading || (result.scope !== scope && failure?.scope !== scope),
    loadingMore,
    hasResult: result.scope === scope,
    error: failure?.scope === scope ? failure.message : "",
    acknowledge: (updated: InboxItem, before: InboxItem) => {
      // A write can finish after filters changed. Never reconcile its old
      // result into a different page; the current scope can refresh normally.
      const previous = current.current;
      if (activeScope.current !== scope || previous.scope !== scope) return;
      const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const matches = (item: InboxItem) => item.state === state &&
        (source === "all" || item.source_id === source) &&
        terms.every(term => [item.title, item.author, item.source_name, item.url, item.description].join(" ").toLowerCase().includes(term));
      const wasIncluded = matches(before);
      const isIncluded = matches(updated);
      const index = previous.items.findIndex(item => item.id === updated.id);
      if (index < 0 && wasIncluded === isIncluded) return;
      if (index < 0 && wasIncluded) return;
      const compare = (a: InboxItem, b: InboxItem) => Date.parse(b.published_at) - Date.parse(a.published_at) || (a.id === b.id ? 0 : a.id < b.id ? 1 : -1);
      const items = previous.items.filter(item => item.id !== updated.id);
      // Restore an acknowledged item only within the loaded prefix. The
      // keyset cursor stays valid even when its former anchor leaves a state.
      if (isIncluded && (index >= 0 || !previous.next_cursor || !items.length || compare(updated, items.at(-1)!) <= 0)) {
        items.push(updated);
        items.sort(compare);
      }
      controller.current?.abort();
      setLoading(false);
      setLoadingMore(false);
      const next = { ...previous, items, total: Math.max(0, previous.total + Number(isIncluded && index < 0) - Number(!isIncluded && index >= 0)) };
      current.current = next;
      setResult(next);
    },
    retry: async () => {
      if (failure?.scope !== scope) return;
      if (await load(failure.more, failure.all)) return current.current.items.length;
    },
    more: () => load(true),
    all: () => load(false, true),
  };
}
