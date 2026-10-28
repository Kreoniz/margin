import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "unlikely-ui/button";
import { Dialog } from "unlikely-ui/dialog";
import { Select } from "unlikely-ui/select";
import { Field } from "unlikely-ui/field";
import { Icon } from "./Icon";
import { kindLabels, type Kind } from "./types";
import { imageURL } from "./utils";
import { ActionHint, HintScope } from "./ActionHint";

export function Picker<T extends string>({
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select.Root
      value={value}
      onValueChange={(v) => {
        if (v !== null) onChange(v);
      }}
      items={options}
      disabled={disabled}
    >
      <Select.Trigger aria-label={label} size="sm">
        <Select.Value />
      </Select.Trigger>
      <Select.Content>
        {options.map((o) => (
          <Select.Item key={o.value} value={o.value}>
            {o.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
export function FormField({
  label,
  children,
  hint,
  className = "",
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <Field.Root className={"form-field grid min-w-0 gap-1 " + className}>
      <Field.Label>{label}</Field.Label>
      {children}
      {hint && <Field.Description>{hint}</Field.Description>}
    </Field.Root>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  className = "",
  busy = false,
  closeRequested = false,
  focusTitle = true,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  busy?: boolean;
  closeRequested?: boolean;
  focusTitle?: boolean;
}) {
  const [open, setOpen] = useState(true);
  // Avoid opening the Close tooltip as a side effect of dialog autofocus.
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (closeRequested) setOpen(false);
  }, [closeRequested]);
  // These dialogs can open from a shortcut, without a Dialog.Trigger.
  const [origin] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(open) => {
        if (!busy) setOpen(open);
      }}
      onOpenChangeComplete={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content
        className={"app-modal " + className}
        initialFocus={focusTitle ? titleRef : undefined}
        finalFocus={() => (origin?.isConnected ? origin : true)}
      >
        <HintScope>
          <div className="modal-header">
            <div>
              <Dialog.Title
                ref={titleRef}
                tabIndex={focusTitle ? -1 : undefined}
              >
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description>{description}</Dialog.Description>
              )}
            </div>
            <ActionHint label="Close dialog" shortcut="Esc">
              <Dialog.Close
                disabled={busy}
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close dialog"
                    disabled={busy}
                  />
                }
              >
                <Icon name="close" size={18} />
              </Dialog.Close>
            </ActionHint>
          </div>
          {children}
        </HintScope>
      </Dialog.Content>
    </Dialog.Root>
  );
}
export function MiniCover({ kind, url = "" }: { kind: Kind; url?: string }) {
  const [failed, setFailed] = useState("");
  const [loaded, setLoaded] = useState("");
  const src = imageURL(url);
  return (
    <span
      className={"mini-cover mini-" + kind}
      data-empty={!src || src === failed || undefined}
      aria-hidden="true"
    >
      <Icon name={kind} size={20} />
      {src && src !== failed && (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
          style={{ opacity: loaded === src ? 1 : 0 }}
        />
      )}
    </span>
  );
}
export function EmptyState({
  discovery = false,
  filtered = false,
  done = false,
  review = false,
  action,
}: {
  discovery?: boolean;
  filtered?: boolean;
  done?: boolean;
  review?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon
          name={
            filtered ? "search" : discovery ? "inbox" : done ? "check" : "book"
          }
          size={27}
        />
      </span>
      <h2>
        {filtered
          ? "Nothing matches yet."
          : review
            ? "All captures reviewed."
            : discovery
              ? "You’re all caught up."
              : done
                ? "Your finished reads go here."
                : "Something worth keeping?"}
      </h2>
      <p>
        {filtered
          ? "Try another search or clear your filters."
          : review
            ? "New captures from the extension, integrations, and automatic saves will appear here. Reviewing keeps completion separate."
            : discovery
              ? "Your sources keep collecting in the background. Save the articles you want to come back to."
              : done
                ? "Mark an item done when you’re finished. It stays here whenever you want to find it again."
                : "Save a link or a title. It stays private until you choose to share it."}
      </p>
      {action}
    </div>
  );
}
export function SourceMark({ name }: { name: string }) {
  const normalized = name.trim().toLowerCase();
  const brand =
    normalized === "openai"
      ? "openai"
      : normalized === "anthropic"
        ? "anthropic"
        : undefined;
  return (
    <span
      className={"source-mark" + (brand ? " source-mark-logo" : "")}
      data-brand={brand}
      aria-hidden="true"
    >
      {brand ? (
        <img src={`/brands/${brand}.svg`} alt="" width={22} height={22} />
      ) : normalized.includes("hugging") ? (
        "🤗"
      ) : normalized.includes("thinking") ? (
        "tm"
      ) : (
        name.slice(0, 1)
      )}
    </span>
  );
}
export function TypeLabel({ kind }: { kind: Kind }) {
  return (
    <span className="type-label">
      <Icon name={kind} size={13} />
      {kindLabels[kind]}
    </span>
  );
}
