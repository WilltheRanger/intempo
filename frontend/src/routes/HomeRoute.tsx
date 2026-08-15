import { Link } from "react-router-dom";
import { ArrowRight, Plus } from "@phosphor-icons/react";

import { useAuth } from "../hooks/useAuth";
import { SheetCrop } from "../components/sheet/SheetCrop";
import { PieceGrid } from "../components/library/PieceGrid";
import { SectionHeading } from "../components/ui/SectionHeading";
import { LIBRARY, continuePiece } from "../lib/demo";

function firstName(email: string | null): string | null {
  if (!email) return null;
  const handle = email.split("@")[0].split(/[.\-_+]/)[0];
  if (!handle) return null;
  return handle.charAt(0).toUpperCase() + handle.slice(1);
}

export function HomeRoute() {
  const { email } = useAuth();
  const name = firstName(email);
  const current = continuePiece();

  return (
    <div className="flex flex-col gap-12 lg:gap-14">
      {/* 1 — practice prompt */}
      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-[34px] leading-[1.1] tracking-[-0.01em] text-ink lg:text-[42px]">
          {name ? `Ready to practice, ${name}?` : "Ready to practice?"}
        </h1>
        <p className="max-w-[46ch] text-[15px] leading-relaxed text-ink-soft">
          Pick up where you left off, or photograph a new piece to add it to
          your library.
        </p>
      </header>

      {/* 2 — continue practicing */}
      <section className="flex flex-col gap-4">
        <SectionHeading>Continue practicing</SectionHeading>
        <ContinueRow />
      </section>

      {/* 3 — library */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          action={
            <Link
              to="/scores"
              className="group inline-flex items-center gap-1 text-[13px] text-ink-mute transition-colors duration-150 hover:text-ink"
            >
              All {LIBRARY.length} pieces
              <ArrowRight
                size={13}
                className="transition-transform duration-200 ease-ios group-hover:translate-x-0.5"
              />
            </Link>
          }
        >
          Your library
        </SectionHeading>
        <PieceGrid pieces={LIBRARY.slice(0, 4)} />
      </section>
    </div>
  );

  function ContinueRow() {
    const pct = Math.round((current.progress ?? 0) * 100);
    return (
      <div className="flex max-w-[860px] flex-col gap-4 border-y border-line py-5 sm:flex-row sm:items-center sm:gap-6">
        <Link
          to={`/scores/${current.id}/record`}
          className="press hidden h-[74px] w-[112px] shrink-0 overflow-hidden rounded-sm border border-line sm:block"
        >
          <SheetCrop seed={current.id} dense />
        </Link>

        <div className="min-w-0 flex-1">
          <p className="text-[12px] uppercase tracking-[0.09em] text-amber">
            {current.composer}
          </p>
          <h3 className="mt-0.5 font-serif text-[21px] leading-snug text-ink">
            <Link to={`/scores/${current.id}/record`} className="hover:underline">
              {current.title}
            </Link>
          </h3>
          <p className="mt-1 text-[13px] text-ink-mute">
            {current.movement} · Last practiced {current.lastPracticed.toLowerCase()}
          </p>

          {current.progress != null && (
            <div className="mt-3 flex items-center gap-3">
              <div
                className="h-[3px] w-full max-w-[260px] overflow-hidden rounded-full bg-paper-deep"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progress through this piece"
              >
                <div className="h-full rounded-full bg-amber" style={{ width: `${pct}%` }} />
              </div>
              <span className="shrink-0 text-[12px] tabular-nums text-ink-mute">
                {pct}%
              </span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            to={`/scores/${current.id}/record`}
            className="press inline-flex items-center gap-2 rounded-sm bg-ink px-4 py-2.5 text-[13.5px] font-medium text-paper transition-colors duration-150 hover:bg-black"
          >
            Practice
          </Link>
          <Link
            to="/scores/new"
            className="press inline-flex items-center gap-1.5 rounded-sm border border-line-2 px-3.5 py-2.5 text-[13.5px] text-ink transition-colors duration-150 hover:bg-paper-warm sm:hidden"
          >
            <Plus size={13} weight="bold" />
            Add
          </Link>
        </div>
      </div>
    );
  }
}
