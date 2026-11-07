import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";
import {
  formatForDisplay,
  getHotkeyManager,
  useHotkeys,
} from "@tanstack/react-hotkeys";
import { Theme } from "unlikely-ui/theme";
import { Button } from "unlikely-ui/button";
import { Checkbox } from "unlikely-ui/checkbox";
import { Input } from "unlikely-ui/input";
import { Toast } from "unlikely-ui/toast";
import { Popover } from "unlikely-ui/popover";
import { Collection } from "./Collection";
import { Access } from "./Access";
import { api, ApiError, send } from "./api";
import { EmptyState, ListSkeleton, MiniCover, Modal, Picker, TypeLabel } from "./components";
import { Editor, type EditorSnapshot } from "./Editor";
import { Icon, Logo } from "./Icon";
import { Settings } from "./Settings";
import { SourcesPanel } from "./SourcesPanel";
import {
  kinds,
  kindLabels,
  type Kind,
  type LibraryData,
  type Media,
  type UpNext,
  type InboxItem,
  type Session,
} from "./types";
import { discoveryEmptyState, hostname, imageURL, relativeDate, safeURL, selectMedia, selectUpNext, youtubeChannelName } from "./utils";
import { useListMotion } from "./useListMotion";
import { useListNavigation } from "./useListNavigation";
import { KeyboardHelp } from "./KeyboardHelp";
import { ActionHint, HintScope } from "./ActionHint";
import { useInbox } from "./useInbox";
import { FilterPicker, type LibraryFilter } from "./FilterPicker";
import { QuickFind } from "./QuickFind";

type LibraryLayout = "split" | "shelves" | "list";
const libraryViews = [
  { value: "split", label: "Mixed", icon: "columns", shortcut: "v then b" },
  { value: "shelves", label: "Shelves", icon: "grid", shortcut: "v then s" },
  { value: "list", label: "List", icon: "list", shortcut: "v then l" },
] as const;
const librarySections = [
  { id: "watch", label: "Watch", kinds: ["video", "movie", "anime"] },
  { id: "books", label: "Books & manga", kinds: ["book", "manga"] },
  { id: "games", label: "Games", kinds: ["game"] },
  { id: "reading", label: "Articles & papers", kinds: ["article", "paper", "other"] },
] as const;
const librarySection = (item: Media) => librarySections.find(section => (section.kinds as readonly Kind[]).includes(item.kind))!.id;

