import { useEffect, useRef, useState } from "react";
import { Button } from "unlikely-ui/button";
import { Checkbox } from "unlikely-ui/checkbox";
import { Input } from "unlikely-ui/input";
import { Popover } from "unlikely-ui/popover";
import { Icon } from "./Icon";

export type LibraryFilter = "types" | "tags" | "channels";

export function FilterPicker({ id, label, values, options, open, onOpenChange, onChange, shortcut }: {
  id: LibraryFilter;
  label: string;
  values: string[];
  options: { value: string; label: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (values: string[]) => void;
  shortcut?: string;
}) {
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!open) setQuery(""); }, [open]);
  const visible = options.filter(option => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger render={<Button id={"library-filter-" + id} variant="secondary" className="library-filter-trigger" aria-label={"Filter " + id} />}>
        {values.length ? `${label} (${values.length})` : id === "channels" ? label : `All ${id}`}
        <Icon name="chevron" size={14} />
      </Popover.Trigger>
      <Popover.Content className="library-filter-panel" initialFocus={search} positionerProps={{ align: "end" }}>
        <div className="filter-panel-heading">
          <Popover.Title>{label}</Popover.Title>
          {shortcut && <kbd>{shortcut}</kbd>}
        </div>
        <Popover.Description>Match any selected {id === "types" ? "type" : id === "tags" ? "tag" : "channel name"}.</Popover.Description>
        <Input
          ref={search}
          type="search"
          aria-label={"Search " + id}
          placeholder={`Find ${id}…`}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            event.preventDefault();
            event.stopPropagation();
            const first = visible[0];
            if (first && !values.includes(first.value)) onChange([...values, first.value]);
          }}
        />
        <fieldset className="filter-options">
          <legend className="sr-only">{label}</legend>
          {visible.map(option => (
            <label className="filter-option" key={option.value}>
              <Checkbox checked={values.includes(option.value)} onCheckedChange={() => onChange(values.includes(option.value) ? values.filter(value => value !== option.value) : [...values, option.value])} />
              <span>{option.label}</span>
            </label>
          ))}
          {!visible.length && <p className="quiet">{options.length ? "No matching options." : id === "channels" ? "Channels appear when saved YouTube videos have channel details." : `No ${id} yet.`}</p>}
        </fieldset>
        <div className="filter-panel-actions">
          <Button size="sm" variant="ghost" disabled={!values.length} onClick={() => onChange([])}>Clear {id}</Button>
          <Popover.Close render={<Button size="sm" variant="secondary" />}>Done</Popover.Close>
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
