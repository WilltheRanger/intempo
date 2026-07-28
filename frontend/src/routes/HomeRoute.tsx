import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CaretRight, Plus, Star } from "@phosphor-icons/react";

import { useAuth } from "../hooks/useAuth";
import { Eyebrow } from "../components/ui/Eyebrow";
import { ScoreThumb } from "../components/ui/ScoreThumb";
import { cn } from "../lib/cn";
import {
  LIBRARY,
  RECENT_SESSIONS,
  type LibraryPiece,
  type RecentSession,
} from "../lib/demo";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function displayName(email: string | null): string {
  if (!email) return "Maia";
  const handle = email.split("@")[0].split(/[.\-_+]/)[0];
  return handle.charAt(0).toUpperCase() + handle.slice(1);
}

export function HomeRoute() {
  const { email } = useAuth();
  const name = displayName(email);
  const hello = useMemo(() => greeting(), []);

  return (
    <div className="flex flex-col gap-7">
      <GreetingRow hello={hello} name={name} />
      <RecentSessions sessions={RECENT_SESSIONS} />
      <ManuscriptRule />
      <YourLibrary pieces={LIBRARY} />
    </div>
  );
}

/** The "barline that breathes" motif — a hairline rule with a centered
 *  diamond, used to separate the manuscript's movements (sections). */
function ManuscriptRule() {
  return (
    <div className="flex items-center gap-3 text-ink-faint" aria-hidden>
      <span className="h-px flex-1 bg-line-2" />
      <span className="size-1.5 rotate-45 rounded-[1px] bg-ink-faint" />
      <span className="h-px flex-1 bg-line-2" />
    </div>
  );
}

function GreetingRow({ hello, name }: { hello: string; name: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        {/* "barline that breathes" — the mark from the moodboard */}
        <span className="h-7 w-[3px] rounded-full bg-ink" aria-hidden />
        <h1 className="font-serif text-[23px] italic leading-tight text-ink">
          {hello}, {name}
        </h1>
      </div>
      <Link
        to="/account"
        aria-label="Your profile"
        className="grid size-11 shrink-0 place-items-center rounded-full border border-line-2 bg-paper-warm font-serif text-lg text-ink-soft shadow-hair"
      >
        {name.charAt(0)}
      </Link>
    </div>
  );
}

function RecentSessions({ sessions }: { sessions: RecentSession[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <Eyebrow>Recent sessions</Eyebrow>
        <Link
          to="/scores"
          className="text-[13px] font-medium text-amber-deep transition-colors duration-200 ease-ios hover:text-amber"
        >
          See all
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-paper-raised shadow-card">
        {sessions.map((s, i) => (
          <Link
            key={s.id}
            to="/scores"
            className={cn(
              "group flex items-center gap-3 px-4 py-3.5 transition-colors duration-200 ease-ios hover:bg-paper-warm",
              i > 0 && "border-t border-line",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-serif text-[17px] text-ink">
                {s.piece}
              </p>
              <p className="mt-0.5 text-[12px] text-ink-mute">{s.when}</p>
              <p
                className={cn(
                  "mt-1.5 text-[13px]",
                  s.tone === "on" ? "text-ink-soft" : "text-amber-deep",
                )}
              >
                {s.note}
              </p>
            </div>
            <CaretRight
              size={16}
              weight="bold"
              className="shrink-0 text-ink-faint transition-transform duration-200 ease-ios group-hover:translate-x-0.5"
            />
          </Link>
        ))}
      </div>
    </section>
  );
}

function YourLibrary({ pieces }: { pieces: LibraryPiece[] }) {
  const [favorites, setFavorites] = useState<Set<string>>(
    () => new Set(pieces.filter((p) => p.favorite).map((p) => p.id)),
  );

  const toggle = (id: string) =>
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <Eyebrow>Your library</Eyebrow>
        <Link
          to="/scores/new"
          className="flex items-center gap-1 text-[13px] font-medium text-amber-deep transition-colors duration-200 ease-ios hover:text-amber"
        >
          <Plus size={14} weight="bold" />
          Add music
        </Link>
      </div>

      <ul className="flex flex-col">
        {pieces.map((p, i) => {
          const fav = favorites.has(p.id);
          return (
            <li
              key={p.id}
              className={cn(
                "flex items-center gap-3.5 py-3",
                i > 0 && "border-t border-line",
              )}
            >
              <Link
                to="/scores"
                className="flex min-w-0 flex-1 items-center gap-3.5"
              >
                <ScoreThumb
                  seed={p.id}
                  className="size-12 shrink-0 rounded-md"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-ink">
                    {p.piece}
                  </p>
                  <p className="truncate text-[13px] text-ink-soft">
                    {p.movement}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-mute">
                    {p.lastPracticed}
                  </p>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => toggle(p.id)}
                aria-pressed={fav}
                aria-label={
                  fav
                    ? `Remove ${p.piece} from favorites`
                    : `Add ${p.piece} to favorites`
                }
                className="grid size-9 shrink-0 place-items-center rounded-full transition-colors duration-200 ease-ios hover:bg-paper-warm"
              >
                <Star
                  size={19}
                  weight={fav ? "fill" : "regular"}
                  className={cn(
                    "transition-colors duration-200 ease-ios",
                    fav ? "text-amber" : "text-ink-faint",
                  )}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
