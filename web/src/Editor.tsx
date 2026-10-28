import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "unlikely-ui/button";
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
import { hostname, publicPath, safeURL } from "./utils";
import { optimizeImage } from "./images";

export function Editor({
  item,
  onClose,
  onSaved,
  onDelete,
  onDuplicate,
}: {
  item?: Media;
  onClose: () => void;
  onSaved: (item: Media) => void;
  onDelete: (item: Media) => Promise<void>;
  onDuplicate: (id: string) => void;
}) {
  const [draft, setDraft] = useState<MediaDraft>(() => ({
    ...emptyDraft(),
    ...item,
  }));
  const [capture, setCapture] = useState("");
  const [tags, setTags] = useState(item?.tags.join(", ") || "");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [details, setDetails] = useState(false);
  const [closing, setClosing] = useState(false);
  const [matches, setMatches] = useState<Metadata[]>([]);
  const [correcting, setCorrecting] = useState(false);
  const [bookQuery, setBookQuery] = useState("");
  const [bookRequest, setBookRequest] = useState(0);
  const [bookLoading, setBookLoading] = useState(false);
  const [bookWarning, setBookWarning] = useState("");
  const dirty = useRef(new Set<string>());
  const abortLookup = useRef<AbortController | null>(null);
  const result = useRef<Media | undefined>(undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const urlMode = !item && Boolean(safeURL(capture));
  const busy = saving || uploading;
  useHotkey("Mod+Enter", () => formRef.current?.requestSubmit(), {
    target: formRef,
    enabled: !busy && !confirm && !closing,
    ignoreInputs: false,
    requireReset: true,
  });
  useHotkey("Mod+Shift+D", () => setDetails((value) => !value), {
    target: formRef,
    ignoreInputs: false,
    requireReset: true,
  });
  useHotkey(
    "Mod+Shift+L",
    () =>
      set("visibility", draft.visibility === "private" ? "public" : "private"),
    { target: formRef, ignoreInputs: false, requireReset: true },
  );
  function set<K extends keyof MediaDraft>(key: K, value: MediaDraft[K]) {
    dirty.current.add(key);
    setDraft((d) => ({ ...d, [key]: value }));
  }
  useEffect(() => {
    if (!urlMode) return;
    const abort = new AbortController();
    abortLookup.current = abort;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const metadata = await api<Metadata>("/metadata", {
          ...send("POST", { url: capture }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(23_000)]),
        });
        if (abort.signal.aborted) return;
        setDraft((d) => {
          const next = { ...d };
          for (const key of [
            "title",
            "author",
            "description",
            "cover_url",
            "kind",
          ] as const)
            if (!dirty.current.has(key))
              (next[key] as string) =
                metadata[key] || (key === "kind" ? "article" : "");
          return next;
        });
        setWarning(metadata.warning || "");
      } catch {
        if (!abort.signal.aborted)
          setWarning(
            "Details are unavailable. You can still save this link and edit it later.",
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
  }, [capture, urlMode]);
  // A title or ISBN with Type=Book resolves automatically; choosing another
  // match is optional. Existing items are looked up only on explicit request.
  const automaticBookQuery =
    !item && !urlMode && draft.kind === "book" ? capture : "";
  useEffect(() => {
    const query = bookRequest ? bookQuery : automaticBookQuery;
    if (!query.trim() || (!automaticBookQuery && !bookRequest)) return;
    const abort = new AbortController();
    const timer = setTimeout(
      async () => {
        setBookLoading(true);
        setBookWarning("");
        try {
          const data = await api<{ items: Metadata[]; warning?: string }>(
            "/books/search",
            {
              ...send("POST", { query, author: draft.author }),
              signal: abort.signal,
            },
          );
          if (abort.signal.aborted) return;
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
  }, [automaticBookQuery, bookRequest]);
  function applyBook(book: Metadata, explicit: boolean) {
    setDraft((d) => {
      const next = { ...d, kind: "book" as const };
      for (const key of ["title", "author", "cover_url"] as const)
        if (explicit || !dirty.current.has(key)) next[key] = book[key];
      if (!item && !urlMode && (explicit || !dirty.current.has("url")))
        next.url = book.url;
      return next;
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || closing || confirm) return;
    setError("");
    setDuplicate(undefined);
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
    setSaving(true);
    abortLookup.current?.abort();
    try {
      const payload = Object.fromEntries(
        Object.keys(emptyDraft()).map((key) => [
          key,
          draft[key as keyof MediaDraft],
        ]),
      );
      payload.title = title;
      payload.tags = [
        ...new Set(
          tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ];
      result.current = await api<Media>(
        item ? "/media/" + item.id : "/media",
        send(item ? "PATCH" : "POST", payload),
      );
      setClosing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this item.");
      if (e instanceof ApiError) setDuplicate(e.existingId);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={item ? "Edit item" : "Keep something good."}
      description={
        item
          ? undefined
          : "A title, ISBN, or link. Save now; refine whenever you like."
      }
      busy={busy}
      closeRequested={closing}
      onClose={() => (result.current ? onSaved(result.current) : onClose())}
    >
      <form ref={formRef} onSubmit={submit}>
        {!item && (
          <FormField label="Title or URL">
            <Input
              autoFocus
              required
              value={capture}
              placeholder="Paste a link, ISBN, or title…"
              onChange={(e) => {
                const value = e.target.value;
                const link = safeURL(value);
                setCapture(value);
                setWarning("");
                setMatches([]);
                setBookRequest(0);
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
                autoFocus={Boolean(item)}
                value={draft.title}
                maxLength={500}
                onChange={(e) => set("title", e.target.value)}
              />
            </FormField>
          </div>
        )}
        <div className="form-grid editor-options">
          <FormField label="Type">
            <Picker
              label="Type"
              value={draft.kind}
              onChange={(v) => set("kind", v)}
              options={kinds.map((k) => ({ value: k, label: kindLabels[k] }))}
            />
          </FormField>
          <FormField label="Visibility">
            <Picker
              label="Visibility"
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
                onChange={(e) => set("author", e.target.value)}
              />
            </FormField>
            {bookLoading && (
              <p role="status" className="quiet">
                Finding the most likely edition…
              </p>
            )}
            {bookWarning && (
              <p role="status" className="quiet">
                {bookWarning}
              </p>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
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
                    value={bookQuery}
                    onChange={(e) => setBookQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
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
                  onClick={() => setBookRequest((n) => n + 1)}
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
                      <MiniCover kind="book" url={book.cover_url} />
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
          onToggle={(e) => setDetails(e.currentTarget.open)}
        >
          <summary>
            Details, image & note <Icon name="chevron" size={15} />
          </summary>
          <div className="details-fields">
            <FormField label="URL (optional)">
              <Input
                type="url"
                value={draft.url}
                placeholder="https://…"
                onChange={(e) => set("url", e.target.value)}
              />
            </FormField>
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
              <MiniCover kind={draft.kind} url={draft.cover_url} />
              <div className="grid min-w-0 flex-1 gap-2">
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
                onChange={(e) => setTags(e.target.value)}
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
        {error && (
          <div className="notice error" role="alert">
            {error}
            {duplicate && (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => onDuplicate(duplicate)}
              >
                Open existing item <Icon name="arrow" size={14} />
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
                setSaving(true);
                try {
                  await onDelete(item);
                  setClosing(true);
                } catch (e) {
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
              onClick={() => setClosing(true)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={saving}
              disabled={uploading || closing}
              title={`Save (${formatForDisplay("Mod+Enter")})`}
              aria-keyshortcuts="Control+Enter Meta+Enter"
            >
              {item ? "Save changes" : "Add to library"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
