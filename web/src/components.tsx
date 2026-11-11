import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { Button } from "unlikely-ui/button";
import { Dialog } from "unlikely-ui/dialog";
import { Select } from "unlikely-ui/select";
import { Field } from "unlikely-ui/field";
import { Icon } from "./Icon";
import { kindLabels, type Kind } from "./types";
import { imageURL, publisherImage } from "./utils";
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
  onDismissStart,
  className = "",
  busy = false,
  closeRequested = false,
  focusTitle = true,
  fallbackFocus,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  onDismissStart?: () => void;
  className?: string;
  busy?: boolean;
  closeRequested?: boolean;
  focusTitle?: boolean;
  fallbackFocus?: () => HTMLElement | null;
}) {
  const [open, setOpen] = useState(true);
  const closing = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  // Avoid opening the Close tooltip as a side effect of dialog autofocus.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusScrollFrame = useRef<number | undefined>(undefined);
  useEffect(() => () => cancelAnimationFrame(focusScrollFrame.current ?? 0), []);
  function beginClosing() {
    if (closing.current) return;
    closing.current = true;
    // Native Enter/Space can activate the previously focused control before
    // React commits the closing frame. Lock the real DOM synchronously too.
    if (contentRef.current) contentRef.current.inert = true;
    cancelAnimationFrame(focusScrollFrame.current ?? 0);
  }
  function blockClosingInteraction(event: SyntheticEvent) {
    if (!closing.current && !closeRequested) return;
    event.preventDefault();
    event.stopPropagation();
  }
  useLayoutEffect(() => {
    if (closeRequested) {
      beginClosing();
      setOpen(false);
    }
  }, [closeRequested]);
  // These dialogs can open from a shortcut, without a Dialog.Trigger.
  // BODY is not a return target: the primitive would choose its first tabbable
  // descendant (the Skip link) even though the user never focused that link.
  const [origin] = useState(() =>
    document.activeElement instanceof HTMLElement &&
    document.activeElement !== document.body &&
    document.activeElement !== document.documentElement
      ? document.activeElement
      : null,
  );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(open) => {
        if (busy || closing.current) return;
        if (!open) {
          beginClosing();
          onDismissStart?.();
        }
        setOpen(open);
      }}
      onOpenChangeComplete={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content
        showCloseButton={false}
        ref={contentRef}
        className={"app-modal " + className}
        inert={closing.current || closeRequested || !open}
        onClickCapture={blockClosingInteraction}
        onSubmitCapture={blockClosingInteraction}
        onKeyDownCapture={blockClosingInteraction}
        onKeyUpCapture={blockClosingInteraction}
        onBeforeInputCapture={blockClosingInteraction}
        initialFocus={focusTitle ? titleRef : undefined}
        finalFocus={() => origin ? origin.isConnected ? origin : fallbackFocus?.() || false : false}
        onFocusCapture={(event) => {
          const target = event.target;
          const modal = event.currentTarget;
          if (!(target instanceof HTMLElement) || !modal.contains(target)) return;
          cancelAnimationFrame(focusScrollFrame.current ?? 0);
          // Native focus scrolling may reveal only a textarea's caret. After
          // that scroll, keep the whole focused control inside this scroller.
          focusScrollFrame.current = requestAnimationFrame(() => {
            if (!target.isConnected || document.activeElement !== target) return;
            const viewport = modal.getBoundingClientRect();
            const control = target.getBoundingClientRect();
            const top = viewport.top + modal.clientTop + 8;
            const bottom = viewport.bottom - modal.clientTop - 8;
            if (control.height > bottom - top || control.top < top)
              modal.scrollTop += control.top - top;
            else if (control.bottom > bottom)
              modal.scrollTop += control.bottom - bottom;
          });
        }}
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
export function MiniCover({ kind, url = "", publisherURL, naturalArtwork = false }: { kind: Kind; url?: string; publisherURL?: string; naturalArtwork?: boolean }) {
  const [failed, setFailed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState("");
  const publisher = publisherURL ? publisherImage(publisherURL) : undefined;
  const src = [imageURL(url), publisher].find(value => value && !failed.includes(value));
  const brand = src === publisher && publisher?.startsWith("/brands/")
    ? publisher.split("/").at(-1)?.split(".")[0]
    : undefined;
  return (
    <span
      className={"mini-cover mini-" + kind}
      data-empty={!src || undefined}
      data-publisher={Boolean(src && src === publisher) || undefined}
      data-publisher-local={Boolean(src && src === publisher && src.startsWith("/brands/")) || undefined}
      data-brand={brand}
      data-loading={Boolean(src && loaded !== src) || undefined}
      data-natural={naturalArtwork || undefined}
      aria-hidden="true"
    >
      <Icon name={kind} size={20} />
      {src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(values => [...values, src])}
          style={{ opacity: loaded === src ? 1 : 0 }}
        />
      )}
    </span>
  );
}
export function ListSkeleton({ discovery = false, gallery = false, count = gallery ? 6 : 4 }: { discovery?: boolean; gallery?: boolean; count?: number }) {
  return (
    <div className={"loading-list" + (discovery ? " discovery-loading-list" : "") + (gallery ? " gallery-loading-list" : "")} role="status" aria-label={discovery ? "Loading discoveries" : gallery ? "Loading gallery" : "Loading list"}>
      {Array.from({ length: count }, (_, index) => (
        <div className="loading-row" key={index} aria-hidden="true">
          <span className="loading-cover" />
          <span className="loading-copy"><span /><span /><span /></span>
        </div>
      ))}
    </div>
  );
}
export function EmptyState({
  discovery = false,
  filtered = false,
  done = false,
  review = false,
  action,
  heading,
  description,
}: {
  discovery?: boolean;
  filtered?: boolean;
  done?: boolean;
  review?: boolean;
  action?: ReactNode;
  heading?: string;
  description?: string;
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
          : heading ? heading : review
            ? "Nothing needs attention."
            : discovery
              ? "You’re all caught up."
              : done
                ? "Your finished reads go here."
                : "Something worth keeping?"}
      </h2>
      <p>
        {filtered
          ? "Try another search or clear your filters."
          : description ? description : review
            ? "Items flagged for checking appear here. Deliberate saves do not automatically require review, and reviewing does not mark an item done."
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
export function SourceMark({ name, url }: { name: string; url: string }) {
  const [failed, setFailed] = useState("");
  const publisher = publisherImage(url);
  const src = publisher?.startsWith("/brands/") && publisher !== failed
    ? publisher
    : undefined;
  const brand = src?.split("/").at(-1)?.split(".")[0];
  return (
    <span
      className={"source-mark" + (brand ? " source-mark-logo" : "")}
      data-brand={brand}
      aria-hidden="true"
    >
      {src ? (
        <img src={src} alt="" width={22} height={22} onError={() => setFailed(src)} />
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
