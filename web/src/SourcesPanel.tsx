import { useState, type FormEvent } from "react";
import { Button } from "unlikely-ui/button";
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
  perform,
  pending,
}: {
  sources: Source[];
  onClose: () => void;
  onChanged: () => Promise<void>;
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
  async function add(e: FormEvent) {
    e.preventDefault();
    if (adding) return;
    setAdding(true);
    setError("");
    try {
      await api("/sources", send("POST", { url }));
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
      <div className="source-list">
        {sources.map((source) => (
          <section
            className="source-row"
            key={source.id}
            aria-label={source.name}
          >
            <div className="source-heading">
              <SourceMark name={source.name} />
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
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={
                  (source.enabled ? "Pause " : "Resume ") + source.name
                }
                disabled={pending.has(source.id)}
                onClick={() =>
                  void perform(source.id, () =>
                    api(
                      "/sources/" + source.id,
                      send("PATCH", { enabled: !source.enabled }),
                    ),
                  )
                }
              >
                <Icon name={source.enabled ? "pause" : "sync"} size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={"Remove " + source.name}
                disabled={pending.has(source.id)}
                onClick={() => setRemoving(source.id)}
              >
                <Icon name="close" size={16} />
              </Button>
            </div>
            <div className="source-options">
              <label className="source-auto-save">
                <Checkbox
                  checked={source.auto_save}
                  disabled={pending.has(source.id)}
                  onCheckedChange={(value) =>
                    void perform(source.id, () =>
                      api(
                        "/sources/" + source.id,
                        send("PATCH", { auto_save: Boolean(value) }),
                      ),
                    )
                  }
                />
                <span className="min-w-0">Auto-save new articles</span>
              </label>
              <Picker
                label={"Check frequency for " + source.name}
                disabled={pending.has(source.id)}
                value={String(source.interval_minutes)}
                onChange={(value) =>
                  void perform(source.id, () =>
                    api(
                      "/sources/" + source.id,
                      send("PATCH", { interval_minutes: Number(value) }),
                    ),
                  )
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
              {source.auto_save && (
                <span> · Future articles save privately</span>
              )}
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
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRemoving("")}
                >
                  Keep following
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={pending.has(source.id)}
                  onClick={async () => {
                    if (
                      await perform(source.id, () =>
                        api("/sources/" + source.id, send("DELETE")),
                      )
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
        Existing discoveries stay where you left them.
      </p>
    </Modal>
  );
}
