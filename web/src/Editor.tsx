import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { Button } from "unlikely-ui/button";
import { ActionHint } from "./ActionHint";
import { Checkbox } from "unlikely-ui/checkbox";
import { Input } from "unlikely-ui/input";
import { Textarea } from "unlikely-ui/textarea";
import { formatForDisplay, useHotkey } from "@tanstack/react-hotkeys";
import { api, ApiError, send } from "./api";
import { FormField, MiniCover, Modal, Picker } from "./components";
import { Icon } from "./Icon";
import {
  emptyDraft,
  kinds,
  kindLabels,
  type Media,
  type MediaDraft,
  type Metadata,
} from "./types";
import { hostname, isFallbackTitle, publicPath, safeURL } from "./utils";
import { optimizeImage } from "./images";
import "./Editor.css";

// In-memory only: App retains one recoverable draft across dismissal/sign-in.
export interface EditorSnapshot {
  recoverable?: boolean;
  item?: Media;
  original?: Media;
  draft: MediaDraft;
  capture: string;
  tags: string;
  warning: string;
  lookupComplete: boolean;
  lookupVersion: number;
  markReviewed: boolean;
  authorQuery: string;
  details: boolean;
  bookQuery: string;
  correcting: boolean;
  dirty: string[];
  changed: string[];
  detailsURL?: string;
  urlChoice?: { url: string; mode: "keep" | "replace" };
}

// Anchors are positions in the same work; explicit hash routes are different
// works. This comparison controls metadata handling, never saved identity.
function detailsIdentity(value: string) {
  if (!safeURL(value)) return value.trim();
  const url = new URL(value);
  if (!url.hash.startsWith("#/") && !url.hash.startsWith("#!/")) url.hash = "";
  return url.href;
}

