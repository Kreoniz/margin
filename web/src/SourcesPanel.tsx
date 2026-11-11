import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "unlikely-ui/button";
import { ActionHint } from "./ActionHint";
import { Checkbox } from "unlikely-ui/checkbox";
import { Input } from "unlikely-ui/input";
import { api, send } from "./api";
import { FormField, Modal, Picker, SourceMark } from "./components";
import { Icon } from "./Icon";
import type { Source } from "./types";
import { hostname, relativeDate, safeURL } from "./utils";

export function SourcesPanel({
  sources,
  onClose,
  onChanged,
  onSourcesChange,
  refreshError,
  perform,
  pending,
}: {
  sources: Source[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onSourcesChange: (update: (sources: Source[]) => Source[]) => void;
  refreshError: string;
  perform: (
    key: string,
    fn: () => Promise<unknown>,
    message?: string,
  ) => Promise<boolean>;
  pending: Set<string>;
}) {
  const [url, setURL] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const removalFocus = useRef<{ target: HTMLElement | null; previous: Element | null } | undefined>(undefined);
  useLayoutEffect(() => {
    const pendingFocus = removalFocus.current;
    if (!pendingFocus || !listRef.current?.isConnected) return;
    removalFocus.current = undefined;
    const active = document.activeElement;
    if (active !== pendingFocus.previous && active !== document.body && active !== listRef.current.closest(".app-modal")) return;
    const target = pendingFocus.target?.isConnected && !pendingFocus.target.matches(":disabled, [aria-disabled='true']") ? pendingFocus.target : urlRef.current;
    target?.focus();
  }, [sources]);
  function patch(source: Source, values: Partial<Source>) {
    return perform(source.id, async () => {
      const updated = await api<Source>("/sources/" + source.id, send("PATCH", values));
      onSourcesChange(items => items.map(item => item.id === updated.id ? updated : item));
    });
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    if (adding) return;
    setAdding(true);
    setError("");
    try {
      const added = await api<Source>("/sources", send("POST", { url }));
      onSourcesChange(items => [...items.filter(item => item.id !== added.id), added]);
      setURL("");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not follow source.");
    } finally {
      setAdding(false);
    }
  }
  return (
    <Modal
      title="Your sources"
      description="Articles arrive in Discover. Auto-save sends future articles to your private list."
      onClose={onClose}
      className="sources-modal"
      busy={adding}
    >
      <form className="source-add" onSubmit={add}>
        <FormField label="Follow a website or RSS/Atom feed">
          <Input
            ref={urlRef}
            type="url"
            required
            disabled={adding}
            value={url}
            onChange={(e) => setURL(e.target.value)}
            placeholder="https://a-favorite-place.com"
          />
        </FormField>
        <Button type="submit" loading={adding}>
          <Icon name="plus" size={16} />
          Follow
        </Button>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {refreshError && <div className="notice warning" role="status">
        <p>Could not refresh sources. Saved changes are retained. {refreshError}</p>
        <Button variant="ghost" size="sm" loading={refreshing} onClick={async () => {
          setRefreshing(true);
          try { await onChanged(); } finally { setRefreshing(false); }
        }}>Refresh sources</Button>
      </div>}
      <div className="source-list" ref={listRef}>
        {sources.map((source) => (
          <section
            className="source-row"
            key={source.id}
            aria-label={source.name}
          >
            <div className="source-heading">
              <SourceMark name={source.name} url={source.site_url || source.feed_url} />
              <div className="min-w-0 flex-1">
                <h3>{source.name}</h3>
                <a
                  className="quiet"
                  href={safeURL(source.site_url || source.feed_url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="truncate">
                    {hostname(source.site_url || source.feed_url)}
                  </span>
                  <Icon name="external" size={11} />
                </a>
              </div>
              <span className="source-format">
                {source.parser === "rss" ? "RSS" : "Web parser"}
              </span>
              <ActionHint
                label={source.enabled ? "Pause source" : "Resume source"}
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    (source.enabled ? "Pause " : "Resume ") + source.name
                  }
                  disabled={pending.has(source.id)}
                  onClick={() =>
                    void patch(source, { enabled: !source.enabled })
                  }
                >
                  <Icon name={source.enabled ? "pause" : "sync"} size={15} />
                </Button>
              </ActionHint>
              <ActionHint label="Remove source">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={"Remove " + source.name}
                  disabled={pending.has(source.id)}
                  onClick={() => setRemoving(source.id)}
                >
                  <Icon name="close" size={16} />
                </Button>
              </ActionHint>
            </div>
            <div className="source-options">
              <label className="source-auto-save">
                <Checkbox
                  checked={source.auto_save}
                  disabled={pending.has(source.id)}
                  onCheckedChange={(value) =>
                    void patch(source, { auto_save: Boolean(value) })
                  }
                />
                <span className="min-w-0">Auto-save new articles</span>
              </label>
              <Picker
                label={"Check frequency for " + source.name}
                disabled={pending.has(source.id)}
                value={String(source.interval_minutes)}
                onChange={(value) =>
                  void patch(source, { interval_minutes: Number(value) })
                }
                options={[
                  ...new Set([15, 60, 360, 1440, source.interval_minutes]),
                ]
                  .sort((a, b) => a - b)
                  .map((value) => ({
                    value: String(value),
                    label:
                      value < 60
                        ? "Every " + value + " min"
                        : value === 1440
                          ? "Daily"
                          : "Every " + value / 60 + "h",
                  }))}
              />
            </div>
            <p className="source-status">
              <span
                className={source.enabled ? "source-dot" : "source-dot paused"}
              />
              {source.enabled
                ? relativeDate(source.last_sync)
                : "Collection paused"}
            </p>
            {source.last_error && (
              <p className="notice warning source-error" role="status">
                <Icon name="warning" size={13} />
                {source.last_error}
              </p>
            )}
            {removing === source.id && (
              <div className="delete-confirm">
                <p>
                  Unfollow {source.name}? Its discoveries will be removed; saved
                  library items stay.
                  Following it again starts a fresh discovery inbox.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending.has(source.id)}
                  onClick={() => setRemoving("")}
                >
                  Keep following
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={pending.has(source.id)}
                  onClick={async (event) => {
                    const row = event.currentTarget.closest(".source-row");
                    const neighbor = row?.nextElementSibling || row?.previousElementSibling;
                    const target = neighbor?.querySelector<HTMLElement>(".source-heading button") || urlRef.current;
                    if (
                      await perform(source.id, async () => {
                        await api("/sources/" + source.id, send("DELETE"));
                        if (listRef.current?.isConnected && row?.contains(document.activeElement))
                          removalFocus.current = { target, previous: document.activeElement };
                        onSourcesChange(items => items.filter(item => item.id !== source.id));
                      })
                    )
                      setRemoving("");
                  }}
                >
                  Unfollow
                </Button>
              </div>
            )}
          </section>
        ))}
      </div>
      <p className="panel-footnote">
        Pausing keeps existing discoveries. Auto-save applies to future articles;
        dates without a time may need manual saving on the day it is enabled.
      </p>
    </Modal>
  );
}
