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
  const [notShared, setNotShared] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind | "all">("all");
  useEffect(() => {
    document.title = "Collection — Margin";
    const abort = new AbortController();
    setError("");
    setNotShared(false);
    setItems(undefined);
    void api<PublicMedia[] | PublicMedia>(
      "/public/media" + (id ? "/" + encodeURIComponent(id) : ""),
      { signal: abort.signal },
    )
      .then((result) => {
        if (!abort.signal.aborted) setItems(Array.isArray(result) ? result : [result]);
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setNotShared(Boolean(id && e instanceof ApiError && e.status === 404));
          setError(
            id && e instanceof ApiError && e.status === 404
              ? "This item is not shared."
              : e.message,
          );
        }
      });
    return () => abort.abort();
  }, [id, attempt]);
  const filtered = selectMedia(items || [], {
    query,
    status: "all",
    kinds: kind === "all" ? [] : [kind],
    tags: [],
  });
  const CardContent = id ? "div" : "a";
  const ItemHeading = id ? "h1" : "h2";
  return (
    <div className={"shared-page" + (id ? " shared-detail" : "")}>
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
        {id ? <a className="collection-back text-link" href="/">← Back to collection</a> : <div className="page-heading">
          <div>
            <h1>
              Collection<span>.</span>
            </h1>
            <p>Books, films, ideas, and other things worth keeping.</p>
          </div>
        </div>}
        {error ? (
          <p className="notice error" role="alert">
            {error}{" "}
            {!notShared && <button type="button" className="text-link" onClick={() => setAttempt(value => value + 1)}>Try again</button>}
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
                    placeholder="Search…"
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
                  <CardContent
                    className="collection-card-link"
                    aria-label={id ? undefined : item.title}
                    href={
                      id ? undefined : safeURL(item.url) || "/shared/" + item.id
                    }
                    target={!id && safeURL(item.url) ? "_blank" : undefined}
                    rel="noreferrer"
                  >
                    <MiniCover kind={item.kind} url={item.cover_url} publisherURL={item.kind === "article" ? item.url : undefined} naturalArtwork={item.kind !== "article" && item.kind !== "paper" && item.kind !== "other"} />
                    <div className="collection-copy">
                      <TypeLabel kind={item.kind} />
                      <ItemHeading>
                        <span className="item-title">
                          {item.title}
                          {!id && safeURL(item.url) && (
                            <Icon name="external" size={12} />
                          )}
                        </span>
                      </ItemHeading>
                      <p className="item-meta">
                        {item.author ||
                          hostname(item.url) ||
                          kindLabels[item.kind]}
                      </p>
                      {item.description.trim() && <p className="shared-description">
                        {item.description}
                      </p>}
                      {item.tags.some(tag => tag.trim()) && <p className="shared-tags">
                        {item.tags.filter(tag => tag.trim()).join(" · ")}
                      </p>}
                      <span className="shared-status">
                        {item.status === "done" ? "Done" : "To read/watch"}
                      </span>
                    </div>
                  </CardContent>
                  {id ? safeURL(item.url) && <a className="collection-detail-link text-link" href={safeURL(item.url)} target="_blank" rel="noreferrer">Open original <Icon name="external" size={13} /></a> : safeURL(item.url) && <a className="collection-detail-link text-link" aria-label={"View details: " + item.title} href={"/shared/" + item.id}>View details <Icon name="arrow" size={13} /></a>}
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
