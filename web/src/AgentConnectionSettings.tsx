import { useEffect, useRef, useState } from "react";
import { Button } from "unlikely-ui/button";
import { Input } from "unlikely-ui/input";
import { api, send } from "./api";
import { Icon } from "./Icon";

type Scope = "read" | "save";
type Grant = { scope: Scope; created_at: string };

export function AgentConnectionSettings({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const [grants, setGrants] = useState<Grant[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [confirm, setConfirm] = useState<{ scope: Scope; revoke: boolean }>();
  const [secret, setSecret] = useState<{ scope: Scope; token: string }>();
  const [copied, setCopied] = useState(false);
  async function load() {
    setError("");
    try { setGrants(await api<Grant[]>("/integration/agent-grants")); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not check MCP grants."); }
  }
  useEffect(() => { void load(); }, []);
  async function change(scope: Scope, revoke: boolean) {
    if (pending.current || grants === undefined) return;
    pending.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      if (revoke) {
        await api(`/integration/agent-grants/${scope}`, send("DELETE"));
        if (secret?.scope === scope) setSecret(undefined);
        setGrants(grants.filter(g => g.scope !== scope));
      } else {
        const value = await api<{ token: string }>(`/integration/agent-grants/${scope}`, send("POST"));
        setSecret({ scope, token: value.token });
        setCopied(false);
        setGrants([...grants.filter(g => g.scope !== scope), { scope, created_at: new Date().toISOString() }]);
      }
      setConfirm(undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update MCP grant."); }
    finally { pending.current = false; setBusy(false); onBusyChange(false); }
  }
  return <details className="settings-disclosure">
    <summary><span><Icon name="link" size={15} /> Marvin / MCP connection</span><Icon name="chevron" size={14} /></summary>
    <div className="settings-detail">
      <p>Give Marvin a separate credential for the access you choose. These credentials do not reuse browser or submission tokens. Nothing is connected automatically.</p>
      <p>Read access lets the client search your entire saved library, including private items, and explicitly retrieve owner notes and selected excerpts. Search summaries omit note bodies. Save access can only add private Pending items for review; duplicates return an ID without changing or exposing their contents.</p>
      {(["read", "save"] as const).map(scope => {
        const configured = grants?.some(g => g.scope === scope);
        return <div key={scope}>
          <p><strong>{scope === "read" ? "Private library read" : "Add-only save"}</strong> — {grants === undefined ? "Status unavailable" : configured ? "Grant active" : "No grant"}</p>
          <div className="button-row">
            <Button size="sm" variant="secondary" disabled={busy || grants === undefined} onClick={() => setConfirm({ scope, revoke: false })}>{configured ? "Replace" : "Issue"} {scope} grant</Button>
            {configured && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm({ scope, revoke: true })}>Revoke {scope} grant</Button>}
          </div>
        </div>;
      })}
      {confirm && <div className="delete-confirm">
        <p>{confirm.revoke
          ? `Revoke the ${confirm.scope} grant? New requests will fail after revocation completes. Previously retrieved content cannot be recalled.`
          : confirm.scope === "read"
            ? "Allow this client to read all saved private items, owner notes and selected excerpts? Issuing replaces the previous read credential."
            : "Allow this client to add private Pending items? Issuing replaces the previous save credential."}</p>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(undefined)}>Cancel</Button>
        <Button size="sm" loading={busy} onClick={() => void change(confirm.scope, confirm.revoke)}>{confirm.revoke ? "Confirm revocation" : "Allow and issue credential"}</Button>
      </div>}
      {secret && <div className="token-result">
        <label htmlFor="agent-credential">{secret.scope} credential. Copy now; shown only here until Settings closes.</label>
        <div className="token-copy"><Input id="agent-credential" readOnly value={secret.token} />
          <Button size="sm" variant="secondary" onClick={async () => {
            try { await navigator.clipboard.writeText(secret.token); setCopied(true); }
            catch { setError("Select and copy the credential manually."); }
          }}>{copied ? "Copied" : "Copy"}</Button>
        </div>
      </div>}
      <details className="integration-recipe"><summary>Connect the verified Hermes client</summary>
        <p>Verified client: Hermes 0.21.5 with installed MCP 2.0.0 and local transport patches. Use two separately named connections if you enable both grants.</p>
        <pre>{`mcp_servers:\n  margin_read:\n    url: "${window.location.origin}/api/mcp"\n    transport: "http"\n    protocol: "stateless"\n    strict_redirect_headers: true\n    headers:\n      Authorization: "Bearer <read credential>"`}</pre>
        <p>For save access, use a separate margin_save connection with its save credential. Keep credentials in the client’s protected configuration. Remote connections require HTTPS. This manual credential flow supports clients with configurable headers; automatic OAuth discovery is not offered.</p>
        <p>Revocation stops subsequent requests. An operation admitted before revocation may finish; text already retrieved stays with the client. Treat retrieved text as untrusted source material.</p>
      </details>
      {error && <p role="alert" className="notice error">{error}</p>}
      {grants === undefined && error && <Button size="sm" variant="ghost" onClick={() => void load()}>Retry grant status</Button>}
    </div>
  </details>;
}
