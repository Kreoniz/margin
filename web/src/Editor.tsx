import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "unlikely-ui/button";
import { Input } from "unlikely-ui/input";
import { Textarea } from "unlikely-ui/textarea";
import { formatForDisplay, useHotkey } from "@tanstack/react-hotkeys";
import { Dialog } from "unlikely-ui/dialog";
import { api, ApiError, send } from "./api";
import { FormField, Modal, Picker } from "./components";
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
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const dirty = useRef(new Set<string>());
  const previous = useRef<Partial<Metadata>>({});
  const fetched = useRef("");
  const urlMode = !item && Boolean(safeURL(capture));
  const metadataPending = urlMode && capture !== fetched.current;
  const formRef = useRef<HTMLFormElement>(null);
  useHotkey("Mod+Enter", () => formRef.current?.requestSubmit(), {
    target: formRef,
    enabled: !saving && !loading && !metadataPending && !confirm,
    ignoreInputs: false,
    requireReset: true,
  });
  function set<K extends keyof MediaDraft>(key: K, value: MediaDraft[K]) {
    dirty.current.add(key);
    setDraft((d) => ({ ...d, [key]: value }));
  }
  useEffect(() => {
    if (!urlMode || capture === fetched.current) return;
    const abort = new AbortController();
    const requested = capture;
    const timer = setTimeout(async () => {
      setLoading(true);
      setWarning("");
      try {
        const metadata = await api<Metadata>("/metadata", {
          ...send("POST", { url: requested }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(23_000)]),
        });
        if (abort.signal.aborted) return;
        const old = previous.current;
        setDraft((d) => {
          const next = { ...d };
          for (const key of [
            "title",
            "author",
            "description",
            "cover_url",
          ] as const)
            if (!dirty.current.has(key) || d[key] === old[key])
              next[key] = metadata[key] || "";
          if (!dirty.current.has("kind"))
            next.kind = metadata.kind || "article";
          next.url = safeURL(metadata.url) || requested;
          return next;
        });
        previous.current = metadata;
        fetched.current = safeURL(metadata.url) || requested;
        setCapture(fetched.current);
        setWarning(metadata.warning || "");
      } catch (e) {
        if (!abort.signal.aborted) {
          fetched.current = requested;
          setWarning(
            "Details could not be fetched. Add a title below, or save the link as it is.",
          );
          setDraft((d) => ({ ...d, title: d.title || hostname(requested) }));
        }
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
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (metadataPending || loading || saving) return;
    setError("");
    setDuplicate(undefined);
    if (!draft.title.trim() && !draft.url.trim()) {
      setError("Add a title or a link.");
      return;
    }
    if (draft.url && !safeURL(draft.url)) {
      setError("Use a complete HTTP or HTTPS link.");
      return;
    }
    setSaving(true);
    try {
      const payload = Object.fromEntries(
        Object.keys(emptyDraft()).map((key) => [
          key,
          draft[key as keyof MediaDraft],
        ]),
      );
      if (!item && draft.url) {
        if (!draft.title.trim()) delete payload.title;
        for (const key of [
          "title",
          "author",
          "description",
          "cover_url",
        ] as const) {
          if (!draft[key] && !dirty.current.has(key)) delete payload[key];
        }
      }
      payload.tags = [
        ...new Set(
          tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ];
      const result = await api<Media>(
        item ? "/media/" + item.id : "/media",
        send(item ? "PATCH" : "POST", payload),
      );
      onSaved(result);
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
        item ? undefined : "A title is enough. A link can fill in the rest."
      }
      onClose={onClose}
      busy={saving}
    >
      <form ref={formRef} onSubmit={submit}>
        {!item && (
          <FormField label="Title or URL">
            <Input
              autoFocus
              required
              value={capture}
              placeholder="Paste a link or type a title…"
              onChange={(e) => {
                const value = e.target.value;
                fetched.current = "";
                setCapture(value);
                const link = safeURL(value);
                setWarning("");
                setLoading(Boolean(link && value !== fetched.current));
                setDraft((d) => {
                  const next = {
                    ...d,
                    url: link ? value : "",
                    title: link ? "" : value,
                  };
                  if (link && dirty.current.has("title")) next.title = d.title;
                  for (const key of [
                    "author",
                    "description",
                    "cover_url",
                  ] as const)
                    if (!dirty.current.has(key)) next[key] = "";
                  if (!dirty.current.has("kind")) next.kind = "article";
                  return next;
                });
              }}
            />
          </FormField>
        )}
        {loading && (
          <p role="status" className="fetch-state">
            <Icon name="sync" size={14} className="spin" />
            Finding the details…
          </p>
        )}
        {warning && (
          <p role="status" className="notice warning">
            {warning}
          </p>
        )}
        {(item || urlMode) && (
          <div className="editor-title">
            <FormField label="Title">
              <Input
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
                  onChange={(e) => set("url", e.target.value)}
                />
              </FormField>
            )}
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
                { value: "public", label: "Public · shared page" },
              ]}
            />
          </FormField>
        </div>
        {draft.visibility === "public" && (
          <p className="visibility-hint">
            <Icon name="globe" size={14} />
            Title, link and details will be public. Your note stays private.
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
        <details className="extra-details" open={Boolean(item)}>
          <summary>
            Details & note <Icon name="chevron" size={15} />
          </summary>
          <div className="details-fields">
            <FormField label="Creator (optional)">
              <Input
                value={draft.author}
                maxLength={500}
                placeholder="Author, director, studio…"
                onChange={(e) => set("author", e.target.value)}
              />
            </FormField>
            <FormField
              label="Tags (optional)"
              hint="A few words, separated by commas."
            >
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
                placeholder="Why you saved it, a thought to return to…"
                onValueChange={(v) => set("notes", String(v))}
              />
            </FormField>
          </div>
        </details>
        {item &&
          draft.visibility === "public" &&
          item.visibility === "public" && (
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
                disabled={saving}
                onClick={() => setConfirm(true)}
              >
                <Icon name="trash" size={15} />
                Remove
              </Button>
            ) : (
              <span className="quiet">
                <Icon name="lock" size={13} />
                Private by default
              </span>
            )}
          </span>
          <div>
            <Dialog.Close
              render={
                <Button variant="ghost" type="button" disabled={saving} />
              }
            >
              Cancel
            </Dialog.Close>
            <Button
              type="submit"
              loading={saving}
              disabled={loading || metadataPending}
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
