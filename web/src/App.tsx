import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatForDisplay, useHotkeys } from "@tanstack/react-hotkeys";
import { Theme } from "unlikely-ui/theme";
import { Button } from "unlikely-ui/button";
import { Checkbox } from "unlikely-ui/checkbox";
import { Input } from "unlikely-ui/input";
import { Toast } from "unlikely-ui/toast";
import { Collection } from "./Collection";
import { Access } from "./Access";
import { api, send } from "./api";
import { EmptyState, MiniCover, Picker, TypeLabel } from "./components";
import { Editor } from "./Editor";
import { Icon, Logo } from "./Icon";
import { Settings } from "./Settings";
import { SourcesPanel } from "./SourcesPanel";
import {
  kinds,
  kindLabels,
  type Kind,
  type LibraryData,
  type Media,
  type Session,
} from "./types";
import { hostname, relativeDate, safeURL, selectMedia } from "./utils";
import { useListMotion } from "./useListMotion";
import { useListNavigation } from "./useListNavigation";
import { KeyboardHelp } from "./KeyboardHelp";
import { ActionHint, HintScope } from "./ActionHint";

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
            appearance={appearance}
            toggleTheme={() =>
              setAppearance((a) => (a === "light" ? "dark" : "light"))
            }
            logout={async () => {
              await api("/logout", send("POST"));
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
  appearance,
  toggleTheme,
  logout,
}: {
  appearance: "light" | "dark";
  toggleTheme: () => void;
  logout: () => Promise<void>;
}) {
  const [data, setData] = useState<LibraryData>();
  const [error, setError] = useState("");
  const [view, setView] = useState<"library" | "discover">(() =>
    window.location.hash === "#discover" ? "discover" : "library",
  );
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind | "all">("all");
  const [tag, setTag] = useState("");
  const [status, setStatus] = useState("pending");
  const [inboxState, setInboxState] = useState("new");
  const [source, setSource] = useState("all");
  const [limit, setLimit] = useState(40);
  const [editor, setEditor] = useState<Media | "new">();
  const [settings, setSettings] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
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
  const activeMutations = useRef(new Set<string>());
  const toast = Toast.useToastManager();
  const refresh = useCallback(async () => {
    const id = ++version.current;
    try {
      const response = await api<LibraryData>("/bootstrap");
      if (version.current === id) {
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
      setQuery("");
      setKind("all");
      setTag("");
      setLimit(40);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => setLimit(40), [query, kind, tag, status, inboxState, source]);
  useEffect(() => {
    document.title =
      (view === "library" ? "Library" : "Discover") + " — Margin";
  }, [view]);
  const shortcutsEnabled = !editor && !settings && !sourcesOpen && !helpOpen;
  useHotkeys(
    [
      {
        hotkey: "Mod+K",
        callback: () => searchRef.current?.focus(),
        options: { ignoreInputs: false },
      },
      {
        hotkey: "Mod+Shift+A",
        callback: () => setEditor("new"),
        options: { ignoreInputs: false },
      },
      {
        hotkey: "/",
        callback: () => searchRef.current?.focus(),
        options: { enabled: shortcutsEnabled && singleKeys },
      },
      {
        hotkey: "N",
        callback: () => setEditor("new"),
        options: { enabled: shortcutsEnabled && singleKeys },
      },
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
      { hotkey: "Mod+,", callback: () => setSettings(true) },
      {
        hotkey: ["G", "S"],
        callback: () => setSourcesOpen(true),
        options: { enabled: shortcutsEnabled && singleKeys },
      },
      { hotkey: "F1", callback: () => setHelpOpen(true) },
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
    ],
    { enabled: shortcutsEnabled, requireReset: true },
  );
  const media = data?.media || [];
  const inbox = data?.inbox || [];
  const sources = data?.sources || [];
  const filtered = useMemo(
    () =>
      selectMedia(
        status === "review" ? media.filter((item) => item.needs_review) : media,
        { query, status: status === "review" ? "all" : status, kind, tag },
      ),
    [media, query, status, kind, tag],
  );
  useEffect(() => {
    if (!data || !window.location.hash.startsWith("#edit=")) return;
    const item = data.media.find((m) => m.id === window.location.hash.slice(6));
    if (item) {
      setEditor(item);
      window.history.replaceState(null, "", "/dashboard#library");
    }
  }, [data]);
  const tags = [...new Set(media.flatMap((item) => item.tags))].sort((a, b) =>
    a.localeCompare(b),
  );
  const articles = inbox
    .filter(
      (item) =>
        item.state === inboxState &&
        (source === "all" || item.source_id === source) &&
        query
          .toLocaleLowerCase()
          .trim()
          .split(/\s+/)
          .every((term) =>
            (item.title + " " + item.source_name + " " + item.description)
              .toLocaleLowerCase()
              .includes(term),
          ),
    )
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const listRef = useListMotion(
    (view === "library" ? filtered : articles)
      .slice(0, limit)
      .map((item) => item.id)
      .join("|"),
  );
  const navigation = useListNavigation({
    items: view === "library" ? filtered : articles,
    root: listRef,
    limit,
    onLimit: setLimit,
    scope: view + ":" + (view === "library" ? status : inboxState),
    enabled: shortcutsEnabled,
    singleKeys,
    actions: {
      open: (item) => {
        const link = safeURL(item.url);
        if (link) window.open(link, "_blank", "noopener,noreferrer");
        else if ("kind" in item) setEditor(item);
        if ("state" in item && item.state === "new")
          void setArticleState(item.id, "read");
      },
      ...(view === "library"
        ? {
            done: (item: (typeof media)[number] | (typeof inbox)[number]) => {
              if ("kind" in item) void toggle(item);
            },
            edit: (item: (typeof media)[number] | (typeof inbox)[number]) => {
              if ("kind" in item) setEditor(item);
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
  async function perform(
    key: string,
    fn: () => Promise<unknown>,
    message?: string,
  ) {
    if (activeMutations.current.has(key)) return false;
    activeMutations.current.add(key);
    setPending(new Set(activeMutations.current));
    try {
      await fn();
      await refresh();
      if (message) toast.add({ title: message, type: "success" });
      return true;
    } catch (e) {
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
  function navigate(next: "library" | "discover") {
    setView(next);
    window.location.hash = next;
    setQuery("");
    setKind("all");
    setTag("");
    setLimit(40);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function cycleStatus(direction: number) {
    const values =
      view === "library"
        ? ["pending", "done", "review", "all"]
        : ["new", "saved", "read", "dismissed"];
    const current = values.indexOf(view === "library" ? status : inboxState);
    const next = values[(current + direction + values.length) % values.length];
    if (view === "library") setStatus(next);
    else setInboxState(next);
  }
  async function toggle(item: Media) {
    const next = item.status === "done" ? "pending" : "done";
    if (
      await perform(item.id, () =>
        api("/media/" + item.id, send("PATCH", { status: next })),
      )
    ) {
      undo.current = () =>
        void perform(item.id, () =>
          api("/media/" + item.id, send("PATCH", { status: item.status })),
        );
      toast.add({
        title: next === "done" ? "Marked done." : "Back on your list.",
        actionProps: {
          children: "Undo",
          onClick: undo.current,
        },
      });
    }
  }
  async function saveArticle(id: string) {
    if (
      await perform(
        id,
        () => api("/inbox/" + id + "/save", send("POST")),
        "Saved to library.",
      )
    )
      undo.current = undefined;
  }
  async function setArticleState(
    id: string,
    next: "new" | "read" | "dismissed",
  ) {
    const old = inbox.find((item) => item.id === id)?.state;
    if (!old || old === next) return;
    if (
      await perform(id, () =>
        api("/inbox/" + id, send("PATCH", { state: next })),
      )
    ) {
      undo.current = () =>
        void perform(id, () =>
          api("/inbox/" + id, send("PATCH", { state: old })),
        );
      toast.add({
        title:
          next === "dismissed"
            ? "Dismissed."
            : next === "read"
              ? "Marked read."
              : "Marked new.",
        actionProps: { children: "Undo", onClick: undo.current },
      });
    }
  }
  async function markReviewed(item: Media) {
    if (!item.needs_review) return;
    if (
      await perform(item.id, () =>
        api("/media/" + item.id, send("PATCH", { needs_review: false })),
      )
    ) {
      undo.current = () =>
        void perform(item.id, () =>
          api("/media/" + item.id, send("PATCH", { needs_review: true })),
        );
      toast.add({
        title: "Marked reviewed.",
        actionProps: { children: "Undo", onClick: undo.current },
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
        setTag("demo");
      } else setTag("");
    }
  }
  async function checkSources() {
    await perform(
      "sync",
      () => api("/sync", send("POST")),
      "Checking your sources. New articles appear automatically.",
    );
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
            onClick={() => navigate("library")}
          >
            <Logo small />
          </button>
          <nav className="main-nav" aria-label="Main navigation">
            <ActionHint
              label="Library"
              shortcut={singleKeys ? "G then L" : undefined}
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
              shortcut={singleKeys ? "G then D" : undefined}
            >
              <button
                aria-current={view === "discover" ? "page" : undefined}
                onClick={() => navigate("discover")}
              >
                <Icon name="inbox" size={16} />
                Discover
                {inbox.some((item) => item.state === "new") && (
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
              shortcut={singleKeys ? "G then S" : undefined}
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
                onClick={() => setEditor("new")}
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
      <main id="content" className="content" tabIndex={-1}>
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
        <div className="page-heading" key={view}>
          <div>
            <h1>
              {view === "library" ? "Your library" : "Discover"}
              <span>.</span>
            </h1>
            <p>
              {view === "library"
                ? "A small place for things worth coming back to."
                : "Fresh reading from the places you follow."}
            </p>
          </div>
          {view === "discover" && (
            <div className="discovery-controls">
              <ActionHint
                label="Check sources"
                shortcut={singleKeys ? "Shift+R" : undefined}
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
                view === "library"
                  ? "Find a title, creator, tag…"
                  : "Search articles or sources…"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-keyshortcuts="Control+K Meta+K"
              onKeyDown={(event) => {
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
            {!query && <kbd>{formatForDisplay("Mod+K")}</kbd>}
          </div>
          <div className="toolbar-filters">
            {view === "library" ? (
              <>
                <Picker
                  label="Filter media type"
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: "all", label: "All types" },
                    ...kinds.map((k) => ({ value: k, label: kindLabels[k] })),
                  ]}
                />
                {tags.length > 0 && (
                  <Picker
                    label="Filter tag"
                    value={tag}
                    onChange={setTag}
                    options={[
                      { value: "", label: "All tags" },
                      ...tags.map((t) => ({ value: t, label: t })),
                    ]}
                  />
                )}
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
        <div className="list-tabs-row">
          <div
            className="list-tabs"
            aria-label={
              view === "library" ? "Library status" : "Discovery status"
            }
          >
            {(view === "library"
              ? [
                  { value: "pending", label: "To read/watch" },
                  { value: "done", label: "Done" },
                  {
                    value: "review",
                    label: `To review (${media.filter((m) => m.needs_review).length})`,
                  },
                  { value: "all", label: "All" },
                ]
              : [
                  { value: "new", label: "New" },
                  { value: "saved", label: "Saved" },
                  { value: "read", label: "Read" },
                  { value: "dismissed", label: "Dismissed" },
                ]
            ).map((tab) => (
              <button
                key={tab.value}
                aria-pressed={
                  (view === "library" ? status : inboxState) === tab.value
                }
                onClick={() =>
                  view === "library"
                    ? setStatus(tab.value)
                    : setInboxState(tab.value)
                }
              >
                {tab.label}
              </button>
            ))}
          </div>
          {data && (
            <span className="result-count" aria-live="polite">
              {view === "library" ? filtered.length : articles.length}{" "}
              {view === "library"
                ? filtered.length === 1
                  ? "item"
                  : "items"
                : articles.length === 1
                  ? "article"
                  : "articles"}
            </span>
          )}
        </div>
        {!data && !error && (
          <div className="loading-list" role="status" aria-label="Loading list">
            {[1, 2, 3, 4].map((n) => (
              <div className="loading-row" key={n} />
            ))}
          </div>
        )}
        {data &&
          view === "library" &&
          (filtered.length ? (
            <div className="media-list" ref={listRef}>
              {filtered.slice(0, limit).map((item) => (
                <article
                  className={
                    "media-row scroll-mt-20 rounded outline-none data-[keyboard-active=true]:bg-[var(--u-accent-soft)] focus-visible:outline-1 focus-visible:outline-[var(--u-focus)] " +
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
                  aria-label={item.title}
                >
                  <ActionHint
                    label={
                      item.status === "done"
                        ? "Move to read/watch"
                        : "Mark done"
                    }
                    shortcut={singleKeys ? "D" : undefined}
                    context={singleKeys ? "With this row focused" : undefined}
                  >
                    <Checkbox
                      checked={item.status === "done"}
                      disabled={pending.has(item.id)}
                      aria-label={
                        (item.status === "done"
                          ? "Mark to read/watch: "
                          : "Mark done: ") + item.title
                      }
                      onCheckedChange={() => void toggle(item)}
                    />
                  </ActionHint>
                  <MiniCover kind={item.kind} url={item.cover_url} />
                  <div className="row-content">
                    {safeURL(item.url) ? (
                      <a
                        className="item-title row-primary-action"
                        href={safeURL(item.url)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {item.title}
                        <Icon name="external" size={12} />
                      </a>
                    ) : (
                      <button
                        className="item-title row-primary-action"
                        onClick={() => setEditor(item)}
                      >
                        {item.title}
                      </button>
                    )}
                    <div className="item-meta">
                      <span>
                        {item.author ||
                          hostname(item.url) ||
                          kindLabels[item.kind]}
                      </span>
                      {item.tags.slice(0, 2).map((t) => (
                        <button
                          className="inline-tag"
                          key={t}
                          onClick={() => setTag(t)}
                        >
                          {t}
                        </button>
                      ))}
                      {item.visibility === "public" && (
                        <span
                          className="public-marker"
                          role="img"
                          aria-label="Public item"
                        >
                          <Icon name="globe" size={15} />
                        </span>
                      )}
                    </div>
                    {item.metadata_state === "pending" && (
                      <p
                        className="mt-1 text-[11px] text-u-muted"
                        role="status"
                      >
                        Finding details…
                      </p>
                    )}
                    {item.metadata_state === "partial" && (
                      <button
                        className="metadata-warning"
                        aria-label={"Edit missing details: " + item.title}
                        onClick={() => setEditor(item)}
                      >
                        Missing details · Edit
                      </button>
                    )}
                  </div>
                  {item.needs_review && (
                    <Button
                      className="review-button"
                      variant="secondary"
                      size="sm"
                      disabled={pending.has(item.id)}
                      aria-label={"Mark reviewed: " + item.title}
                      onClick={() => void markReviewed(item)}
                    >
                      Mark reviewed
                    </Button>
                  )}
                  <TypeLabel kind={item.kind} />
                  <ActionHint
                    label="Edit item"
                    shortcut={singleKeys ? "E" : undefined}
                    context={singleKeys ? "With this row focused" : undefined}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={"Edit " + item.title}
                      onClick={() => setEditor(item)}
                    >
                      <Icon name="edit" size={16} />
                    </Button>
                  </ActionHint>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              filtered={Boolean(query || kind !== "all" || tag)}
              done={status === "done"}
              review={status === "review"}
              action={
                query || kind !== "all" || tag ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setQuery("");
                      setKind("all");
                      setTag("");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  !["done", "review"].includes(status) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditor("new")}
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
          (articles.length ? (
            <div className="inbox-list" ref={listRef}>
              {articles.slice(0, limit).map((item) => (
                <article
                  className="article-row scroll-mt-20 rounded outline-none data-[keyboard-active=true]:bg-[var(--u-accent-soft)] focus-visible:outline-1 focus-visible:outline-[var(--u-focus)]"
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
                  aria-label={item.title}
                >
                  <MiniCover kind="article" url={item.cover_url} />
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
                      <Icon name="external" size={12} />
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
                          shortcut={singleKeys ? "S" : undefined}
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
                          onClick={() => void setArticleState(item.id, "read")}
                        >
                          Read <Icon name="external" size={12} />
                        </Button>
                      )}
                      {["read", "dismissed"].includes(item.state) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending.has(item.id)}
                          onClick={() => void setArticleState(item.id, "new")}
                        >
                          Mark new
                        </Button>
                      )}
                    </div>
                  </div>
                  {!["saved", "dismissed"].includes(item.state) && (
                    <ActionHint
                      label="Dismiss article"
                      shortcut={singleKeys ? "X" : undefined}
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
        {(view === "library" ? filtered.length : articles.length) > limit && (
          <div className="show-more">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setLimit((n) => n + 40)}
            >
              Show more <Icon name="chevron" size={14} />
            </Button>
          </div>
        )}
        {data?.dev_mode && (
          <div
            className="mt-5 flex items-center gap-3 text-xs text-u-muted"
            role="region"
            aria-label="Development tools"
          >
            <span>Development · G then M</span>
            <Button
              variant="ghost"
              size="sm"
              loading={pending.has("demo-data")}
              onClick={() => void toggleDemoData()}
            >
              {data.dev_fixture_count ? "Clear demo data" : "Load demo data"}
            </Button>
          </div>
        )}
        <footer className="page-footer">
          <Icon name={view === "library" ? "lock" : "rss"} size={13} />
          {view === "library"
            ? "Private by default. Yours to curate."
            : "Collected automatically. Saved by choice."}
          <ActionHint label="Keyboard shortcuts" shortcut="F1">
            <button
              className="ml-auto rounded border-0 bg-transparent px-2 py-1 text-[11px] text-[var(--u-muted)] hover:bg-[var(--u-well)]"
              onClick={() => setHelpOpen(true)}
            >
              ↑↓ navigate · Enter open · F1 help
            </button>
          </ActionHint>
        </footer>
      </main>
      {editor && (
        <Editor
          key={editor === "new" ? "new" : editor.id}
          item={
            editor === "new"
              ? undefined
              : media.find((item) => item.id === editor.id) || editor
          }
          onClose={() => setEditor(undefined)}
          onSaved={(item) => {
            setEditor(undefined);
            if (editor === "new") setStatus(item.status);
            if (view === "library" && editor === "new") {
              setQuery("");
              setKind("all");
              setTag("");
            }
            toast.add({
              title:
                editor === "new"
                  ? item.metadata_state === "pending"
                    ? "Saved. Details will fill in shortly."
                    : "Added to library."
                  : editor.needs_review && !item.needs_review
                    ? "Saved and marked reviewed."
                    : "Changes saved.",
              type: "success",
            });
            void refresh();
          }}
          onDuplicate={(id) => {
            const item = media.find((m) => m.id === id);
            if (item) setEditor(item);
            else {
              setEditor(undefined);
              setQuery("");
              setStatus("all");
              void refresh();
            }
          }}
          onDelete={async (item) => {
            await api("/media/" + item.id, send("DELETE"));
            await refresh();
          }}
        />
      )}
      {sourcesOpen && (
        <SourcesPanel
          sources={sources}
          onClose={() => setSourcesOpen(false)}
          onChanged={refresh}
          perform={perform}
          pending={pending}
        />
      )}
      {settings && (
        <Settings
          onClose={() => setSettings(false)}
          appearance={appearance}
          onTheme={toggleTheme}
          singleKeys={singleKeys}
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