export default function App() {
  const [appearance, setAppearance] = useState<"light" | "dark">(() => {
    try {
      return localStorage.getItem("margin-theme") === "light"
        ? "light"
        : "dark";
    } catch {
      return "dark";
    }
  });
  const [session, setSession] = useState<Session>();
  const editorMemory = useRef<EditorSnapshot | undefined>(undefined);
  const [error, setError] = useState("");
  const shared =
    window.location.pathname === "/" ||
    window.location.pathname === "/shared" ||
    window.location.pathname.startsWith("/shared/");
  const refreshSession = useCallback(async () => {
    try {
      setSession(await api<Session>("/session"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    }
  }, []);
  useEffect(() => {
    if (shared) return;
    void refreshSession();
    const expired = () =>
      setSession({ authenticated: false, setup_required: false });
    window.addEventListener("margin-session-expired", expired);
    return () => window.removeEventListener("margin-session-expired", expired);
  }, [refreshSession, shared]);
  useEffect(() => {
    document.documentElement.dataset.appearance = appearance;
    try {
      localStorage.setItem("margin-theme", appearance);
    } catch {
      /* optional preference */
    }
  }, [appearance]);
  return (
    <Theme appearance={appearance} className="app-theme">
      <Toast.Provider timeout={3500}>
        {shared ? (
          <Collection />
        ) : session?.authenticated ? (
          <Owner
            editorMemory={editorMemory}
            appearance={appearance}
            toggleTheme={() =>
              setAppearance((a) => (a === "light" ? "dark" : "light"))
            }
            logout={async () => {
              await api("/logout", send("POST"));
              editorMemory.current = undefined;
              setSession({ authenticated: false, setup_required: false });
            }}
          />
        ) : session ? (
          <Access setup={session.setup_required} onAuthenticated={setSession} />
        ) : (
          <div className="initial-state">
            <Logo />
            {error ? (
              <>
                <p className="notice error" role="alert">
                  {error}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => void refreshSession()}
                >
                  Try again
                </Button>
              </>
            ) : (
              <p role="status">Opening your library…</p>
            )}
          </div>
        )}
        <Toast.Viewport />
      </Toast.Provider>
    </Theme>
  );
}

function Owner({
  editorMemory,
  appearance,
  toggleTheme,
  logout,
}: {
  editorMemory: RefObject<EditorSnapshot | undefined>;
  appearance: "light" | "dark";
  toggleTheme: () => void;
  logout: () => Promise<void>;
}) {
  const [data, setData] = useState<LibraryData>();
  const inboxCounts = useRef<LibraryData["inbox_counts"] | undefined>(undefined);
  inboxCounts.current = data?.inbox_counts;
  const [error, setError] = useState("");
  const [view, setView] = useState<"library" | "discover">(() =>
    window.location.hash === "#discover" ? "discover" : "library",
  );
  const [libraryLayout, setLibraryLayout] = useState<LibraryLayout>(() => {
    try {
      const stored = localStorage.getItem("margin-library-layout");
      return stored === "list" || stored === "split" || stored === "shelves" ? stored : stored === "gallery" ? "shelves" : "split";
    } catch { return "split"; }
  });
  useEffect(() => {
    try { localStorage.setItem("margin-library-layout", libraryLayout); }
    catch { /* The layout remains usable when browser storage is unavailable. */ }
  }, [libraryLayout]);
  const layout = libraryLayout;
  const [announcement, setAnnouncement] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const query = view !== "discover" ? libraryQuery : discoveryQuery;
  const setQuery = view !== "discover" ? setLibraryQuery : setDiscoveryQuery;
  const [kindFilters, setKindFilters] = useState<Kind[]>([]);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [channelFilters, setChannelFilters] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState<LibraryFilter>();
  const [status, setStatus] = useState(() => window.location.hash === "#next" ? "next" : "pending");
  const [queueOpen, setQueueOpen] = useState<string>();
  const [inboxState, setInboxState] = useState("new");
  const [source, setSource] = useState("all");
  const [libraryLimit, setLibraryLimit] = useState(40);
  const [discoveryLimit, setDiscoveryLimit] = useState(40);
  const limit = view !== "discover" ? libraryLimit : discoveryLimit;
  const setLimit = view !== "discover" ? setLibraryLimit : setDiscoveryLimit;
  const [editor, setEditor] = useState<Media | "new" | undefined>(() =>
    editorMemory.current ? editorMemory.current.item || "new" : undefined,
  );
  const [settings, setSettings] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [quickFindOpen, setQuickFindOpen] = useState(false);
  const [draftPending, setDraftPending] = useState(false);
  const [pendingEditor, setPendingEditor] = useState<Media | "new">();
  const [draftChoice, setDraftChoice] = useState<"resume" | "discard" | "cancel">();
  const [removeTarget, setRemoveTarget] = useState<Media>();
  const [removeClosing, setRemoveClosing] = useState(false);
  const [hideAutoAdded, setHideAutoAdded] = useState(() => {
    try { return localStorage.getItem("margin-hide-auto-added") === "on"; } catch { return false; }
  });
  const undo = useRef<(() => void) | undefined>(undefined);
  const [singleKeys, setSingleKeys] = useState(() => {
    try {
      return localStorage.getItem("margin-single-key-shortcuts") !== "off";
    } catch {
      return true;
    }
  });
  const [pending, setPending] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  const latestQueueVersion = useRef(-1);
  const queueCleanupGeneration = useRef(0);
  const activeMutations = useRef(new Set<string>());
  const toast = Toast.useToastManager();
  const refresh = useCallback(async () => {
    const id = ++version.current;
    try {
      const response = await api<LibraryData>("/bootstrap");
      if (version.current === id && (response.up_next?.version ?? 0) >= latestQueueVersion.current) {
        latestQueueVersion.current = response.up_next?.version ?? 0;
        setData(response);
        setError("");
      }
    } catch (e) {
      if (version.current === id)
        setError(e instanceof Error ? e.message : "Could not load your list.");
    }
  }, []);
  const hasPendingMetadata = Boolean(
    data?.media.some((item) => item.metadata_state === "pending"),
  );
  useEffect(() => {
    void refresh();
    const focus = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener("focus", focus);
    const timer = setInterval(
      focus,
      hasPendingMetadata
        ? 2_000
        : view === "discover" || sourcesOpen
          ? 30_000
          : 90_000,
    );
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [refresh, view, sourcesOpen, hasPendingMetadata]);
  useEffect(() => {
    const change = () => {
      setView(window.location.hash === "#discover" ? "discover" : "library");
      if (window.location.hash === "#next") setStatus("next");
      else if (window.location.hash === "#library") setStatus(current => current === "next" ? "pending" : current);
      else if (window.location.hash !== "#discover") setStatus("pending");
      setQueueOpen(undefined);
      setFilterOpen(undefined);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => { setLibraryLimit(40); pendingShowMore.current = undefined; }, [libraryQuery, kindFilters, tagFilters, channelFilters, status, hideAutoAdded]);
  useEffect(() => { setDiscoveryLimit(40); pendingShowMore.current = undefined; }, [discoveryQuery, inboxState, source]);
  useEffect(() => {
    document.title =
      (view === "library" ? "Library" : "Discover") + " — Margin";
  }, [view]);
  const shortcutsEnabled = !editor && !settings && !sourcesOpen && !helpOpen && !removeTarget && !filterOpen && !queueOpen && !quickFindOpen && !pendingEditor;
  useHotkeys(
    [
      {
        hotkey: "Mod+K",
        callback: openQuickFind,
        options: { ignoreInputs: false },
      },
      {
        hotkey: "Mod+Shift+A",
        callback: () => openEditor("new"),
        options: { ignoreInputs: false },
      },
      {
        hotkey: "/",
        callback: () => searchRef.current?.focus(),
        options: { enabled: shortcutsEnabled && singleKeys },
      },
      {
        hotkey: "N",
        callback: () => openEditor("new"),
        options: { enabled: shortcutsEnabled && singleKeys },
      },
      { hotkey: "A", callback: () => openEditor("new"), options: { enabled: shortcutsEnabled && singleKeys } },
      { hotkey: "U", callback: () => undo.current?.(), options: { enabled: shortcutsEnabled && singleKeys } },
      { hotkey: ["G", "N"], callback: () => navigate("next"), options: { enabled: shortcutsEnabled && singleKeys } },
      {
        hotkey: ["G", "L"],
        callback: () => navigate("library"),
        options: { enabled: shortcutsEnabled && singleKeys },
      },
      {
        hotkey: ["G", "D"],
        callback: () => navigate("discover"),
        options: { enabled: shortcutsEnabled && singleKeys },
      },
      {
        hotkey: ["G", "M"],
        callback: () => void toggleDemoData(),
        options: {
          enabled: shortcutsEnabled && singleKeys && Boolean(data?.dev_mode),
        },
      },
      { hotkey: ["V", "L"], callback: () => { getHotkeyManager().resetSequenceProgress(); setLibraryLayout("list"); }, options: { enabled: shortcutsEnabled && singleKeys && view === "library" } },
      { hotkey: ["V", "B"], callback: () => { getHotkeyManager().resetSequenceProgress(); setLibraryLayout("split"); }, options: { enabled: shortcutsEnabled && singleKeys && view === "library" } },
      ...(["S", "G"] as const).map(key => ({ hotkey: ["V", key] as const, callback: () => { getHotkeyManager().resetSequenceProgress(); setLibraryLayout("shelves"); }, options: { enabled: shortcutsEnabled && singleKeys && view === "library" } })),
      ...([ ["T", "types"], ["G", "tags"], ["C", "channels"] ] as const).map(([key, id]) => ({ hotkey: ["F", key] as const, callback: () => { getHotkeyManager().resetSequenceProgress(); const trigger = document.getElementById("library-filter-" + id); if (trigger) { trigger.focus({ preventScroll: true }); setFilterOpen(id); } }, options: { enabled: shortcutsEnabled && singleKeys && view !== "discover" } })),
      { hotkey: "Mod+,", callback: () => setSettings(true) },
      { hotkey: "Control+Home", callback: () => navigation.focusFirst(), options: { ignoreInputs: true } },
      {
        hotkey: ["G", "S"],
        callback: () => setSourcesOpen(true),
        options: { enabled: shortcutsEnabled && singleKeys },
      },
      {
        hotkey: ["G", "G"],
        callback: () => {
          // The second G must not remain a fresh prefix for G L / G D / G S.
          getHotkeyManager().resetSequenceProgress();
          navigation.focusFirst();
        },
        options: { enabled: shortcutsEnabled && singleKeys },
      },
      {
        hotkey: "F1",
        callback: () => setHelpOpen(true),
        options: { ignoreInputs: false },
      },
      {
        hotkey: "?",
        callback: () => setHelpOpen(true),
        options: { enabled: shortcutsEnabled && singleKeys },
      },
      {
        hotkey: "Mod+Z",
        callback: () => undo.current?.(),
        options: { ignoreInputs: true },
      },
      {
        hotkey: "Shift+R",
        callback: () => void checkSources(),
        options: { enabled: shortcutsEnabled && singleKeys },
      },
      {
        hotkey: "[",
        callback: () => cycleStatus(-1),
        options: { enabled: shortcutsEnabled && singleKeys },
      },
      {
        hotkey: "]",
        callback: () => cycleStatus(1),
        options: { enabled: shortcutsEnabled && singleKeys },
      },
      {
        hotkey: "Shift+H",
        callback: () => {
          if (view !== "library") navigate("library");
        },
        options: { enabled: shortcutsEnabled && singleKeys },
      },
      {
        hotkey: "Shift+L",
        callback: () => {
          if (view !== "discover") navigate("discover");
        },
        options: { enabled: shortcutsEnabled && singleKeys },
      },
    ],
    { enabled: shortcutsEnabled, requireReset: true },
  );
  const media = data?.media || [];
  const library = hideAutoAdded ? media.filter(item => !item.auto_added) : media;
  const inboxPage = useInbox(inboxState, source, discoveryQuery, data, view === "discover" && Boolean(data));
  const inbox = inboxPage.items;
  const sources = data?.sources || [];
  const discoveryEmpty = discoveryEmptyState(sources, inboxState);
  const queue = data?.up_next || { version: 0, ids: [] };
  const queueSubset = status === "review" || (hideAutoAdded && status !== "next");
  const queueFiltered = queueSubset || Boolean(libraryQuery.trim() || kindFilters.length || tagFilters.length || channelFilters.length);
  const filtered = useMemo(
    () =>
      status === "next" ? selectUpNext(media, queue.ids, { query: libraryQuery, status: "pending", kinds: kindFilters, tags: tagFilters, channels: channelFilters }) : selectMedia(
        status === "review" ? library.filter((item) => item.needs_review) : library,
        { query: libraryQuery, status: status === "review" ? "all" : status, kinds: kindFilters, tags: tagFilters, channels: channelFilters },
      ),
    [media, queue.ids, view, libraryQuery, status, kindFilters, tagFilters, channelFilters, hideAutoAdded],
  );
  useEffect(() => {
    if (!data || !window.location.hash.startsWith("#edit=")) return;
    const item = data.media.find((m) => m.id === window.location.hash.slice(6));
    if (item) {
      openEditor(item);
      window.history.replaceState(null, "", "/dashboard#" + view);
    }
  }, [data]);
  const tags = [...new Set(media.flatMap((item) => item.tags))].sort((a, b) =>
    a.localeCompare(b),
  );
  const channels = [...new Map(media.flatMap(item => {
    const name = youtubeChannelName(item);
    return name ? [[name.toLocaleLowerCase(), { value: name.toLocaleLowerCase(), label: name }] as const] : [];
  })).values()].sort((a, b) => a.label.localeCompare(b.label));
  useEffect(() => {
    if (filterOpen === "channels" && !channels.length && !channelFilters.length) {
      setFilterOpen(undefined);
      searchRef.current?.focus({ preventScroll: true });
    }
  }, [filterOpen, channels.length, channelFilters.length]);
  const articles = inbox;
  const sections = librarySections.map(section => ({ ...section, items: filtered.filter(item => librarySection(item) === section.id) }));
  const orderedLibrary = layout === "list" ? filtered : sections.flatMap(section => section.items);
  const visibleLibrary = layout === "list" ? filtered.slice(0, limit) : sections.flatMap(section => section.items.slice(0, limit));
  const navigationItems = view !== "discover" ? orderedLibrary : articles;
  const visibleItems = view !== "discover" ? visibleLibrary : articles.slice(0, limit);
  const hasMoreLibrary = layout === "list" ? filtered.length > limit : sections.some(section => section.items.length > limit);
  const listRef = useListMotion(
    visibleItems.map((item) => item.id).join("|"),
    layout,
    JSON.stringify(visibleItems.map(item => [
      item.title, item.author || hostname(item.url), Boolean(imageURL(item.cover_url)),
      "kind" in item
        ? [item.kind, item.tags.slice(0, 2), item.visibility, item.needs_review, item.metadata_state, item.status,
            layout !== "list"]
        : [item.source_name, item.description, item.state, relativeDate(item.published_at || item.discovered_at)],
    ])),
  );
  const navigation = useListNavigation({
    items: navigationItems,
    visibleItems,
    spatial: view !== "discover" && layout !== "list",
    group: item => view !== "discover" && layout !== "list" && "kind" in item ? librarySection(item) : "all",
    onReveal: item => {
      const items = view !== "discover" && layout !== "list" && "kind" in item ? sections.find(section => section.id === librarySection(item))!.items : navigationItems;
      const position = items.findIndex(candidate => candidate.id === item.id);
      setLimit(n => Math.max(n, Math.ceil((position + 1) / 40) * 40));
    },
    root: listRef,
    limit,
    onLimit: setLimit,
    hasMore: view === "discover" && Boolean(inboxPage.next_cursor),
    onMore: async () => { if (await inboxPage.more()) setLimit(n => n + 40); },
    onEnd: async () => { if (await inboxPage.all()) setLimit(Number.MAX_SAFE_INTEGER); },
    scope: view + ":" + (view !== "discover" ? status : inboxState),
    pageScope: JSON.stringify([view, status, inboxState, query, source, kindFilters, tagFilters, channelFilters, hideAutoAdded]),
    enabled: shortcutsEnabled,
    singleKeys,
    actions: {
      open: (item) => {
        const link = safeURL(item.url);
        if (link) window.open(link, "_blank", "noopener,noreferrer");
        else if ("kind" in item) openEditor(item);
        if ("state" in item && item.state === "new")
          void setArticleState(item.id, "read");
      },
      ...(view !== "discover"
        ? {
            done: (item: (typeof media)[number] | (typeof inbox)[number]) => {
              if ("kind" in item) void toggle(item);
            },
            edit: (item: (typeof media)[number] | (typeof inbox)[number]) => {
              if ("kind" in item) openEditor(item);
            },
            remove: (item: (typeof media)[number] | (typeof inbox)[number]) => {
              if ("kind" in item) setRemoveTarget(item);
            },
          }
        : {
            save: (item: (typeof media)[number] | (typeof inbox)[number]) => {
              if ("state" in item && item.state !== "saved")
                void saveArticle(item.id);
            },
            read: (item: (typeof media)[number] | (typeof inbox)[number]) => {
              if ("state" in item && item.state !== "saved")
                void setArticleState(
                  item.id,
                  item.state === "read" ? "new" : "read",
                );
            },
            dismiss: (
              item: (typeof media)[number] | (typeof inbox)[number],
            ) => {
              if (
                "state" in item &&
                !["saved", "dismissed"].includes(item.state)
              )
                void setArticleState(item.id, "dismissed");
            },
          }),
    },
  });
  const pendingShowMore = useRef<number | undefined>(undefined);
  async function retryInbox(event: MouseEvent<HTMLButtonElement>) {
    const keyboard = event.detail === 0;
    const previousLength = articles.length;
    if (keyboard) pendingShowMore.current = previousLength;
    const loaded = await inboxPage.retry();
    if (loaded !== undefined) {
      setLimit(n => Math.max(n, loaded));
      if (keyboard && loaded <= previousLength) {
        pendingShowMore.current = undefined;
        if (loaded) navigation.focusFirst();
        else document.getElementById("content")?.focus({ preventScroll: true });
      }
    } else if (keyboard) pendingShowMore.current = undefined;
  }
  useLayoutEffect(() => {
    const index = pendingShowMore.current;
    if (index !== undefined && navigationItems[index] && visibleItems.some(item => item.id === navigationItems[index].id)) {
      pendingShowMore.current = undefined;
      navigation.focusIndex(index);
    }
  }, [limit, filtered.length, articles.length, view, layout]);
  function acknowledgeQueue(updated: UpNext, cleanupGeneration: number) {
    // A media acknowledgement can remove membership without supplying the new
    // queue version. Neither an older queue reply nor bootstrap may undo it.
    if (cleanupGeneration !== queueCleanupGeneration.current || updated.version < latestQueueVersion.current) return false;
    latestQueueVersion.current = updated.version;
    version.current++;
    setData(current => current ? { ...current, up_next: updated } : current);
    return true;
  }
  async function perform(
    key: string,
    fn: () => Promise<unknown>,
    message?: string,
  ) {
    if (activeMutations.current.has(key)) return false;
    activeMutations.current.add(key);
    setPending(new Set(activeMutations.current));
    const cleanupGeneration = queueCleanupGeneration.current;
    try {
      await fn();
      await refresh();
      if (message) toast.add({ title: message, type: "success" });
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "up_next_conflict") {
        if (e.upNext) acknowledgeQueue(e.upNext, cleanupGeneration);
        await refresh();
      }
      setAnnouncement(e instanceof Error ? e.message : "Please try again.");
      toast.add({
        title: e instanceof Error ? e.message : "Please try again.",
        type: "danger",
      });
      return false;
    } finally {
      activeMutations.current.delete(key);
      setPending(new Set(activeMutations.current));
    }
  }
  function navigate(next: "next" | "library" | "discover") {
    setView(next === "discover" ? "discover" : "library");
    if (next === "next") setStatus("next");
    else if (next === "library") setStatus(current => current === "next" ? "pending" : current);
    setQueueOpen(undefined);
    window.location.hash = next;
    setFilterOpen(undefined);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function changeStatus(next: string) {
    setStatus(next);
    // Up next remains a Library filter; keep the old deep link reloadable.
    window.history.replaceState(null, "", next === "next" ? "#next" : "#library");
    setQueueOpen(undefined);
  }
  function openQuickFind() {
    if (document.activeElement === document.body || document.activeElement === document.documentElement)
      document.querySelector<HTMLElement>('[aria-label="Quick Find"]')?.focus({ preventScroll: true });
    setQuickFindOpen(true);
  }
  function discardDraft() {
    editorMemory.current = undefined;
    setDraftPending(false);
  }
  function resumeDraft() {
    if (!editorMemory.current) return;
    setDraftPending(false);
    setEditor(editorMemory.current.item || "new");
  }
  function openEditor(item: Media | "new") {
    if (editorMemory.current?.recoverable) {
      // Keep the single retained draft until the owner explicitly chooses what
      // to do with it. An unrelated item's editor must never inherit it.
      setDraftChoice(undefined);
      setPendingEditor(item);
      return;
    }
    discardDraft();
    setEditor(item);
  }
  function cycleStatus(direction: number) {
    const values =
      view !== "discover"
        ? ["pending", "done", "next", "review", "all"]
        : ["new", "saved", "read", "dismissed"];
    const current = values.indexOf(view !== "discover" ? status : inboxState);
    const next = values[(current + direction + values.length) % values.length];
    if (view !== "discover") changeStatus(next);
    else setInboxState(next);
  }
  function acknowledgeMedia(item: Media) {
    version.current++;
    if (item.status === "done") queueCleanupGeneration.current++;
    setData(current => current ? { ...current, media: current.media.some(existing => existing.id === item.id)
      ? current.media.map(existing => existing.id === item.id ? item : existing)
      : [item, ...current.media], up_next: item.status === "done" && current.up_next
        ? { ...current.up_next, ids: current.up_next.ids.filter(id => id !== item.id) }
        : current.up_next } : current);
  }
  async function patchMedia(id: string, changes: Partial<Media>, expected?: Media) {
    const item = await api<Media>("/media/" + id, send("PATCH", { ...changes, expected }));
    acknowledgeMedia(item);
    if (item.status === "done") {
      setAnnouncement("Marked done and removed from Up next. Undo returns to unfinished without restoring its place.");
    }
    return item;
  }
  async function removeMedia(id: string) {
    await api("/media/" + id, send("DELETE"));
    version.current++;
    queueCleanupGeneration.current++;
    undo.current = undefined;
    setData(current => current ? { ...current, media: current.media.filter(item => item.id !== id), up_next: current.up_next ? { ...current.up_next, ids: current.up_next.ids.filter(member => member !== id) } : undefined } : current);
  }
  function mediaFocus() {
    return document.querySelector<HTMLElement>('.media-row[tabindex="0"]') || document.getElementById("content");
  }
  function acknowledgeInbox(item: InboxItem, before: InboxItem, countsBefore: LibraryData["inbox_counts"] | undefined) {
    inboxPage.acknowledge(item, before);
    // A newer bootstrap may already include the server commit. Apply a count
    // delta only to the snapshot from before this write; otherwise keep it.
    if (item.state !== before.state) setData(current => current ? { ...current, inbox_counts: current.inbox_counts === countsBefore ? {
      ...current.inbox_counts,
      [before.state]: Math.max(0, (current.inbox_counts[before.state] || 0) - 1),
      [item.state]: (current.inbox_counts[item.state] || 0) + 1,
    } : current.inbox_counts } : current);
  }
  async function patchInbox(before: InboxItem, state: InboxItem["state"]) {
    const countsBefore = inboxCounts.current;
    const item = await api<InboxItem>("/inbox/" + before.id, send("PATCH", { state }));
    acknowledgeInbox(item, before, countsBefore);
    return item;
  }
  function setUndo(run: () => Promise<boolean>) {
    const action = () => {
      // Old toast buttons must not replay an undo invalidated by deletion or
      // replaced by a later action. Failed writes can still be retried.
      if (undo.current !== action) return;
      void run().then(success => {
        if (success && undo.current === action) undo.current = undefined;
      });
    };
    undo.current = action;
    return action;
  }
  async function toggle(item: Media) {
    const next = item.status === "done" ? "pending" : "done";
    if (
      await perform(item.id, () => patchMedia(item.id, { status: next }, item))
    ) {
      const undoAction = setUndo(() => perform(item.id, () => patchMedia(item.id, { status: item.status }, { ...item, status: next })));
      toast.add({
        title: next === "done" ? "Marked done. Undo returns to unfinished without restoring Up next." : "Returned to unfinished. Add to Up next when ready.",
        actionProps: {
          children: "Undo",
          onClick: undoAction,
        },
      });
    }
  }
  async function saveArticle(id: string) {
    const before = inbox.find(item => item.id === id);
    if (!before) return;
    const countsBefore = inboxCounts.current;
    let savedItem: Media | undefined;
    if (
      await perform(
        id,
        async () => {
          const saved = await api<Media>("/inbox/" + id + "/save", send("POST"));
          savedItem = saved;
          acknowledgeMedia(saved);
          acknowledgeInbox({ ...before, state: "saved" }, before, countsBefore);
        },
      )
    ) {
      undo.current = undefined;
      if (savedItem) {
        const saved = savedItem;
        toast.add({ title: "Saved to library.", type: "success", actionProps: { children: "Edit item", onClick: () => openEditor(saved) } });
      }
    }
  }
  async function setArticleState(
    id: string,
    next: "new" | "read" | "dismissed",
  ) {
    const before = inbox.find((item) => item.id === id);
    if (!before || before.state === next) return;
    let acknowledged = before;
    if (
      await perform(id, async () => { acknowledged = await patchInbox(before, next); })
    ) {
      const undoAction = setUndo(() => perform(id, () => patchInbox(acknowledged, before.state)));
      toast.add({
        title:
          next === "dismissed"
            ? "Dismissed."
            : next === "read"
              ? "Marked read."
              : "Marked new.",
        actionProps: { children: "Undo", onClick: undoAction },
      });
    }
  }
  async function markReviewed(item: Media) {
    if (!item.needs_review) return;
    if (
      await perform(item.id, () => patchMedia(item.id, { needs_review: false }))
    ) {
      const undoAction = setUndo(() => perform(item.id, () => patchMedia(item.id, { needs_review: true })));
      toast.add({
        title: "Marked reviewed.",
        actionProps: { children: "Undo", onClick: undoAction },
      });
    }
  }
  async function toggleDemoData() {
    if (!data?.dev_mode) return;
    const remove = Boolean(data.dev_fixture_count);
    if (
      await perform(
        "demo-data",
        () => api("/dev/fixtures", send(remove ? "DELETE" : "POST")),
        remove
          ? "Demo data cleared."
          : "Demo data loaded · all nine media types.",
      )
    ) {
      if (!remove) {
        navigate("library");
        setStatus("all");
        setTagFilters(["demo"]);
      } else setTagFilters([]);
    }
  }
  async function checkSources() {
    await perform(
      "sync",
      () => api("/sync", send("POST")),
      "Checking your sources. New articles appear automatically.",
    );
  }
  async function changeQueue(item: Media, action: "add" | "remove" | "up" | "down") {
    // Move focus to the stable row before a button disappears or hits a boundary.
    const row = document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(item.id)}"]`);
    if (row?.contains(document.activeElement) || document.activeElement?.closest(".priority-panel")) row?.focus({ preventScroll: true });
    setQueueOpen(undefined);
    const cleanupGeneration = queueCleanupGeneration.current;
    await perform("up-next", async () => {
      const updated = await api<UpNext>("/up-next", send("POST", { id: item.id, action, expected_version: queue.version }));
      if (!acknowledgeQueue(updated, cleanupGeneration)) return;
      const position = updated.ids.indexOf(item.id) + 1;
      setAnnouncement(action === "remove" ? `${item.title} removed from Up next. Kept in your library.` : `${item.title} ${action === "add" ? "added to Up next" : "moved"}. Position ${position} of ${updated.ids.length}.`);
    });
  }
  function clearQueueFilters() {
    setLibraryQuery(""); setKindFilters([]); setTagFilters([]); setChannelFilters([]); setFilterOpen(undefined);
    searchRef.current?.focus({ preventScroll: true });
  }
  function renderLibraryItem(item: Media) {
    const compactReview = layout !== "list";
    const rank = queue.ids.indexOf(item.id) + 1;
    const reading = compactReview && ["article", "paper", "other"].includes(item.kind);
    const tags = (
      item.tags.length > 0 && <div className="item-tags">
        {item.tags.slice(0, 2).map((t) => (
          <ActionHint label={"Show items tagged " + t} key={t}>
            <button
              className="inline-tag"
              type="button"
              aria-pressed={tagFilters.includes(t)}
              onClick={() => setTagFilters(values => values.includes(t) ? values.filter(value => value !== t) : [...values, t])}
            >
              {t}
            </button>
          </ActionHint>
        ))}
      </div>
    );
    const controls = (
      <div className="row-controls">

          <ActionHint
            label={item.status === "done" ? "Move to read/watch" : "Mark done"}
            shortcut={singleKeys ? "Space" : undefined}
            context={singleKeys ? "With this row focused" : undefined}
          >
            <Checkbox
              checked={item.status === "done"}
              disabled={pending.has(item.id)}
              aria-label={(item.status === "done" ? "Mark to read/watch: " : "Mark done: ") + item.title}
              onCheckedChange={() => void toggle(item)}
            >
              <span className="gallery-completion-label" aria-hidden="true">{item.status === "done" ? "Done" : "Mark done"}</span>
            </Checkbox>
          </ActionHint>
        <div className="row-actions">
        {compactReview && item.needs_review && renderReviewButton(item, true)}
        <ActionHint
          label="Edit item"
          shortcut={singleKeys ? "e" : undefined}
          context={singleKeys ? "With this row focused" : undefined}
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label={"Edit " + item.title}
            onClick={() => openEditor(item)}
          >
            <Icon name="edit" size={16} />
          </Button>
        </ActionHint>
        {item.status === "pending" ? <Popover.Root open={queueOpen === item.id} onOpenChange={open => setQueueOpen(open ? item.id : undefined)}>
          <Popover.Trigger render={<Button variant="ghost" size="icon" className="priority-trigger" data-queued={Boolean(rank) || undefined} aria-label={"Up next" + (rank ? ", position " + rank : "") + ": " + item.title} title="Up next actions" />}>
            {rank ? <span className="priority-rank-label" aria-hidden="true">#{rank}<Icon name="chevron" size={10} /></span> : <span className="priority-add-label" aria-hidden="true"><Icon name="plus" size={10} />Next</span>}
          </Popover.Trigger>
          <Popover.Content className="priority-panel" finalFocus={() => {
            // Actions move focus to the stable row before closing; outside
            // clicks keep their focus. Escape/Close restores the trigger.
            const active = document.activeElement;
            return active === document.body || active?.closest(".priority-panel") ? document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(item.id)}"] .priority-trigger`) : false;
          }} positionerProps={{ align: "end" }}>
            <div className="priority-panel-heading"><Popover.Title>Up next</Popover.Title><Popover.Close render={<Button variant="ghost" size="icon" aria-label="Close Up next actions" />}><Icon name="close" size={16} /></Popover.Close></div>
            <Popover.Description>{rank ? `Position ${rank} of ${queue.ids.length} across your library. Moves swap with the previous or next item, across all types.` : "Choose this item to read, watch, or play next."}</Popover.Description>
            {rank ? <>
              {queueFiltered && <p className="quiet">{queueSubset ? <>Open Up next with search and filters cleared to reorder. <button type="button" className="text-link" onClick={() => { clearQueueFilters(); navigate("next"); }}>Show Up next</button></> : "Clear search and filters to reorder."}</p>}
              <Button variant="ghost" disabled={queueFiltered || pending.has("up-next") || rank === 1} onClick={() => void changeQueue(item, "up")}>Move earlier</Button>
              <Button variant="ghost" disabled={queueFiltered || pending.has("up-next") || rank === queue.ids.length} onClick={() => void changeQueue(item, "down")}>Move later</Button>
              <Button variant="ghost" disabled={pending.has("up-next")} onClick={() => void changeQueue(item, "remove")}>Remove from Up next</Button>
            </> : <Button variant="secondary" disabled={pending.has("up-next")} onClick={() => void changeQueue(item, "add")}>Add to Up next</Button>}
            <Button variant="ghost" className="priority-delete" onClick={() => { setQueueOpen(undefined); document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(item.id)}"]`)?.focus({ preventScroll: true }); setRemoveTarget(item); }}>Remove from library…</Button>
          </Popover.Content>
        </Popover.Root> : <ActionHint label="Remove from library" shortcut={singleKeys ? "d d" : undefined} context="Asks before removing">
          <Button variant="ghost" size="icon" aria-label={"Remove " + item.title} onClick={() => setRemoveTarget(item)}><Icon name="trash" size={16} /></Button>
        </ActionHint>}

        </div>
        </div>
    );
    return (
      <article
        className={
          "media-row scroll-mt-20 " +
          (item.status === "done" ? "item-done" : "")
        }
        key={item.id}
        data-motion-key={item.id}
        data-row-id={item.id}
        data-keyboard-active={
          (navigation.active && navigation.selectedId === item.id) ||
          undefined
        }
        tabIndex={navigation.selectedId === item.id ? 0 : -1}
        onFocusCapture={(event) =>
          navigation.onFocus(item, event.currentTarget)
        }
        onBlurCapture={event => navigation.onBlur(event.currentTarget, event.relatedTarget)}
        aria-label={item.title}
        data-textual={item.kind === "article" || item.kind === "paper" || item.kind === "other" || undefined}
        data-art-absent={!imageURL(item.cover_url) && item.metadata_state !== "pending" || undefined}
      >
        <div className="library-art">
          <MiniCover kind={item.kind} url={item.cover_url} publisherURL={item.kind === "article" ? item.url : undefined} naturalArtwork={item.kind !== "article" && item.kind !== "paper" && item.kind !== "other"} />
          <span className="gallery-art-fallback" data-unavailable={item.metadata_state !== "pending" && Boolean(imageURL(item.cover_url)) || undefined} aria-hidden={item.metadata_state === "pending" || undefined}>{item.metadata_state === "pending" ? "Finding preview…" : imageURL(item.cover_url) ? "Preview unavailable" : "No preview"}</span>
        </div>
        <div className="row-content">
          {safeURL(item.url) ? (
            <a
              className="item-title row-primary-action"
              href={safeURL(item.url)}
              target="_blank"
              rel="noreferrer"
            >
              {item.title}
            </a>
          ) : (
            <button
              className="item-title row-primary-action"
              onClick={() => openEditor(item)}
            >
              {item.title}
            </button>
          )}
          <div className="item-meta">
            <TypeLabel kind={item.kind} />
            {(item.author || hostname(item.url)) && (youtubeChannelName(item) ? <button type="button" className="item-creator channel-filter-link" aria-label={"Filter channel " + item.author} aria-pressed={channelFilters.includes(item.author.trim().toLocaleLowerCase())} onClick={() => setChannelFilters(values => values.includes(item.author.trim().toLocaleLowerCase()) ? values.filter(value => value !== item.author.trim().toLocaleLowerCase()) : [...values, item.author.trim().toLocaleLowerCase()])}>{item.author}</button> : <span className="item-creator">{item.author || hostname(item.url)}</span>)}
            {item.visibility === "public" && (
              <span className="public-marker" role="img" aria-label="Public item">
                <Icon name="globe" size={13} /> Public
              </span>
            )}
            {rank > 0 && <span className="priority-membership">Up next · #{rank}</span>}
          </div>
          {(item.kind === "article" || item.kind === "paper" || item.kind === "other") && item.description.trim() && (
            <p className="gallery-description">{item.description}</p>
          )}
          {!reading && tags}
          {item.metadata_state === "pending" && (
            <p
              className="mt-1 text-[11px] text-u-muted"
              role="status"
            >
              Finding details…
            </p>
          )}
          {item.metadata_state === "partial" && (
            <ActionHint
              label="Edit missing details"
              context="Retry metadata or fill in details in the editor."
            >
              <button
                className="metadata-warning"
                aria-label={"Edit missing details: " + item.title}
                onClick={() => openEditor(item)}
              >
                Missing details · Edit
              </button>
            </ActionHint>
          )}
        {item.needs_review && (
          <div className="item-review">
          <span>Needs attention</span>
          {!compactReview && renderReviewButton(item)}
          </div>
        )}
        </div>
        {reading ? <div className="reading-footer">{tags}{controls}</div> : controls}
      </article>
    );
  }
  function renderReviewButton(item: Media, compact = false) {
    return (
      <ActionHint
        label="Mark reviewed"
        context="Clear Needs attention without marking it done."
      >
        <Button
          className="review-button"
          variant={compact ? "ghost" : "secondary"}
          {...(compact
            ? { size: "icon" as const, "aria-label": "Mark reviewed: " + item.title }
            : { size: "sm" as const, "aria-label": "Mark reviewed: " + item.title })}
          disabled={pending.has(item.id)}
          onClick={event => {
            // Move off the control before a successful acknowledgement
            // removes it. Later responses never steal focus back.
            if (event.detail === 0 && document.activeElement === event.currentTarget)
              event.currentTarget.closest<HTMLElement>(".media-row")?.focus({ preventScroll: true });
            void markReviewed(item);
          }}
        >
          {compact ? <Icon name="check" size={16} /> : "Mark reviewed"}
        </Button>
      </ActionHint>
    );
  }
  function renderLibrarySection(section: typeof sections[number]) {
    return <section key={section.id} className={"library-section library-" + section.id} aria-labelledby={"library-heading-" + section.id}>
      <div className="library-section-heading"><h2 id={"library-heading-" + section.id}>{section.label}</h2><span>{Math.min(limit, section.items.length) < section.items.length ? `${Math.min(limit, section.items.length)} of ${section.items.length}` : section.items.length}</span></div>
      <div className={section.id === "reading" ? "library-reading-list" : "library-gallery"} data-library-section={section.id}>
        {section.items.slice(0, limit).map(renderLibraryItem)}
      </div>
    </section>;
  }
  const content = (
    <div className="owner-shell">
      <a
        className="skip-link"
        href="#content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("content")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="app-header">
        <div className="header-inner">
          <button
            className="brand-button"
            aria-label="Margin library"
            onClick={() => { setStatus("pending"); navigate("library"); }}
          >
            <Logo small />
          </button>
          <nav className="main-nav" aria-label="Main navigation">
            <ActionHint
              label="Library"
              shortcut={singleKeys ? "g then l" : undefined}
              context={singleKeys ? "Shift+h opens Library" : undefined}
            >
              <button
                aria-current={view === "library" ? "page" : undefined}
                onClick={() => navigate("library")}
              >
                <Icon name="book" size={16} />
                Library
              </button>
            </ActionHint>
            <ActionHint
              label="Discover"
              shortcut={singleKeys ? "g then d" : undefined}
              context={singleKeys ? "Shift+l opens Discover" : undefined}
            >
              <button
                aria-current={view === "discover" ? "page" : undefined}
                onClick={() => navigate("discover")}
              >
                <Icon name="inbox" size={16} />
                Discover
                {Boolean(data?.inbox_counts?.new) && (
                  <span
                    className="new-dot"
                    role="img"
                    aria-label="New discoveries"
                  />
                )}
              </button>
            </ActionHint>
            <ActionHint
              label="Manage sources"
              shortcut={singleKeys ? "g then s" : undefined}
            >
              <button
                onClick={() => setSourcesOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={sourcesOpen}
              >
                <Icon name="rss" size={16} />
                Sources
              </button>
            </ActionHint>
          </nav>
          <div className="header-actions">
            <ActionHint
              label="Add item"
              shortcut={formatForDisplay("Mod+Shift+A")}
            >
              <Button
                onClick={() => openEditor("new")}
                size="sm"
                aria-keyshortcuts="Control+Shift+A Meta+Shift+A"
                aria-label="Add item"
              >
                <Icon name="plus" size={16} />
                <span>Add item</span>
              </Button>
            </ActionHint>
            <ActionHint label="Settings" shortcut={formatForDisplay("Mod+,")}>
              <Button
                variant="secondary"
                size="icon"
                aria-label="Settings"
                aria-haspopup="dialog"
                aria-expanded={settings}
                onClick={() => setSettings(true)}
              >
                <Icon name="settings" size={18} />
              </Button>
            </ActionHint>
          </div>
        </div>
      </header>
      <main id="content" className={"content" + (view !== "discover" && media.length ? " library-populated" : "")} data-library-layout={view !== "discover" ? layout : undefined} tabIndex={-1}>
        {draftPending && !editor && <div className="notice flex flex-wrap items-center gap-2" role="region" aria-label="Unfinished draft">
          <span className="mr-auto">Unfinished draft{editorMemory.current?.item ? ": " + editorMemory.current.item.title : ""}</span>
          <Button variant="secondary" size="sm" onClick={resumeDraft}>Resume draft</Button>
          <Button variant="ghost" size="sm" onClick={() => { discardDraft(); mediaFocus()?.focus({ preventScroll: true }); }}>Discard draft</Button>
        </div>}
        {error && (
          <div className="notice error connection-notice" role="alert">
            <span>{error}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refresh()}
            >
              Try again
            </Button>
          </div>
        )}
        <div className={"page-heading" + (view !== "discover" && media.length ? " library-heading-populated" : "")} key={view}>
          <div>
            <h1>
              {view === "library" ? "Your library" : "Discover"}
              <span>.</span>
            </h1>
            {!(view !== "discover" && media.length) && <p>
              {view === "library"
                ? "A small place for things worth coming back to."
                : "Fresh reading from the places you follow."}
            </p>}
          </div>
          {view === "library" && (
            <div className="library-layout-switch" role="group" aria-label="Library view">
              {libraryViews.map(layout => (
                <ActionHint key={layout.value} label={layout.label + " view"} shortcut={singleKeys ? layout.shortcut : undefined}>
                  <button type="button" aria-label={layout.label + " view"} aria-pressed={libraryLayout === layout.value} onClick={() => setLibraryLayout(layout.value)}>
                    <Icon name={layout.icon} size={15} />{layout.label}
                  </button>
                </ActionHint>
              ))}
            </div>
          )}
          {view === "discover" && (
            <div className="discovery-controls">
              <ActionHint
                label="Check sources"
                shortcut={singleKeys ? "Shift+r" : undefined}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  loading={pending.has("sync")}
                  onClick={() => void checkSources()}
                >
                  <Icon name="sync" size={15} />
                  Check now
                </Button>
              </ActionHint>
            </div>
          )}
        </div>
        <div className="list-toolbar">
          <div className="search-box">
            <Icon name="search" size={17} />
            <Input
              ref={searchRef}
              type="search"
              aria-label={
                view === "library" ? "Search library" : "Search discoveries"
              }
              placeholder={
                view !== "discover"
                  ? "Find a title, creator, tag…"
                  : "Search articles or sources…"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === "ArrowDown" || event.key === "Enter") {
                  event.preventDefault();
                  navigation.focusFirst();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  if (query) setQuery("");
                  else navigation.focusFirst();
                }
              }}
            />
            {!query && singleKeys && <kbd>/</kbd>}
          </div>
          <ActionHint label="Quick Find · all saved items" shortcut={formatForDisplay("Mod+K")}>
            <Button variant="secondary" size="sm" className="quick-find-trigger" aria-label="Quick Find" aria-haspopup="dialog" aria-expanded={quickFindOpen} aria-keyshortcuts="Control+K Meta+K" onClick={openQuickFind}>
              <Icon name="search" size={15} /> Quick Find
            </Button>
          </ActionHint>
          <div className="toolbar-filters">
            {view !== "discover" ? (
              <>
                <FilterPicker id="types" label="Types" values={kindFilters} options={kinds.map(value => ({ value, label: kindLabels[value] }))} open={filterOpen === "types"} onOpenChange={open => setFilterOpen(open ? "types" : undefined)} onChange={values => setKindFilters(values as Kind[])} shortcut={singleKeys ? "f t" : undefined} />
                <FilterPicker id="tags" label="Tags" values={tagFilters} options={tags.map(value => ({ value, label: value }))} open={filterOpen === "tags"} onOpenChange={open => setFilterOpen(open ? "tags" : undefined)} onChange={setTagFilters} shortcut={singleKeys ? "f g" : undefined} />
                {(channels.length > 0 || channelFilters.length > 0) && <FilterPicker id="channels" label="Channels" values={channelFilters} options={channels} open={filterOpen === "channels"} onOpenChange={open => setFilterOpen(open ? "channels" : undefined)} onChange={setChannelFilters} shortcut={singleKeys ? "f c" : undefined} />}
              </>
            ) : (
              <Picker
                label="Filter source"
                value={source}
                onChange={setSource}
                options={[
                  { value: "all", label: "All sources" },
                  ...sources.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            )}
          </div>
        </div>
        {view !== "discover" && (kindFilters.length + tagFilters.length + channelFilters.length > 0) && <div className="active-library-filters" aria-label="Active filters">
          {kindFilters.map(value => <button type="button" key={"type-" + value} aria-label={"Remove type filter " + kindLabels[value]} onClick={() => { setKindFilters(values => values.filter(v => v !== value)); document.getElementById("library-filter-types")?.focus({ preventScroll: true }); }}>{kindLabels[value]} <Icon name="close" size={12} /></button>)}
          {tagFilters.map(value => <button type="button" key={"tag-" + value} aria-label={"Remove tag filter " + value} onClick={() => { setTagFilters(values => values.filter(v => v !== value)); document.getElementById("library-filter-tags")?.focus({ preventScroll: true }); }}>#{value} <Icon name="close" size={12} /></button>)}
          {channelFilters.map(value => <button type="button" key={"channel-" + value} aria-label={"Remove channel filter " + value} onClick={() => { setChannelFilters(values => values.filter(v => v !== value)); (channels.length || channelFilters.length > 1 ? document.getElementById("library-filter-channels") : searchRef.current)?.focus({ preventScroll: true }); }}>{channels.find(option => option.value === value)?.label || value} <Icon name="close" size={12} /></button>)}
          <button type="button" className="text-link" onClick={() => { setKindFilters([]); setTagFilters([]); setChannelFilters([]); searchRef.current?.focus({ preventScroll: true }); }}>Clear selections</button>
        </div>}
        <div className="list-tabs-row">
          <div
            className="list-tabs"
            aria-label={
              view !== "discover" ? "Library status" : "Discovery status"
            }
          >
            {(view !== "discover"
              ? [
                  {
                    value: "pending",
                    label: "Unfinished",
                    hint: "Saved items you have not finished",
                  },
                  {
                    value: "done",
                    label: "Done",
                    hint: "Items you have finished",
                  },
                  { value: "next", label: "Up next", hint: "Your chosen unfinished items, in priority order" },
                  {
                    value: "review",
                    label: `Needs attention (${library.filter((m) => m.needs_review).length})`,
                    hint: "Items with details to check",
                  },
                  { value: "all", label: "All", hint: "Your entire library" },
                ]
              : [
                  {
                    value: "new",
                    label: "New",
                    hint: "Discoveries you have not opened yet",
                  },
                  {
                    value: "saved",
                    label: "Saved",
                    hint: "Discoveries saved to your library",
                  },
                  {
                    value: "read",
                    label: "Read",
                    hint: "Discoveries marked as read",
                  },
                  {
                    value: "dismissed",
                    label: "Dismissed",
                    hint: "Discoveries you have set aside",
                  },
                ]
            ).map((tab) => (
              <ActionHint
                key={tab.value}
                label={tab.hint}
                shortcut={singleKeys ? "[ / ]" : undefined}
                context={singleKeys ? "Switch status filters" : undefined}
              >
                <button
                  aria-pressed={
                    (view !== "discover" ? status : inboxState) === tab.value
                  }
                  onClick={() =>
                    view !== "discover"
                      ? changeStatus(tab.value)
                      : setInboxState(tab.value)
                  }
                >
                  {tab.label}
                </button>
              </ActionHint>
            ))}
          </div>
          {data && (
            <span className="result-count" aria-live="polite">
              {view === "discover" && !inboxPage.hasResult ? (inboxPage.error ? "Count unavailable" : "Loading…") : <>{view !== "discover" ? filtered.length : inboxPage.total}{" "}
              {view !== "discover"
                ? filtered.length === 1
                  ? "item"
                  : "items"
                : inboxPage.total === 1
                  ? "article"
                  : "articles"}</>}
            </span>
          )}
        </div>
        {view === "library" && status !== "next" && hideAutoAdded && <p className="automatic-filter-notice quiet text-xs">Automatic additions hidden. <button type="button" className="text-link" onClick={() => {
          setHideAutoAdded(false);
          try { localStorage.setItem("margin-hide-auto-added", "off"); } catch { /* optional preference */ }
        }}>Show all additions</button></p>}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
        {view === "library" && status === "next" && filtered.length > 0 && <p className="priority-context quiet">{queueFiltered ? <>Reordering is disabled while searching or filtering. <button type="button" className="text-link" onClick={clearQueueFilters}>Clear filters</button></> : <>Manual priority{layout !== "list" ? " within each shelf · numbers show overall order" : ""}. Open an item’s Up next actions to reorder.</>}</p>}
        {!data && !error && (
          <ListSkeleton discovery={view === "discover"} gallery={view !== "discover" && layout !== "list"} />
        )}
        {view !== "discover" && layout !== "list" && sections.filter(section => section.items.length).length > 1 && <nav className="library-section-links" aria-label="Jump to library section">
          {sections.filter(section => section.items.length).map(section => <button type="button" key={section.id} aria-label={(section.id === "reading" ? "Read" : section.id === "books" ? "Books" : section.label) + " " + section.items.length + ", jump to " + section.label} onClick={() => navigation.focusIndex(orderedLibrary.findIndex(item => item.id === section.items[0].id))}>{section.id === "reading" ? "Read" : section.id === "books" ? "Books" : section.label}{" "}<span>{section.items.length}</span></button>)}
        </nav>}
        {data &&
          view !== "discover" &&
          (filtered.length ? (
            <div className={"media-list" + (layout !== "list" ? " library-mixed" : "")} data-layout={layout} data-single-section={sections.filter(section => section.items.length).length === 1 || !sections.find(section => section.id === "reading")!.items.length || undefined} ref={listRef}>
              {layout === "list" ? visibleLibrary.map(renderLibraryItem) : <>
                <div className="library-visuals">
                  {sections.filter(section => section.id !== "reading" && section.items.length).map(renderLibrarySection)}
                </div>
                {sections.filter(section => section.id === "reading" && section.items.length).map(renderLibrarySection)}
              </>}
            </div>
          ) : status === "next" ? (
            <div className="priority-empty">
              <h2>{queue.ids.length ? "No Up next items match." : "Nothing in Up next yet."}</h2>
              <p>{queue.ids.length ? "Your shortlist is still here. Clear filters to see it." : "Use an item’s Up next actions to add it here."}</p>
              <Button variant="secondary" size="sm" onClick={queue.ids.length ? clearQueueFilters : () => { clearQueueFilters(); navigate("library"); }}>{queue.ids.length ? "Clear filters" : "Show unfinished"}</Button>
            </div>
          ) : (
            <EmptyState
              filtered={Boolean(query || kindFilters.length > 0 || tagFilters.length > 0 || channelFilters.length > 0)}
              done={status === "done"}
              review={status === "review"}
              action={
                query || kindFilters.length > 0 || tagFilters.length > 0 || channelFilters.length > 0 ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setQuery("");
                      setKindFilters([]);
                      setChannelFilters([]);
                      setFilterOpen(undefined);
                      setTagFilters([]);
                      searchRef.current?.focus({ preventScroll: true });
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  !["done", "review"].includes(status) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openEditor("new")}
                    >
                      <Icon name="plus" size={15} />
                      Add your first item
                    </Button>
                  )
                )
              }
            />
          ))}
        {data &&
          view === "discover" &&
          (inboxPage.error && !articles.length ? <div role="alert" className="notice error">{inboxPage.error} <Button variant="ghost" size="sm" className="text-link" loading={inboxPage.loading} onClick={event => void retryInbox(event)}>{inboxPage.loading ? "Retrying…" : "Try again"}</Button></div> : inboxPage.loading && !articles.length ? <ListSkeleton discovery /> : articles.length ? (
            <div className="inbox-list" ref={listRef}>
              {articles.slice(0, limit).map((item) => (
                <article
                  className="article-row scroll-mt-20 rounded-md"
                  key={item.id}
                  data-motion-key={item.id}
                  data-row-id={item.id}
                  data-keyboard-active={
                    (navigation.active && navigation.selectedId === item.id) ||
                    undefined
                  }
                  tabIndex={navigation.selectedId === item.id ? 0 : -1}
                  onFocusCapture={(event) =>
                    navigation.onFocus(item, event.currentTarget)
                  }
                  onBlurCapture={event => navigation.onBlur(event.currentTarget, event.relatedTarget)}
                  aria-label={item.title}
                >
                  <MiniCover kind="article" url={item.cover_url} publisherURL={item.url} />
                  <div className="article-content">
                    <div className="article-meta">
                      <span>{item.source_name}</span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={item.published_at}>
                        {relativeDate(item.published_at)}
                      </time>
                    </div>
                    <a
                      className="item-title"
                      href={safeURL(item.url)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => {
                        if (item.state === "new")
                          void setArticleState(item.id, "read");
                      }}
                    >
                      {item.title}
                    </a>
                    {item.description && (
                      <p className="article-description">{item.description}</p>
                    )}
                    <div className="article-actions">
                      {item.state === "saved" ? (
                        <span className="saved-label">
                          <Icon name="check" size={13} />
                          Saved to library
                        </span>
                      ) : (
                        <ActionHint
                          label="Save to library"
                          shortcut={singleKeys ? "s" : undefined}
                          context={
                            singleKeys ? "With this row focused" : undefined
                          }
                        >
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={pending.has(item.id)}
                            onClick={() => void saveArticle(item.id)}
                          >
                            <Icon name="plus" size={13} />
                            Save
                          </Button>
                        </ActionHint>
                      )}
                      {item.state === "new" && (
                        <ActionHint
                          label="Open article and mark read"
                          shortcut="Enter"
                          context="With this row focused"
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending.has(item.id)}
                            nativeButton={false}
                            render={
                              <a
                                href={safeURL(item.url)}
                                target="_blank"
                                rel="noreferrer"
                              />
                            }
                            onClick={() =>
                              void setArticleState(item.id, "read")
                            }
                          >
                            Read <Icon name="external" size={12} />
                          </Button>
                        </ActionHint>
                      )}
                      {["read", "dismissed"].includes(item.state) && (
                        <ActionHint
                          label="Move back to new discoveries"
                          shortcut={
                            singleKeys && item.state === "read"
                              ? "r"
                              : undefined
                          }
                          context={
                            singleKeys && item.state === "read"
                              ? "With this row focused"
                              : undefined
                          }
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending.has(item.id)}
                            onClick={() => void setArticleState(item.id, "new")}
                          >
                            Mark new
                          </Button>
                        </ActionHint>
                      )}
                    </div>
                  </div>
                  {!["saved", "dismissed"].includes(item.state) && (
                    <ActionHint
                      label="Dismiss article"
                      shortcut={singleKeys ? "x" : undefined}
                      context={singleKeys ? "With this row focused" : undefined}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={"Dismiss " + item.title}
                        disabled={pending.has(item.id)}
                        onClick={() =>
                          void setArticleState(item.id, "dismissed")
                        }
                      >
                        <Icon name="close" size={17} />
                      </Button>
                    </ActionHint>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              discovery
              heading={discoveryEmpty.heading}
              description={discoveryEmpty.description}
              filtered={Boolean(query || source !== "all")}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSourcesOpen(true)}
                >
                  Manage sources <Icon name="rss" size={14} />
                </Button>
              }
            />
          ))}
        {(view !== "discover" ? hasMoreLibrary : articles.length > limit || inboxPage.next_cursor) && (
          <div className="show-more">
            <ActionHint
              label={
                view !== "discover"
                  ? layout === "list" ? "Show up to 40 more items" : "Show up to 40 more items per section"
                  : "Show up to 40 more articles"
              }
            >
              <Button
                variant="secondary"
                size="sm"
                loading={view === "discover" && inboxPage.loading}
                onClick={async (event) => {
                  if (event.detail === 0) pendingShowMore.current = view !== "discover" ? navigationItems.findIndex(item => !visibleItems.some(visible => visible.id === item.id)) : limit;
                  if (view === "discover" && limit >= articles.length) {
                    if (await inboxPage.more()) setLimit(n => n + 40);
                    else pendingShowMore.current = undefined;
                  } else setLimit(n => n + 40);
                }}
              >
                Show more <Icon name="chevron" size={14} />
              </Button>
            </ActionHint>
          </div>
        )}
        {data && view === "discover" && inboxPage.error && articles.length > 0 && <div role="alert" className="notice warning">
          Could not update discoveries. Your loaded articles are still available. {inboxPage.error}{" "}
          <Button variant="ghost" size="sm" className="text-link" loading={inboxPage.loading} onClick={event => void retryInbox(event)}>{inboxPage.loading ? "Retrying…" : "Try again"}</Button>
        </div>}
        {data && view === "discover" && inboxPage.loadingMore && articles.length > 0 && <ListSkeleton discovery count={3} />}
        {data?.dev_mode && (
          <div
            className="mt-5 flex items-center gap-3 text-xs text-u-muted"
            role="region"
            aria-label="Development tools"
          >
            <span>Development{singleKeys ? " · g then m" : ""}</span>
            <ActionHint
              label={
                data.dev_fixture_count
                  ? "Remove the generated demo items"
                  : "Add demo items for all nine media types"
              }
              shortcut={singleKeys ? "g then m" : undefined}
            >
              <Button
                variant="ghost"
                size="sm"
                loading={pending.has("demo-data")}
                onClick={() => void toggleDemoData()}
              >
                {data.dev_fixture_count ? "Clear demo data" : "Load demo data"}
              </Button>
            </ActionHint>
          </div>
        )}
        <footer className="page-footer">
          <Icon name={view !== "discover" ? "lock" : "rss"} size={13} />
          {view !== "discover"
            ? "Private by default. Yours to curate."
            : "Collected automatically. Saved by choice."}
          <ActionHint label="Keyboard shortcuts" shortcut="F1">
            <button
              className="ml-auto rounded border-0 bg-transparent px-2 py-1 text-[11px] text-[var(--u-muted)] hover:bg-[var(--u-well)]"
              onClick={() => setHelpOpen(true)}
            >
              {singleKeys
                ? "h/j/k/l move · [/] tabs · F1 help"
                : "Arrow keys move · Enter open · F1 help"}
            </button>
          </ActionHint>
        </footer>
      </main>
      {editor && (
        <Editor
          memory={editorMemory}
          fallbackFocus={mediaFocus}
          key={editor === "new" ? "new" : editor.id}
          item={
            editor === "new"
              ? undefined
              : media.find((item) => item.id === editor.id) || editor
          }
          onClose={(discard?: boolean) => {
            if (discard || !editorMemory.current?.recoverable) discardDraft();
            else setDraftPending(true);
            setEditor(undefined);
          }}
          onSaved={(item) => {
            acknowledgeMedia(item);
            discardDraft();
            setEditor(undefined);
            toast.add({
              title:
                editor === "new"
                  ? item.metadata_state === "pending"
                    ? "Saved. Details are still loading."
                    : "Added to library."
                  : editor.needs_review && !item.needs_review
                    ? "Saved and marked reviewed."
                    : "Changes saved.",
              type: "success",
              actionProps: { children: "Edit item", onClick: () => openEditor(item) },
            });
            void refresh();
          }}
          onDuplicate={(id) => {
            // Editor invokes this only after explicit navigation/discard of
            // the duplicate draft. Do not reset the owner's working set.
            discardDraft();
            const item = media.find((m) => m.id === id);
            if (item) setEditor(item);
            else {
              setEditor(undefined);
              void api<Media[]>("/media").then(items => {
                const existing = items.find(candidate => candidate.id === id);
                if (existing) openEditor(existing);
                else toast.add({ title: "This item is no longer available.", type: "danger" });
              }).catch(e => toast.add({ title: e instanceof Error ? e.message : "Could not open item.", type: "danger" }));
            }
          }}
          onDelete={async (item) => {
            await removeMedia(item.id);
            await refresh();
          }}
        />
      )}
      {quickFindOpen && <QuickFind media={media.filter(item => !data?.dev_fixture_ids?.includes(item.id))} loading={!data} onClose={() => setQuickFindOpen(false)} onEdit={openEditor} fallbackFocus={() => document.querySelector<HTMLElement>('[aria-label="Quick Find"]')} />}
      {pendingEditor && <Modal title="Unfinished draft" description="Resume your draft, or discard it to open another editor." focusTitle={false} closeRequested={Boolean(draftChoice)} fallbackFocus={mediaFocus} onClose={() => {
        const target = pendingEditor;
        setPendingEditor(undefined);
        setDraftChoice(undefined);
        if (draftChoice === "resume") resumeDraft();
        else if (draftChoice === "discard") { discardDraft(); setEditor(target); }
      }}>
        <p className="quiet">Only one draft is kept in memory. Reloading or closing this tab clears it.</p>
        <div className="modal-footer flex-wrap">
          <Button variant="ghost" onClick={() => setDraftChoice("cancel")}>Keep draft</Button>
          <Button variant="secondary" onClick={() => setDraftChoice("discard")}>Discard draft and continue</Button>
          <Button autoFocus onClick={() => setDraftChoice("resume")}>Resume draft</Button>
        </div>
      </Modal>}
      {sourcesOpen && (
        <SourcesPanel
          sources={sources}
          onClose={() => setSourcesOpen(false)}
          onChanged={refresh}
          onSourcesChange={update => setData(current => current ? { ...current, sources: update(current.sources) } : current)}
          refreshError={error}
          perform={perform}
          pending={pending}
        />
      )}
      {removeTarget && <Modal title="Remove from library?" description={removeTarget.title} closeRequested={removeClosing} onClose={() => { setRemoveTarget(undefined); setRemoveClosing(false); }} busy={pending.has(removeTarget.id)} focusTitle={false} fallbackFocus={mediaFocus}>
        <p className="quiet">This removes the saved item and its private notes. Automatic collection will not add it back to Library.</p>
        <div className="modal-footer"><Button autoFocus disabled={pending.has(removeTarget.id)} variant="ghost" onClick={() => setRemoveClosing(true)}>Keep it</Button><Button variant="danger" loading={pending.has(removeTarget.id)} onClick={async () => {
          if (await perform(removeTarget.id, () => removeMedia(removeTarget.id), "Removed from library.")) {
            setRemoveClosing(true);
          }
        }}>Remove item</Button></div>
      </Modal>}
      {settings && (
        <Settings
          onClose={() => setSettings(false)}
          appearance={appearance}
          onTheme={toggleTheme}
          singleKeys={singleKeys}
          hideAutoAdded={hideAutoAdded}
          onHideAutoAdded={hide => {
            setHideAutoAdded(hide);
            try { localStorage.setItem("margin-hide-auto-added", hide ? "on" : "off"); } catch { /* optional preference */ }
          }}
          onSingleKeys={(enabled) => {
            setSingleKeys(enabled);
            try {
              localStorage.setItem(
                "margin-single-key-shortcuts",
                enabled ? "on" : "off",
              );
            } catch {
              /* optional preference */
            }
          }}
          devMode={data?.dev_mode}
          fixtureCount={data?.dev_fixture_count}
          onDemoData={() => void toggleDemoData()}
          demoBusy={pending.has("demo-data")}
          legacyCount={data?.legacy_sample_count || 0}
          onChanged={refresh}
          onLogout={() =>
            void logout().catch((e) =>
              toast.add({ title: e.message, type: "danger" }),
            )
          }
        />
      )}
      {helpOpen && (
        <KeyboardHelp
          onClose={() => setHelpOpen(false)}
          singleKeys={singleKeys}
        />
      )}
    </div>
  );
  return <HintScope disabled={!shortcutsEnabled}>{content}</HintScope>;
}
