import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "unlikely-ui/button";
import { Input } from "unlikely-ui/input";
import { Modal, TypeLabel } from "./components";
import type { Media } from "./types";
import { hostname, safeURL, selectMedia } from "./utils";
import "./QuickFind.css";

const pageSize = 20;

export function QuickFind({ media, loading, onClose, onEdit, fallbackFocus }: {
  media: Media[];
  loading: boolean;
  onClose: () => void;
  onEdit: (item: Media) => void;
  fallbackFocus: () => HTMLElement | null;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(pageSize);
  const [selectedId, setSelectedId] = useState<string>();
  const [closing, setClosing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [copyError, setCopyError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const afterClose = useRef<(() => void) | undefined>(undefined);
  const id = useId();
  const results = useMemo(() => selectMedia(media, {
    query, status: "all", kinds: [], tags: [],
  }), [media, query]);
  const visible = results.slice(0, limit);
  // Derive the fallback from the current result set, so a stale id can never
  // activate a previous match after the query changes or the item is removed.
  const selected = visible.find(item => item.id === selectedId) || visible[0];
  const selectedIndex = selected ? visible.indexOf(selected) : -1;
  const optionId = (index: number) => `${id}-result-${index}`;
  useEffect(() => {
    if (selectedIndex >= 0)
      document.getElementById(optionId(selectedIndex))?.scrollIntoView({ block: "nearest" });
  }, [selected?.id, selectedIndex]);
  function edit(item: Media) {
    afterClose.current = () => onEdit(item);
    setClosing(true);
  }
  function activate(item: Media) {
    const url = safeURL(item.url);
    if (!url) return edit(item);
    window.open(url, "_blank", "noopener,noreferrer");
    setClosing(true);
  }
  async function copy(item: Media) {
    try {
      await navigator.clipboard.writeText(item.url);
      setCopyError(false);
      setFeedback("Original URL copied.");
    } catch {
      setCopyError(true);
      setFeedback("Could not copy the URL. Try opening the item instead.");
    }
  }
  return <Modal title="Quick Find" description="All saved items, including Done and automatic additions. Your current view stays as it is."
    className="quick-find" focusTitle={false} closeRequested={closing} fallbackFocus={fallbackFocus}
    onDismissStart={() => setClosing(true)} onClose={() => { onClose(); afterClose.current?.(); }}>
    <label htmlFor={`${id}-query`} className="quick-find-label">Search all saved items</label>
    <Input ref={inputRef} id={`${id}-query`} autoFocus value={query}
      placeholder="Title, creator, URL, note or tag…" role="combobox" aria-autocomplete="list"
      aria-expanded={true} aria-controls={`${id}-results`} aria-describedby={`${id}-count`}
      aria-activedescendant={selectedIndex >= 0 ? optionId(selectedIndex) : undefined}
      onChange={event => {
        setQuery(event.target.value); setSelectedId(undefined); setLimit(pageSize); setFeedback("");
      }} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229 || closing) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (!visible.length) return;
          const next = Math.max(0, Math.min(visible.length - 1, selectedIndex + (event.key === "ArrowDown" ? 1 : -1)));
          setSelectedId(visible[next].id);
        } else if (event.key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          event.preventDefault();
          if (selected && !event.repeat) activate(selected);
        }
      }} />
    <p id={`${id}-count`} className="quick-find-count" role="status">
      {loading ? "Loading saved items…" : results.length ? `Showing ${visible.length} of ${results.length} saved items` : query.trim() ? "No saved items match your search." : "No saved items yet."}
    </p>
    <div id={`${id}-results`} role="listbox" tabIndex={-1} aria-label="Saved items" className="quick-find-results">
      {visible.map((item, index) => <button type="button" role="option" key={item.id} id={optionId(index)}
        tabIndex={-1} aria-selected={selected?.id === item.id} className="quick-find-result"
        onMouseDown={event => event.preventDefault()} onClick={() => activate(item)}>
        <span className="quick-find-title">{item.title}</span>
        <span className="quick-find-meta">
          <TypeLabel kind={item.kind} />
          {item.author && <span>{item.author}</span>}
          {hostname(item.url) && <span>{hostname(item.url)}</span>}
        </span>
      </button>)}
    </div>
    {visible.length < results.length && <Button variant="secondary" size="sm" className="quick-find-more" onClick={() => {
      setLimit(value => value + pageSize);
      setSelectedId(results[limit].id);
      inputRef.current?.focus({ preventScroll: true });
    }}>Show more</Button>}
    {selected && <div className="quick-find-actions" role="group" aria-label={`Actions for ${selected.title}`}>
      <span>↑/↓ select · Enter {safeURL(selected.url) ? "opens source" : "edits item"}</span>
      {safeURL(selected.url) && <Button variant="secondary" size="sm" onClick={() => void copy(selected)}>Copy original URL</Button>}
      <Button variant="secondary" size="sm" onClick={() => edit(selected)}>Edit item</Button>
    </div>}
    {feedback && <p className="quick-find-count" role={copyError ? "alert" : "status"}>{feedback}</p>}
  </Modal>;
}
