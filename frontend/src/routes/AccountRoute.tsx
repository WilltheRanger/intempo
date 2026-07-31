import { SignOut, Warning, User } from "@phosphor-icons/react";

import { useAuth } from "../hooks/useAuth";
import { Badge } from "../components/ui/Badge";

const VERSION = "v0.1.0";

/** First letter of the handle, for the monogram. Null → fall back to an icon. */
function monogram(email: string | null): string | null {
  const first = email?.trim().charAt(0);
  return first ? first.toUpperCase() : null;
}

export function AccountRoute() {
  const { email, me, signOut, configured } = useAuth();
  const tier = me?.tier ?? "free";
  const isPro = tier.toLowerCase() === "pro";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-[26px] leading-tight text-ink">Account</h1>

      {/* identity */}
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="grid size-14 shrink-0 place-items-center rounded-full border border-line-2 bg-paper-warm font-serif text-[22px] text-ink-soft shadow-hair"
        >
          {monogram(email) ?? <User size={24} className="text-ink-faint" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-ink">
            {email ?? "Not signed in"}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-mute">
            {isPro ? "Pro member" : "Free plan"}
          </p>
        </div>
      </div>

      {!configured && (
        <div className="flex gap-3 rounded-lg border border-line bg-paper-warm px-3.5 py-3">
          <Warning size={17} className="mt-0.5 shrink-0 text-ink-mute" />
          <p className="text-[13px] text-ink-soft">
            Auth isn&rsquo;t configured in this environment, so account details
            are unavailable. Set the Supabase keys to sign in for real.
          </p>
        </div>
      )}

      {/* details */}
      <section className="overflow-hidden rounded-lg border border-line bg-paper-raised shadow-hair">
        <Row label="Email" value={email ?? "—"} />
        <Row
          label="Plan"
          value={
            <Badge variant={isPro ? "primary" : "info"}>
              {isPro ? "Pro" : "Free"}
            </Badge>
          }
        />
        <Row label="Version" value={VERSION} muted />
      </section>

      <button
        onClick={() => void signOut()}
        className="flex items-center justify-center gap-2 rounded-xl border border-line-2 py-3 text-[15px] text-ink transition-colors duration-200 ease-ios hover:bg-paper-warm active:scale-[0.99]"
      >
        <SignOut size={18} />
        Sign out
      </button>
    </div>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3.5 last:border-0">
      <span className="text-[13px] text-ink-mute">{label}</span>
      {typeof value === "string" ? (
        <span
          className={`min-w-0 truncate text-[14px] ${muted ? "tabular-nums text-ink-mute" : "text-ink"}`}
        >
          {value}
        </span>
      ) : (
        value
      )}
    </div>
  );
}
