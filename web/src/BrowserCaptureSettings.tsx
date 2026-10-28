import { useEffect, useState } from "react";
import { Button } from "unlikely-ui/button";
import { Input } from "unlikely-ui/input";
import { api, send } from "./api";
import { Icon } from "./Icon";

export function BrowserCaptureSettings() {
  const [configured, setConfigured] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"replace" | "revoke">();
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void api<{ configured: boolean }>("/integration/browser-token")
      .then((v) => setConfigured(v.configured))
      .catch((e) => setError(e.message));
  }, []);
  async function update(revoke = false) {
    setBusy(true);
    setError("");
    try {
      if (revoke) {
        await api("/integration/browser-token", send("DELETE"));
        setToken("");
        setConfigured(false);
      } else {
        const value = await api<{ token: string }>(
          "/integration/browser-token",
          send("POST"),
        );
        setToken(value.token);
        setConfigured(true);
        setCopied(false);
      }
      setConfirm(undefined);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update browser token.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="settings-disclosure">
      <summary>
        <span>
          <Icon name="link" size={15} />
          Helium / browser capture
        </span>
        <Icon name="chevron" size={14} />
      </summary>
      <div className="settings-detail">
        <p>
          The browser extension can save private items and mark the current URL
          Done. It cannot read your library, change details, delete, or publish.
          This token is separate from the add-only submission token.
        </p>
        <div className="button-row">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => (configured ? setConfirm("replace") : void update())}
          >
            {configured ? "Replace browser token" : "Create browser token"}
          </Button>
          {configured && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirm("revoke")}
            >
              Revoke browser token
            </Button>
          )}
        </div>
        {confirm && (
          <div className="delete-confirm">
            <p>
              {confirm === "replace"
                ? "Replace the browser token? The extension will need the new token."
                : "Revoke browser capture access?"}
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirm(undefined)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              loading={busy}
              onClick={() => void update(confirm === "revoke")}
            >
              Confirm
            </Button>
          </div>
        )}
        {token && (
          <div className="token-result">
            <label htmlFor="browser-token">
              Copy now. This token is shown only once.
            </label>
            <div className="token-copy">
              <Input id="browser-token" readOnly value={token} />
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(token);
                    setCopied(true);
                  } catch {
                    setError("Select and copy the token manually.");
                  }
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        )}
        <p>
          Load the repository’s <code>extension/</code> folder as an unpacked
          extension in Helium. Enter this site’s address and the browser token
          in its options. Set separate Save and Done shortcuts in the browser’s
          extension shortcut settings. New captures appear under To review.
        </p>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
