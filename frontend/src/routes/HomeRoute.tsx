import { Link } from "react-router-dom";
import { ArrowRight, Plus } from "@phosphor-icons/react";

import { useAuth } from "../hooks/useAuth";
import { PieceGrid } from "../components/library/PieceGrid";
import { SectionHeading } from "../components/ui/SectionHeading";
import { LIBRARY, continuePiece } from "../lib/demo";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function firstName(email: string | null): string | null {
  if (!email) return null;
  const handle = email.split("@")[0].split(/[.\-_+]/)[0];
  if (!handle) return null;
  return handle.charAt(0).toUpperCase() + handle.slice(1);
}

/**
 * Today.
 *
 * One dominant focal point (law 4): the hero card for the piece in progress,
 * carrying its own action. The action sits inside the card rather than in a
 * separate bar so there is nothing to mentally connect — you read the piece
 * and act on it in the same object.
 */
export function HomeRoute() {
  const { email } = useAuth();
  const name = firstName(email);
  const current = continuePiece();
  const pct = Math.round((current.progress ?? 0) * 100);

  return (
    <div className="flex flex-col gap-9">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[15px] text-ink-mute">
            {greeting()}
            {name ? `, ${name}` : ""}
          </p>
          <h1 className="mt-0.5 font-serif text-[30px] leading-[1.1] text-ink lg:text-[36px]">
            Ready to practice?
          </h1>
        </div>
        <Link
          to="/scores/new"
          className="press mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-line-2 px-3 py-1.5 text-[13px] text-ink transition-colors duration-150 hover:bg-paper-warm lg:hidden"
        >
          <Plus size={13} weight="bold" />
          Add
        </Link>
      </header>

      {/* The one place a card is justified (law 3): the focal point plus the
          action that belongs to it. */}
      <section className="max-w-[560px] rounded-md bg-paper-raised p-5 ring-1 ring-line">
        <h2 className="font-serif text-[26px] leading-[1.15] text-ink lg:text-[28px]">
          {current.title}
        </h2>
        <p className="mt-1.5 text-[16px] text-ink-soft">
          {current.composer} · {current.movement}
        </p>

        {current.progress != null && (
          <div className="mt-5">
            <div className="flex items-center gap-3">
              <div
                className="h-[4px] flex-1 overflow-hidden rounded-full bg-paper-deep"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progress through this piece"
              >
                <div className="h-full rounded-full bg-amber" style={{ width: `${pct}%` }} />
              </div>
              <span className="shrink-0 font-serif text-[17px] tabular-nums text-ink">
                {pct}%
              </span>
            </div>
            <p className="mt-2 text-[14px] text-ink-mute">
              Last practiced {current.lastPracticed.toLowerCase()}
            </p>
          </div>
        )}

        <Link
          to={`/scores/${current.id}/record`}
          className="press mt-6 flex w-full items-center justify-center gap-2 rounded-sm bg-ink py-3.5 text-[16px] font-medium text-paper transition-colors duration-150 hover:bg-black"
        >
          Continue practice
          <ArrowRight size={16} />
        </Link>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading
          action={
            <Link
              to="/scores"
              className="text-[14px] text-ink-mute transition-colors duration-150 hover:text-ink"
            >
              See all
            </Link>
          }
        >
          Your library
        </SectionHeading>
        <PieceGrid pieces={LIBRARY.slice(0, 8)} limitOnMobile />
      </section>
    </div>
  );
}
