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

/**
 * Today. The hierarchy is deliberate: what am I practising → practise it →
 * see my pieces. The greeting is a label, not a hero — the current piece
 * should be reachable without scrolling.
 */
export function HomeRoute() {
  const { email } = useAuth();
  const name = firstName(email);
  const current = continuePiece();
  const pct = Math.round((current.progress ?? 0) * 100);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="font-serif text-[24px] leading-tight text-ink lg:text-[27px]">
          {name ? `Ready to practice, ${name}?` : "Ready to practice?"}
        </h1>
        {/* Desktop carries this in the top bar. */}
        <Link
          to="/scores/new"
          className="press inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-line-2 px-3 py-1.5 text-[13px] text-ink transition-colors duration-150 hover:bg-paper-warm lg:hidden"
        >
          <Plus size={13} weight="bold" />
          Add piece
        </Link>
      </header>

      {/* What am I practising → practise it. */}
      <section className="flex flex-col gap-3">
        <SectionHeading>Continue practicing</SectionHeading>

        <div className="flex max-w-[820px] items-center gap-4 border-t border-line pt-4 sm:gap-5">
          <Link
            to={`/scores/${current.id}/record`}
            className="press hidden h-[58px] w-[88px] shrink-0 overflow-hidden rounded-sm border border-line sm:block"
          >
            <SheetCrop seed={current.id} dense />
          </Link>

          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-[18px] leading-snug text-ink">
              <Link to={`/scores/${current.id}/record`} className="hover:underline">
                {current.title}
              </Link>
            </h2>
            <p className="mt-0.5 text-[13px] text-ink-mute">
              {current.composer} · {current.movement}
            </p>

            {current.progress != null && (
              <div className="mt-2 flex items-center gap-2.5">
                <div
                  className="h-[3px] w-full max-w-[220px] overflow-hidden rounded-full bg-paper-deep"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Progress through this piece"
                >
                  <div className="h-full rounded-full bg-amber" style={{ width: `${pct}%` }} />
                </div>
                <span className="shrink-0 text-[12px] tabular-nums text-ink-mute">
                  {pct}% · {current.lastPracticed.toLowerCase()}
                </span>
              </div>
            )}
          </div>

          <Link
            to={`/scores/${current.id}/record`}
            className="press shrink-0 rounded-sm bg-ink px-4 py-2.5 text-[13.5px] font-medium text-paper transition-colors duration-150 hover:bg-black"
          >
            Practice
          </Link>
        </div>
      </section>

      {/* See my pieces. */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          action={
            <Link
              to="/scores"
              className="group inline-flex items-center gap-1 text-[13px] text-ink-mute transition-colors duration-150 hover:text-ink"
            >
              All {LIBRARY.length}
              <ArrowRight
                size={13}
                className="transition-transform duration-200 ease-ios group-hover:translate-x-0.5"
              />
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