export function Editor({
  item,
  memory,
  onClose,
  onSaved,
  onDelete,
  onDuplicate,
  fallbackFocus,
}: {
  item?: Media;
  memory: RefObject<EditorSnapshot | undefined>;
  onClose: (discard?: boolean) => void;
  onSaved: (item: Media) => void;
  onDelete: (item: Media) => Promise<void>;
  onDuplicate: (id: string) => void;
  fallbackFocus?: () => HTMLElement | null;
}) {
  const [restored] = useState(() =>
    memory.current?.item?.id === item?.id ? memory.current : undefined,
  );
  const [draft, setDraft] = useState<MediaDraft>(() => ({
    ...emptyDraft(),
    ...item,
    ...restored?.draft,
  }));
  const [capture, setCapture] = useState(restored?.capture || "");
  const [tags, setTags] = useState(restored?.tags ?? item?.tags.join(", ") ?? "");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [warning, setWarning] = useState(restored?.warning ?? item?.metadata_warning ?? "");
  const [lookupVersion, setLookupVersion] = useState(restored?.lookupVersion || 0);
  const [lookupRequest, setLookupRequest] = useState<{ url: string; replace: boolean }>();
  const [detailsURL, setDetailsURL] = useState(restored?.detailsURL ?? item?.url ?? "");
  const [urlChoice, setURLChoice] = useState(restored?.urlChoice);
  const [replacement, setReplacement] = useState<{ url: string; metadata: Metadata }>();
  const [lookupComplete, setLookupComplete] = useState(
    restored?.lookupComplete ?? Boolean(item && item.metadata_state !== "pending"),
  );
  const [markReviewed, setMarkReviewed] = useState(restored?.markReviewed ?? Boolean(item?.needs_review));
  const [authorQuery, setAuthorQuery] = useState(restored?.authorQuery || "");
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [details, setDetails] = useState(restored?.details || false);
  const [closing, setClosing] = useState(false);
  const [matches, setMatches] = useState<Metadata[]>([]);
  const [correcting, setCorrecting] = useState(restored?.correcting || false);
  const [bookQuery, setBookQuery] = useState(restored?.bookQuery || "");
  const [bookRequest, setBookRequest] = useState(0);
  const [bookLoading, setBookLoading] = useState(false);
  const [bookWarning, setBookWarning] = useState("");
  const dirty = useRef(new Set(restored?.dirty || []));
  const changed = useRef(new Set(restored?.changed || []));
  const original = useRef(restored?.original || item);
  const initial = original.current || emptyDraft();
  const draftTags = [...new Set(tags.split(",").map(t => t.trim()).filter(Boolean))];
  const fieldChanged = (key: keyof MediaDraft) =>
    JSON.stringify(key === "tags" ? draftTags : draft[key]) !== JSON.stringify(initial[key]);
  const recoverable = item
    ? [...changed.current].some(key => fieldChanged(key as keyof MediaDraft)) || markReviewed !== Boolean(original.current?.needs_review)
    : Boolean(capture.trim() || (Object.keys(emptyDraft()) as (keyof MediaDraft)[]).some(fieldChanged));
  useLayoutEffect(() => {
    memory.current = {
      recoverable,
      item, original: original.current, draft, capture, tags, warning,
      lookupComplete, lookupVersion, markReviewed, authorQuery, details,
      bookQuery, correcting, dirty: [...dirty.current], changed: [...changed.current],
      detailsURL, urlChoice,
    };
  });
  const abortLookup = useRef<AbortController | null>(null);
  const abortBook = useRef<AbortController | null>(null);
  const result = useRef<Media | undefined>(undefined);
  const discardOnClose = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const focusAfterReload = useRef(false);
  useEffect(() => {
    // Only explicit actions set errors; background metadata uses warnings.
    if ((error || duplicate) && !reloading) {
      errorRef.current?.focus({ preventScroll: true });
      errorRef.current?.scrollIntoView({ block: "nearest" });
    } else if (focusAfterReload.current) {
      focusAfterReload.current = false;
      titleRef.current?.focus();
    }
  }, [error, duplicate, reloading]);
  const urlMode = !item && Boolean(safeURL(capture));
  const busy = saving || uploading || reloading;
  const draftLocked = saving || reloading || closing;
  const draftLockedRef = useRef(draftLocked);
  draftLockedRef.current = draftLocked;
  const naturalArtwork = draft.kind !== "article" && draft.kind !== "paper" && draft.kind !== "other";
  const needsURLChoice = Boolean(item && safeURL(draft.url) && detailsIdentity(draft.url) !== detailsIdentity(detailsURL));
  const urlResolved = urlChoice?.url === draft.url;
  useHotkey("Mod+Enter", event => {
    if (!draftLockedRef.current && event.target instanceof Node && formRef.current?.contains(event.target))
      formRef.current.requestSubmit();
  }, {
    // Keyup can move to BODY when submission disables the focused input.
    // Track releases at document level; only a keydown inside this form saves.
    enabled: !busy && !confirm && !closing,
    ignoreInputs: false,
    requireReset: true,
  });
  useHotkey("Mod+Shift+D", () => { if (!draftLockedRef.current) setDetails((value) => !value); }, {
    target: formRef,
    enabled: !busy && !closing,
    ignoreInputs: false,
    requireReset: true,
  });
  useHotkey(
    "Mod+Shift+L",
    () =>
      set("visibility", draft.visibility === "private" ? "public" : "private"),
    { target: formRef, enabled: !busy && !closing, ignoreInputs: false, requireReset: true },
  );
  function set<K extends keyof MediaDraft>(key: K, value: MediaDraft[K]) {
    if (draftLockedRef.current) return;
    dirty.current.add(key);
    changed.current.add(key);
    setDraft((d) => ({ ...d, [key]: value }));
  }
  function changeURL(value: string) {
    if (draftLockedRef.current) return;
    abortLookup.current?.abort();
    abortBook.current?.abort();
    setLookupRequest(undefined);
    setReplacement(undefined);
    setURLChoice(undefined);
    setWarning("");
    setLookupComplete(false);
    set("url", value);
  }
  function requestDetails(replace: boolean) {
    if (draftLockedRef.current) return;
    setReplacement(undefined);
    setWarning("");
    setLookupComplete(false);
    if (replace) setURLChoice(undefined);
    setLookupRequest({ url: draft.url, replace });
    setLookupVersion(n => n + 1);
  }
  useEffect(() => {
    if (draftLockedRef.current || !item || draft.url !== item.url) return;
    setDraft((d) => {
      if (draftLockedRef.current) return d;
      const next = { ...d };
      for (const key of [
        "title",
        "author",
        "description",
        "cover_url",
        "kind",
      ] as const) {
        if (
          !dirty.current.has(key) &&
          (!d[key] || (key === "title" && isFallbackTitle(d.title, d.url)) ||
            (key === "kind" && !changed.current.has(key) && !original.current?.kind_explicit))
        ) {
          (next[key] as string) = item[key];
          if (original.current) original.current = { ...original.current, [key]: item[key], ...(key === "kind" ? { kind_explicit: item.kind_explicit } : {}) };
        }
      }
      return next;
    });
    if (!lookupVersion) {
      setWarning(item.metadata_warning || "");
      setLookupComplete(item.metadata_state !== "pending");
    }
  }, [item?.updated_at, draft.url]);
  const metadataURL = urlMode ? capture : draft.url;
  useEffect(() => {
    if (!safeURL(metadataURL) || (!urlMode && lookupRequest?.url !== metadataURL)) return;
    const abort = new AbortController();
    abortLookup.current = abort;
    const timer = setTimeout(async () => {
      if (abort.signal.aborted || draftLockedRef.current) return;
      setLoading(true);
      try {
        const metadata = await api<Metadata>("/metadata", {
          ...send("POST", { url: metadataURL }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(23_000)]),
        });
        if (abort.signal.aborted || draftLockedRef.current) return;
        if (lookupRequest?.replace && item) {
          if ((!metadata.title || isFallbackTitle(metadata.title, metadataURL)) && !metadata.author && !metadata.description && !metadata.cover_url) {
            setWarning("No replacement details were found. Your current details are unchanged. Keep them or retry.");
            return;
          }
          setReplacement({ url: metadataURL, metadata });
          setWarning(metadata.warning || "");
          return;
        }
        setDraft((d) => {
          if (draftLockedRef.current) return d;
          const next = { ...d };
          for (const key of [
            "title",
            "author",
            "description",
            "cover_url",
            "kind",
          ] as const)
            if (
              !dirty.current.has(key) &&
              (key !== "kind" || !item?.kind_explicit) &&
              (!item ||
                !d[key] ||
                (key === "title" && isFallbackTitle(d.title, metadataURL)) ||
                (key === "kind" && !item?.kind_explicit))
            ) {
              (next[key] as string) =
                metadata[key] || (key === "kind" ? "article" : "");
              changed.current.add(key);
            }
          return next;
        });
        setWarning(metadata.warning || "");
        setLookupComplete(true);
      } catch {
        if (!abort.signal.aborted && !draftLockedRef.current)
          setWarning(
            lookupRequest?.replace
              ? "Replacement details are unavailable. Your current details are unchanged. Keep them or retry."
              : "Details are unavailable. You can still save this link and edit it later.",
          );
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      abort.abort();
      setLoading(false);
    };
  }, [metadataURL, urlMode, lookupVersion, lookupRequest]);
  // A title or ISBN with Type=Book resolves automatically; choosing another
  // match is optional. Existing items are looked up only on explicit request.
  const automaticBookQuery =
    !item && !urlMode && draft.kind === "book" ? capture : "";
  useEffect(() => {
    const query = bookRequest ? bookQuery : automaticBookQuery;
    if (!query.trim() || (!automaticBookQuery && !bookRequest)) return;
    const abort = new AbortController();
    abortBook.current = abort;
    const timer = setTimeout(
      async () => {
        if (abort.signal.aborted || draftLockedRef.current) return;
        setBookLoading(true);
        setBookWarning("");
        try {
          const data = await api<{ items: Metadata[]; warning?: string }>(
            "/books/search",
            {
              ...send("POST", { query, author: authorQuery || draft.author }),
              signal: abort.signal,
            },
          );
          if (abort.signal.aborted || draftLockedRef.current) return;
          setMatches(data.items);
          setBookWarning(
            data.warning ||
              (!data.items.length
                ? "No match found. Keep your title or try another search."
                : ""),
          );
          if (!bookRequest && data.items[0]) applyBook(data.items[0], false);
        } catch {
          if (!abort.signal.aborted)
            setBookWarning(
              "Book lookup is unavailable. You can still save your details.",
            );
        } finally {
          if (!abort.signal.aborted) setBookLoading(false);
        }
      },
      bookRequest ? 0 : 650,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
      setBookLoading(false);
    };
  }, [automaticBookQuery, bookRequest, authorQuery]);
  function applyBook(book: Metadata, explicit: boolean) {
    if (draftLockedRef.current) return;
    if (explicit) dirty.current.add("kind");
    setLookupComplete(true);
    setDraft((d) => {
      if (draftLockedRef.current) return d;
      const next = { ...d, kind: "book" as const };
      for (const key of ["title", "author", "cover_url"] as const)
        if (explicit || !dirty.current.has(key)) {
          next[key] = book[key];
          changed.current.add(key);
        }
      changed.current.add("kind");
      if (!item && !urlMode && (explicit || !dirty.current.has("url")))
        next.url = book.url;
      return next;
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || draftLockedRef.current || confirm) return;
    setError("");
    setDuplicate(undefined);
    setConflict(false);
    const title =
      draft.title.trim() || (urlMode ? hostname(capture) : capture.trim());
    if (!title) {
      setError("Add a title or a link.");
      return;
    }
    if (draft.url && !safeURL(draft.url)) {
      setError("Use a complete HTTP or HTTPS link.");
      return;
    }
    if (needsURLChoice && !urlResolved) {
      setError("Choose whether to keep or replace the details for this new link before saving.");
      return;
    }
    setSaving(true);
    draftLockedRef.current = true;
    abortLookup.current?.abort();
    abortBook.current?.abort();
    setLoading(false);
    setBookLoading(false);
    try {
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      const saveDone = !item && submitter instanceof HTMLButtonElement && submitter.value === "done";
      const values = { ...draft, ...(saveDone ? { status: "done" as const } : {}), title, tags: draftTags };
      // A different work rebinds its metadata snapshot. Position corrections in
      // the same document stay sparse so they preserve pending enrichment.
      const rebound = item && changed.current.has("url") &&
        detailsIdentity(draft.url) !== detailsIdentity(original.current?.url || "");
      const metadataKeys = ["title", "author", "description", "cover_url", "kind"];
      const keys = (Object.keys(emptyDraft()) as (keyof MediaDraft)[]).filter(key =>
        !item || rebound && metadataKeys.includes(key) || changed.current.has(key) && (key === "kind" || JSON.stringify(values[key]) !== JSON.stringify(original.current?.[key])),
      );
      const payload: Record<string, unknown> = Object.fromEntries(keys.map(key => [key, values[key]]));
      const expected: Record<string, unknown> = Object.fromEntries(keys.map(key => [key, original.current?.[key]]));
      if (item && keys.includes("kind")) {
        expected.kind_explicit = original.current?.kind_explicit;
        payload.infer_kind = !dirty.current.has("kind") && !original.current?.kind_explicit;
      }
      if (!item) payload.infer_kind = !dirty.current.has("kind");
      if (draft.url && (!item || lookupVersion || rebound)) {
        if (item) payload.expected_url = original.current?.url;
        payload.fetch_metadata =
          rebound ? false : !lookupComplete ||
          Boolean(item?.metadata_state === "pending" && !lookupVersion);
        payload.metadata_warning = warning;
      }
      if (item?.needs_review && markReviewed) {
        payload.needs_review = false;
        expected.needs_review = original.current?.needs_review;
      }
      if (item) payload.expected = expected;
      result.current = await api<Media>(
        item ? "/media/" + item.id : "/media",
        send(item ? "PATCH" : "POST", payload),
      );
      setClosing(true);
    } catch (e) {
      setError(e instanceof ApiError && e.existingId ? "" : e instanceof Error ? e.message : "Could not save this item.");
      if (e instanceof ApiError) {
        setDuplicate(e.existingId);
        setConflict(e.code === "edit_conflict");
      }
    } finally {
      if (!result.current) draftLockedRef.current = false;
      setSaving(false);
    }
  }
  return (
    <Modal
      className="editor-modal"
      title={item ? "Edit item" : "Keep something good."}
      description={
        item
          ? undefined
          : "A title, ISBN, or link. Save now; refine whenever you like."
      }
      busy={busy || closing}
      closeRequested={closing}
      focusTitle={false}
      fallbackFocus={fallbackFocus}
      onClose={() => {
        if (result.current) {
          memory.current = undefined;
          onSaved(result.current);
        } else {
          if (discardOnClose.current) memory.current = undefined;
          onClose(discardOnClose.current);
        }
      }}
      onDismissStart={() => {
        draftLockedRef.current = true;
        setClosing(true);
      }}
    >
      <form ref={formRef} onSubmit={submit}>
        <fieldset className="editor-fields" disabled={busy || closing}>
        {!item && (
          <FormField label="Title or URL">
            <Input
              autoFocus
              required
              value={capture}
              placeholder="Paste a link, ISBN, or title…"
              onChange={(e) => {
                if (draftLockedRef.current) return;
                const value = e.target.value;
                const link = safeURL(value);
                setCapture(value);
                setWarning("");
                setLookupComplete(false);
                setMatches([]);
                setBookRequest(0);
                setBookQuery(link ? "" : value);
                setBookWarning("");
                setDraft((d) => ({
                  ...d,
                  title: link ? "" : value,
                  url: link ? value : "",
                  kind: /^\s*(?:97[89][- ]?)?[\dXx][- \dXx]{8,16}\s*$/.test(
                    value,
                  )
                    ? "book"
                    : d.kind,
                  ...Object.fromEntries(
                    ["author", "cover_url", "description"]
                      .filter((key) => !dirty.current.has(key))
                      .map((key) => [key, ""]),
                  ),
                }));
                dirty.current.delete("title");
              }}
            />
          </FormField>
        )}
        {loading && (
          <p role="status" className="fetch-state">
            <Icon name="sync" size={14} className="spin" />
            Finding details… You can save now.
          </p>
        )}
        {warning && (
          <p role="status" className="notice warning">
            {warning}
          </p>
        )}
        {(item || urlMode || draft.kind === "book") && (
          <div className="editor-title">
            <FormField label="Title">
              <Input
                ref={titleRef}
                autoFocus={Boolean(item)}
                value={draft.title}
                maxLength={500}
                onChange={(e) => set("title", e.target.value)}
              />
            </FormField>
            {item && (
              <FormField label="URL (optional)">
                <Input
                  type="url"
                  value={draft.url}
                  placeholder="https://…"
                  onChange={(e) => {
                    changeURL(e.target.value);
                  }}
                />
              </FormField>
            )}
          </div>
        )}
        {needsURLChoice && (
          <section className="notice grid gap-2" aria-label="New link details">
            <p>This link may be a different work. Keep the current details for a link correction, or fetch replacement details.</p>
            <p className="quiet">Your note, tags, status and visibility stay as they are.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" aria-pressed={urlResolved && urlChoice?.mode === "keep"}
                onClick={() => {
                  if (draftLockedRef.current) return;
                  abortLookup.current?.abort();
                  setLoading(false);
                  setLookupRequest(undefined);
                  setReplacement(undefined);
                  setWarning("");
                  setLookupComplete(true);
                  setURLChoice({ url: draft.url, mode: "keep" });
                  setError("");
                }}>
                Keep details · link correction
              </Button>
              <Button type="button" variant="secondary" size="sm" loading={loading} onClick={() => requestDetails(true)}>
                {warning ? "Retry replacement details" : "Fetch replacement details"}
              </Button>
            </div>
            {urlResolved && urlChoice?.mode === "keep" && <p role="status" className="quiet">Current details will be kept for this link.</p>}
            {replacement?.url === draft.url && (
              <section className="grid gap-2" aria-label="Replacement details preview">
                <p><strong>{replacement.metadata.title || hostname(draft.url)}</strong>{replacement.metadata.author ? ` · ${replacement.metadata.author}` : ""}</p>
                {replacement.metadata.description && <p className="line-clamp-3 text-xs">{replacement.metadata.description}</p>}
                {replacement.metadata.cover_url && <MiniCover kind={replacement.metadata.kind || draft.kind} url={replacement.metadata.cover_url} naturalArtwork={naturalArtwork} />}
                <p className="quiet">Using these details replaces the title, creator, description and image, including fields the link leaves empty. A type you chose is kept.</p>
                <Button type="button" variant="secondary" size="sm" onClick={() => {
                  if (draftLockedRef.current || replacement.url !== draft.url) return;
                  const metadata = replacement.metadata;
                  const values = { title: metadata.title || hostname(draft.url), author: metadata.author || "", description: metadata.description || "", cover_url: metadata.cover_url || "" };
                  for (const key of Object.keys(values)) {
                    dirty.current.add(key);
                    changed.current.add(key);
                  }
                  const replaceKind = !dirty.current.has("kind") && !original.current?.kind_explicit;
                  if (replaceKind) changed.current.add("kind");
                  setDraft(d => ({ ...d, ...values, ...(replaceKind ? { kind: metadata.kind || "article" } : {}) }));
                  setDetailsURL(draft.url);
                  setURLChoice({ url: draft.url, mode: "replace" });
                  setLookupComplete(true);
                  setLookupRequest(undefined);
                  setReplacement(undefined);
                  setError("");
                }}>Use fetched details</Button>
              </section>
            )}
          </section>
        )}
        {safeURL(draft.url) && (
          <section className="editor-metadata" aria-label="Link details">
            {draft.cover_url && (
              <MiniCover kind={draft.kind} url={draft.cover_url} naturalArtwork={naturalArtwork} />
            )}
            <div className="min-w-0 flex-1">
              <a
                className="text-link block truncate text-xs"
                href={safeURL(draft.url)}
                target="_blank"
                rel="noreferrer"
              >
                {hostname(draft.url)} <Icon name="external" size={12} />
              </a>
              {draft.author && (
                <p className="mt-1 text-xs text-u-muted">{draft.author}</p>
              )}
              {draft.description && (
                <p className="mt-1 line-clamp-2 text-xs text-u-muted">
                  {draft.description}
                </p>
              )}
              {item?.metadata_state === "pending" && !loading && (
                <p role="status" className="mt-1 text-xs text-u-muted">
                  Details are being fetched in the background.
                </p>
              )}
              {!needsURLChoice && <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={loading}
                disabled={busy || closing}
                onClick={() => {
                  if (draftLockedRef.current) return;
                  requestDetails(false);
                }}
              >
                {warning ? "Retry details" : "Find missing details"}
              </Button>}
            </div>
          </section>
        )}
        {item?.needs_review && (
          <label className="my-3 flex items-center gap-2 text-xs">
            <Checkbox
              checked={markReviewed}
              disabled={busy || closing}
              onCheckedChange={value => { if (!draftLockedRef.current) setMarkReviewed(value); }}
            />
            Mark reviewed when saving
          </label>
        )}
        <div className="form-grid editor-options">
          <FormField label="Type">
            <Picker
              label="Type"
              disabled={busy || closing}
              value={!item && urlMode && !dirty.current.has("kind") ? "auto" : draft.kind}
              onChange={(v) => {
                if (draftLockedRef.current) return;
                if (v === "auto") {
                  dirty.current.delete("kind");
                  changed.current.delete("kind");
                  setLookupComplete(false);
                  setLookupVersion(n => n + 1);
                } else set("kind", v);
              }}
              options={[
                ...(!item && urlMode ? [{ value: "auto" as const, label: "Automatic · " + kindLabels[draft.kind] }] : []),
                ...kinds.map((k) => ({ value: k, label: kindLabels[k] })),
              ]}
            />
          </FormField>
          <FormField label="Visibility">
            <Picker
              label="Visibility"
              disabled={busy || closing}
              value={draft.visibility}
              onChange={(v) => set("visibility", v)}
              options={[
                { value: "private", label: "Private · only you" },
                { value: "public", label: "Public · collection" },
              ]}
            />
          </FormField>
        </div>
        {draft.kind === "book" && (
          <section className="book-lookup" aria-label="Book matching">
            <FormField label="Creator (optional)">
              <Input
                value={draft.author}
                maxLength={500}
                placeholder="Author…"
                onChange={(e) => {
                  if (draftLockedRef.current) return;
                  set("author", e.target.value);
                  setAuthorQuery(e.target.value);
                }}
              />
            </FormField>
            {bookLoading && (
              <p role="status" className="quiet">
                Finding the most likely edition…
              </p>
            )}
            {bookWarning && (
              <div className="grid gap-2">
                <p role="status" className="quiet">{bookWarning}</p>
                <Button type="button" variant="secondary" size="sm" disabled={bookLoading} onClick={() => {
                  if (draftLockedRef.current) return;
                  setBookQuery(bookRequest ? bookQuery : automaticBookQuery || draft.title);
                  setCorrecting(true);
                  setBookRequest(n => n + 1);
                }}>Retry book lookup</Button>
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (draftLockedRef.current) return;
                setCorrecting((v) => !v);
                setBookQuery(draft.title || capture);
              }}
            >
              {" "}
              {correcting ? "Hide book search" : "Correct book match"}
            </Button>
            {correcting && (
              <div className="grid gap-2">
                <FormField label="Book title, author, or ISBN">
                  <Input
                    autoFocus
                    value={bookQuery}
                    onChange={(e) => { if (!draftLockedRef.current) setBookQuery(e.target.value); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !draftLockedRef.current) {
                        e.preventDefault();
                        setBookRequest((n) => n + 1);
                      }
                    }}
                  />
                </FormField>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={bookLoading}
                  onClick={() => { if (!draftLockedRef.current) setBookRequest((n) => n + 1); }}
                >
                  Find book
                </Button>
                <fieldset className="book-matches">
                  <legend className="quiet">
                    Choose a match · arrow keys move between editions
                  </legend>
                  {matches.map((book) => (
                    <label key={book.url} className="book-match">
                      <input
                        type="radio"
                        name="book-match"
                        checked={
                          draft.title === book.title &&
                          draft.author === book.author &&
                          (urlMode || item
                            ? draft.cover_url === book.cover_url
                            : draft.url === book.url)
                        }
                        onChange={() => applyBook(book, true)}
                      />
                      <MiniCover kind="book" url={book.cover_url} naturalArtwork />
                      <span>
                        {book.title}
                        <small>{book.author}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </div>
            )}
          </section>
        )}
        {draft.visibility === "public" && (
          <p className="visibility-hint">
            <Icon name="globe" size={14} />
            Details will be public. Your note stays private.
          </p>
        )}
        {item && (
          <FormField label="Status">
            <Picker
              label="Status"
              disabled={busy || closing}
              value={draft.status}
              onChange={(v) => set("status", v)}
              options={[
                { value: "pending", label: "To read/watch" },
                { value: "done", label: "Done" },
              ]}
            />
          </FormField>
        )}
        <details
          className="extra-details"
          open={details}
          onToggle={(e) => {
            if (draftLockedRef.current) e.currentTarget.open = details;
            else setDetails(e.currentTarget.open);
          }}
        >
          <ActionHint
            label="Show or hide item details"
            shortcut={formatForDisplay("Mod+Shift+D")}
          >
            <summary aria-disabled={draftLocked || undefined} onClick={event => { if (draftLockedRef.current) event.preventDefault(); }}>
              Details, image & note <Icon name="chevron" size={15} />
            </summary>
          </ActionHint>
          <div className="details-fields">
            {!item && !urlMode && (
              <FormField label="URL (optional)">
                <Input
                  type="url"
                  value={draft.url}
                  placeholder="https://…"
                  onChange={(e) => {
                    set("url", e.target.value);
                    setLookupComplete(false);
                  }}
                />
              </FormField>
            )}
            {draft.kind !== "book" && (
              <FormField label="Creator (optional)">
                <Input
                  value={draft.author}
                  maxLength={500}
                  placeholder="Author, director, studio…"
                  onChange={(e) => set("author", e.target.value)}
                />
              </FormField>
            )}
            <div className="editor-image">
              <MiniCover kind={draft.kind} url={draft.cover_url} naturalArtwork={naturalArtwork} />
              <div className="editor-image-fields">
                <FormField label="Image URL (optional)">
                  <Input
                    value={draft.cover_url}
                    placeholder="https://…"
                    onChange={(e) => set("cover_url", e.target.value)}
                  />
                </FormField>
                <FormField label="Upload image">
                  <input
                    type="file"
                    aria-label="Upload image"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy}
                    onChange={async (e) => {
                      if (draftLockedRef.current || uploading) return;
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setUploading(true);
                      setError("");
                      try {
                        const blob = await optimizeImage(file);
                        const uploaded = await api<{ url: string }>("/images", {
                          method: "POST",
                          body: blob,
                          headers: { "Content-Type": "image/jpeg" },
                        });
                        set("cover_url", uploaded.url);
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Could not upload this image.",
                        );
                      } finally {
                        setUploading(false);
                      }
                    }}
                  />
                </FormField>
                {uploading && (
                  <p role="status" className="quiet">
                    Optimizing and uploading image…
                  </p>
                )}
              </div>
            </div>
            <FormField label="Tags (optional)" hint="Separate with commas.">
              <Input
                value={tags}
                maxLength={500}
                placeholder="Design, fiction…"
                onChange={(e) => { if (!draftLockedRef.current) { changed.current.add("tags"); setTags(e.target.value); } }}
              />
            </FormField>
            <FormField label="Description (optional)">
              <Textarea
                rows={2}
                maxLength={20000}
                value={draft.description}
                onValueChange={(v) => set("description", String(v))}
              />
            </FormField>
            <FormField label="Private note">
              <Textarea
                rows={3}
                maxLength={20000}
                value={draft.notes}
                placeholder="A thought to return to…"
                onValueChange={(v) => set("notes", String(v))}
              />
            </FormField>
            {item?.selected_text && (
              <section className="grid gap-2" aria-label="Saved selection (private)">
                <p className="quiet">Saved selection · private</p>
                <blockquote className="whitespace-pre-wrap break-words text-sm">{item.selected_text}</blockquote>
                {safeURL(item.selected_text_source_url || "") && (
                  <a className="text-link break-all text-xs" href={safeURL(item.selected_text_source_url || "")} target="_blank" rel="noreferrer">
                    Selection source: {item.selected_text_source_url}
                  </a>
                )}
              </section>
            )}
          </div>
        </details>
        {item?.visibility === "public" && draft.visibility === "public" && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(publicPath(item.id));
                setCopied(true);
              } catch {
                setError("Copy this address: " + publicPath(item.id));
              }
            }}
          >
            <Icon name="copy" size={14} />
            {copied ? "Link copied" : "Copy public link"}
          </Button>
        )}
        {(error || duplicate) && (
          <div ref={errorRef} className={"notice" + (duplicate ? "" : " error")} role={duplicate ? "status" : "alert"} tabIndex={-1}>
            {duplicate ? <><p>Already saved</p><p className="quiet">The existing item is unchanged. Your unsaved draft stays here until you save or explicitly discard it. Opening the existing item discards this draft, including any new note.</p></> : error}
            {conflict && item && (
              <>
                <p>
                  Reloading discards all unsaved changes, including notes. Copy
                  anything you want to keep first.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  loading={reloading}
                  onClick={async () => {
                    if (draftLockedRef.current) return;
                    draftLockedRef.current = true;
                    setReloading(true);
                    abortLookup.current?.abort();
                    abortBook.current?.abort();
                    setLoading(false);
                    setBookLoading(false);
                    try {
                      const latest = (await api<Media[]>("/media")).find(
                        (m) => m.id === item.id,
                      );
                      if (!latest) throw new Error("This item has been removed.");
                      original.current = latest;
                      dirty.current.clear();
                      changed.current.clear();
                      setDraft({ ...emptyDraft(), ...latest });
                      setTags(latest.tags.join(", "));
                      setMarkReviewed(Boolean(latest.needs_review));
                      setWarning(latest.metadata_warning || "");
                      setLookupComplete(latest.metadata_state !== "pending");
                      setLookupVersion(0);
                      setLookupRequest(undefined);
                      setReplacement(undefined);
                      setURLChoice(undefined);
                      setDetailsURL(latest.url);
                      focusAfterReload.current = true;
                      setConflict(false);
                      setError("");
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Could not reload this item.");
                    } finally {
                      draftLockedRef.current = false;
                      setReloading(false);
                    }
                  }}
                >
                  <span role={reloading ? "status" : undefined}>{reloading ? "Reloading latest item…" : "Discard changes and reload"}</span>
                </Button>
              </>
            )}
            {duplicate && (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => {
                  if (draftLockedRef.current) return;
                  memory.current = undefined;
                  onDuplicate(duplicate);
                }}
              >
                Discard draft and open existing item <Icon name="arrow" size={14} />
              </Button>
            )}
          </div>
        )}
        {confirm && item && (
          <div className="delete-confirm">
            <p>Remove this item from your library?</p>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setConfirm(false)}
            >
              Keep it
            </Button>
            <Button
              variant="danger"
              size="sm"
              type="button"
              loading={saving}
              onClick={async () => {
                if (busy || draftLockedRef.current) return;
                draftLockedRef.current = true;
                setSaving(true);
                try {
                  await onDelete(item);
                  discardOnClose.current = true;
                  setClosing(true);
                } catch (e) {
                  draftLockedRef.current = false;
                  setError(
                    e instanceof Error ? e.message : "Could not remove item.",
                  );
                } finally {
                  setSaving(false);
                }
              }}
            >
              Remove item
            </Button>
          </div>
        )}
        <div className="modal-footer">
          <span>
            {item ? (
              <Button
                variant="ghost"
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => setConfirm(true)}
              >
                <Icon name="trash" size={15} />
                Remove
              </Button>
            ) : (
              <span className="quiet">
                <Icon name="lock" size={13} />
                {draft.visibility === "private"
                  ? "Private by default"
                  : "Public collection"}
              </span>
            )}
          </span>
          <div>
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                if (draftLockedRef.current) return;
                draftLockedRef.current = true;
                setClosing(true);
              }}
            >
              Cancel
            </Button>
            <ActionHint
              label="Save item"
              shortcut={formatForDisplay("Mod+Enter")}
            >
              <Button
                type="submit"
                loading={saving}
                disabled={uploading || reloading || closing}
                aria-keyshortcuts="Control+Enter Meta+Enter"
              >
                {item
                  ? item.needs_review && markReviewed
                    ? "Save & review"
                    : "Save changes"
                  : "Add to library"}
              </Button>
            </ActionHint>
            {!item && <Button type="submit" name="intent" value="done" variant="secondary" disabled={busy || closing}>
              Save as Done
            </Button>}
          </div>
        </div>
        </fieldset>
      </form>
    </Modal>
  );
}
