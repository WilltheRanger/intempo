import { useState } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../hooks/useAuth";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Eyebrow } from "../components/ui/Eyebrow";
import { Wordmark } from "../components/Wordmark";

export function LoginRoute() {
  const { status, configured, signInWithEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "signedIn") return <Navigate to="/" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signInWithEmail(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-6 px-5">
      <Wordmark />
      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Eyebrow>Sign in</Eyebrow>
          <h1 className="font-serif text-2xl text-ink">Welcome back</h1>
          <p className="text-sm text-ink-soft">
            We&rsquo;ll email you a magic link. No password to remember.
          </p>
        </div>

        {!configured && (
          <p className="rounded-md border border-line bg-paper-warm px-3 py-2 text-xs text-ink-mute">
            Auth isn&rsquo;t configured in this environment yet. Set
            <code className="mx-1">VITE_SUPABASE_URL</code> and
            <code className="mx-1">VITE_SUPABASE_ANON_KEY</code> to enable
            sign-in.
          </p>
        )}

        {sent ? (
          <p className="text-sm text-ink">
            Check your inbox. We sent a link to{" "}
            <span className="font-medium">{email}</span>.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="h-11 rounded-md border border-line bg-paper-raised px-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-amber focus:shadow-[0_0_0_2px_var(--amber-soft)] focus:outline-none"
            />
            {error && <p className="text-xs text-verdict-bad">{error}</p>}
            <Button type="submit" fullWidth disabled={busy || !configured}>
              {busy ? "Sending…" : "Send magic link"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
