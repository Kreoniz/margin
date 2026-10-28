import { useEffect, useState } from "react";
import { Input } from "unlikely-ui/input";
import { MiniCover, Picker, TypeLabel } from "./components";
import { api, ApiError } from "./api";
import { Icon, Logo } from "./Icon";
import { kinds, kindLabels, type Kind, type PublicMedia } from "./types";
import { hostname, safeURL, selectMedia } from "./utils";

export function Collection() {
  const id = window.location.pathname.startsWith("/shared/")
    ? window.location.pathname.split("/")[2]
    : undefined;
  const [items, setItems] = useState<PublicMedia[]>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind | "all">("all");
  useEffect(() => {
    document.title = "Collection — Margin";
    const abort = new AbortController();
    void api<PublicMedia[] | PublicMedia>(
      "/public/media" + (id ? "/" + encodeURIComponent(id) : ""),
      { signal: abort.signal },
    )
      .then((result) => setItems(Array.isArray(result) ? result : [result]))
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(
            e instanceof ApiError && e.status === 404
              ? "This item is not shared."
              : e.message,
          );
      });
    return () => abort.abort();
  }, [id]);
  const filtered = selectMedia(items || [], {
    query,
    status: "all",
    kind,
    tag: "",
  });
  return (
    <div className="shared-page">
      <header className="app-header">
        <div className="header-inner">
          <a href="/" className="brand-link" aria-label="Collection">
            <Logo small />
          </a>
          <span className="shared-label">
            <Icon name="globe" size={14} />
            Collection
          </span>
        </div>
      </header>
      <main className="content">
        <div className="page-heading">
          <div>
            <h1>
              Collection<span>.</span>
            </h1>
            <p>Books, films, ideas, and other things worth keeping.</p>
          </div>
        </div>
        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : !items ? (
          <p role="status" className="quiet">
            Loading collection…
          </p>
        ) : (
          <>
            {!id && items.length > 0 && (
              <div className="list-toolbar">
                <div className="search-box">
                  <Icon name="search" size={16} />
                  <Input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search collection"
                    placeholder="Find a book, film, idea…"
                  />
                </div>
                <Picker
                  label="Media type"
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: "all", label: "All types" },
                    ...kinds.map((k) => ({ value: k, label: kindLabels[k] })),
                  ]}
                />
              </div>
            )}
            <div className="collection-grid">
              {filtered.map((item) => (
                <article className="collection-card" key={item.id}>
                  <MiniCover kind={item.kind} url={item.cover_url} />
                  <div className="collection-copy">
                    <TypeLabel kind={item.kind} />
                    <h2>
                      <a
                        className="item-title"
                        href={
                          safeURL(item.url) ||
                          (id ? undefined : "/shared/" + item.id)
                        }
                        target={safeURL(item.url) ? "_blank" : undefined}
                        rel="noreferrer"
                      >
                        {item.title}
                        {safeURL(item.url) && (
                          <Icon name="external" size={12} />
                        )}
                      </a>
                    </h2>
                    <p className="item-meta">
                      {item.author ||
                        hostname(item.url) ||
                        kindLabels[item.kind]}
                    </p>
                    {item.description && (
                      <p className="shared-description">{item.description}</p>
                    )}
                    {item.tags.length > 0 && (
                      <p className="shared-tags">{item.tags.join(" · ")}</p>
                    )}
                    <span className="shared-status">
                      {item.status === "done" ? "Done" : "To read/watch"}
                    </span>
                  </div>
                </article>
              ))}
            </div>
            {!filtered.length && (
              <div className="empty-state">
                <span className="empty-icon">
                  <Icon name="globe" size={27} />
                </span>
                <h2>
                  {query || kind !== "all"
                    ? "Nothing matches."
                    : "Nothing shared yet."}
                </h2>
                <p>Only items chosen for the public collection appear here.</p>
              </div>
            )}
          </>
        )}
        <footer className="page-footer">
          <Icon name="globe" size={13} />A personal collection, shared by
          choice.
        </footer>
      </main>
    </div>
  );
}
