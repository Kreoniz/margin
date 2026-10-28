import { useEffect, useState } from "react";
import { Button } from "unlikely-ui/button";
import { Input } from "unlikely-ui/input";
import { Checkbox } from "unlikely-ui/checkbox";
import { formatForDisplay, useHotkey } from "@tanstack/react-hotkeys";
import { api, send } from "./api";
import { Modal } from "./components";
import { Icon } from "./Icon";
import type { Media } from "./types";
import { publicPath } from "./utils";
import { BrowserCaptureSettings } from "./BrowserCaptureSettings";
import { KeyboardHelp } from "./KeyboardHelp";

export function Settings({
  onClose,
  onLogout,
  appearance,
  onTheme,
  singleKeys,
  onSingleKeys,
  legacyCount,
  onChanged,
}: {
  onClose: () => void;
  onLogout: () => void;
  appearance: "light" | "dark";
  onTheme: () => void;
  singleKeys: boolean;
  onSingleKeys: (enabled: boolean) => void;
  legacyCount: number;
  onChanged: () => Promise<void>;
}) {
  const [configured, setConfigured] = useState<boolean>();
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState("");
  const [samples, setSamples] = useState<Media[]>();
  const [helpOpen, setHelpOpen] = useState(false);
  useHotkey("F1", () => setHelpOpen(true), {
    enabled: !helpOpen,
    ignoreInputs: false,
    requireReset: true,
  });
  useEffect(() => {
    void api<{ configured: boolean }>("/integration/token")
      .then((data) => setConfigured(data.configured))
      .catch((e) => setError(e.message));
  }, []);
  async function tokenAction(remove = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (remove) {
        await api("/integration/token", send("DELETE"));
        setToken("");
        setConfigured(false);
      } else {
        const result = await api<{ token: string }>(
          "/integration/token",
          send("POST"),
        );
        setToken(result.token);
        setConfigured(true);
        setCopied(false);
      }
      setConfirm("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update token.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Settings"
      onClose={onClose}
      className="settings-modal"
      busy={busy}
    >
      <section
        className="flex items-center justify-between gap-3 pb-3"
        aria-labelledby="appearance-heading"
      >
        <h3 id="appearance-heading" className="text-xs font-medium">
          Appearance
        </h3>
        <Button variant="secondary" size="sm" onClick={onTheme}>
          <Icon name={appearance === "light" ? "moon" : "sun"} size={14} />
          {appearance === "light" ? "Use dark theme" : "Use light theme"}
        </Button>
      </section>
      <section
        className="border-t border-solid border-u-soft pt-3 pb-2"
        aria-labelledby="keyboard-heading"
      >
        <h3 id="keyboard-heading" className="text-xs font-medium">
          Keyboard shortcuts
        </h3>
        <dl className="shortcut-list">
          {[
            ["Search", "Mod+K"],
            ["Add item", "Mod+Shift+A"],
            ["Save in editor", "Mod+Enter"],
          ].map(([label, hotkey]) => (
            <div key={hotkey}>
              <dt>{label}</dt>
              <dd>
                <kbd>{formatForDisplay(hotkey)}</kbd>
              </dd>
            </div>
          ))}
        </dl>
        <label className="single-key-option">
          <Checkbox checked={singleKeys} onCheckedChange={onSingleKeys} />
          <span>
            Enable single-key shortcuts{" "}
            <span className="text-u-muted">· / search · N add</span>
          </span>
        </label>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-[11px] text-u-muted">
          <span>Tab moves · Enter activates · Esc closes</span>
          <Button variant="ghost" size="sm" onClick={() => setHelpOpen(true)}>
            Full keyboard guide <kbd>F1</kbd>
          </Button>
        </div>
      </section>
      <details className="settings-disclosure">
        <summary>
          <span>
            <Icon name="lock" size={15} />
            Privacy & sharing
          </span>
          <Icon name="chevron" size={14} />
        </summary>
        <div className="settings-detail">
          <p>
            Items are private until you mark them public. Visitors can read
            shared items; only you can edit. Notes are always private.
          </p>
          <div>
            <Button
              variant="secondary"
              size="sm"
              nativeButton={false}
              render={
                <a href={publicPath()} target="_blank" rel="noreferrer" />
              }
            >
              <Icon name="external" size={14} />
              View public page
            </Button>
          </div>
        </div>
      </details>
      <details className="settings-disclosure">
        <summary>
          <span>
            <Icon name="link" size={15} />
            Telegram & Hermes
          </span>
          <Icon name="chevron" size={14} />
        </summary>
        <div className="settings-detail">
          <p>
            A submission token lets your bot or agent add private items. It
            cannot browse, edit, delete or publish your library.
          </p>
          {configured === undefined ? (
            <p role="status">Loading integration status…</p>
          ) : (
            <div className="button-row">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() =>
                  configured ? setConfirm("rotate") : void tokenAction()
                }
              >
                {configured ? "Replace token" : "Create submission token"}
              </Button>
              {configured && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirm("revoke")}
                >
                  Revoke token
                </Button>
              )}
            </div>
          )}
          {["rotate", "revoke"].includes(confirm) && (
            <div className="delete-confirm">
              <p>
                {confirm === "rotate"
                  ? "Replace the token? Integrations using it will need the new one."
                  : "Revoke this token? Submissions using it will stop."}
              </p>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirm("")}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="secondary"
                loading={busy}
                onClick={() => void tokenAction(confirm === "revoke")}
              >
                Confirm
              </Button>
            </div>
          )}
          {token && (
            <div className="token-result">
              <label htmlFor="submission-token">
                Copy this token now. It is only shown once.
              </label>
              <div className="token-copy">
                <Input
                  id="submission-token"
                  readOnly
                  value={token}
                  aria-label="New submission token"
                />
                <Button
                  variant="secondary"
                  size="icon-sm"
                  aria-label={
                    copied ? "Submission token copied" : "Copy submission token"
                  }
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(token);
                      setCopied(true);
                    } catch {
                      setError("Select the token field and copy it manually.");
                    }
                  }}
                >
                  <Icon name={copied ? "check" : "copy"} size={15} />
                </Button>
              </div>
              <p className="quiet" role={copied ? "status" : undefined}>
                {copied
                  ? "Copied. Keep it in your integration’s secret storage."
                  : "Keep it in your integration’s secret storage."}
              </p>
            </div>
          )}
          <details className="integration-recipe">
            <summary>
              How to submit an item <Icon name="chevron" size={14} />
            </summary>
            <p>Send an authenticated POST with a title, URL, or both:</p>
            <code>POST {window.location.origin}/api/integrations/items</code>
            <code>Authorization: Bearer &lt;submission token&gt;</code>
            <pre>{'{"url":"https://example.com/article"}'}</pre>
            <p>
              Duplicates return the existing item. New items are private and
              marked To read/watch.
            </p>
          </details>
        </div>
      </details>
      <BrowserCaptureSettings />
      <details className="settings-disclosure">
        <summary>
          <span>
            <Icon name="book" size={15} />
            Export library
          </span>
          <Icon name="chevron" size={14} />
        </summary>
        <div className="settings-detail">
          <p>
            Download your library as JSON with uploaded images in a ZIP file.
            Includes private notes; keep the archive private. External image
            URLs are retained as links.
          </p>
          <Button
            variant="secondary"
            size="sm"
            nativeButton={false}
            render={<a href="/api/export" download="margin-export.zip" />}
          >
            Download library & images
          </Button>
        </div>
      </details>
      {legacyCount > 0 && (
        <details className="settings-disclosure">
          <summary>
            <span>
              <Icon name="warning" size={15} />
              Earlier preview samples{" "}
              <span className="text-u-muted">({legacyCount})</span>
            </span>
            <Icon name="chevron" size={14} />
          </summary>
          <div className="settings-detail">
            <p>
              {legacyCount} untouched preview samples are excluded from your
              library and public page. Your own items are preserved.
            </p>
            <div className="button-row">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  if (busy) return;
                  setBusy(true);
                  setError("");
                  try {
                    setSamples(await api<Media[]>("/legacy-samples"));
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Could not load samples.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Review samples
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setConfirm("samples")}
              >
                Remove sample data
              </Button>
            </div>
            {samples && (
              <ul className="sample-list" aria-label="Preview sample items">
                {samples.map((item) => (
                  <li key={item.id}>
                    {item.title} <span className="quiet">· Sample</span>
                  </li>
                ))}
              </ul>
            )}
            {confirm === "samples" && (
              <div className="delete-confirm">
                <p>Delete only these positively identified preview samples?</p>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirm("")}
                >
                  Keep separate
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={busy}
                  onClick={async () => {
                    if (busy) return;
                    setBusy(true);
                    setError("");
                    try {
                      await api("/legacy-samples", send("DELETE"));
                      await onChanged();
                      setConfirm("");
                      setSamples(undefined);
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Could not remove samples.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Delete sample items
                </Button>
              </div>
            )}
          </div>
        </details>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-footer">
        <span className="quiet">Signed in as owner</span>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={onLogout}
        >
          <Icon name="logout" size={14} />
          Sign out
        </Button>
      </div>
      {helpOpen && (
        <KeyboardHelp
          onClose={() => setHelpOpen(false)}
          singleKeys={singleKeys}
        />
      )}
    </Modal>
  );
}
