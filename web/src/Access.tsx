import { useState, type FormEvent } from "react";
import { Button } from "unlikely-ui/button";
import { Input } from "unlikely-ui/input";
import { api, send } from "./api";
import { FormField } from "./components";
import { Icon, Logo } from "./Icon";
import type { Session } from "./types";

export function Access({
  setup,
  onAuthenticated,
}: {
  setup: boolean;
  onAuthenticated: (session: Session) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (setup && password !== confirmation) {
      setError("The passwords don’t match.");
      return;
    }
    setBusy(true);
    try {
      onAuthenticated(
        await api<Session>(
          setup ? "/setup" : "/login",
          send("POST", { password }),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="access-page">
      <a href="/" className="brand-link" aria-label="Margin home">
        <Logo />
      </a>
      <div className="access-card">
        <span className="access-symbol">
          <Icon name={setup ? "lock" : "book"} size={28} />
        </span>
        <h1>{setup ? "Make it yours." : "Welcome back."}</h1>
        <p>
          {setup
            ? "Create the owner password for this library. Your list and discoveries stay private until you choose to share an item."
            : "Sign in to your reading list and discovery inbox."}
        </p>
        <form onSubmit={submit}>
          <FormField
            label={setup ? "Owner password" : "Password"}
            hint={
              setup
                ? "Use at least 12 characters. A passphrase works well."
                : undefined
            }
          >
            <Input
              autoFocus
              type="password"
              autoComplete={setup ? "new-password" : "current-password"}
              minLength={setup ? 12 : undefined}
              maxLength={128}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          {setup && (
            <FormField label="Confirm password">
              <Input
                type="password"
                autoComplete="new-password"
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </FormField>
          )}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" loading={busy}>
            {setup ? "Create private library" : "Sign in"}
            <Icon name="arrow" size={16} />
          </Button>
        </form>
        <a href="/shared" className="text-link">
          View shared items <Icon name="external" size={13} />
        </a>
      </div>
      <p className="access-footer">
        A small place for things worth your attention.
      </p>
    </div>
  );
}
