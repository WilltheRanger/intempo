import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Camera } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "../lib/cn";
import { listContainer, listItem } from "../lib/motion";
import { LIBRARY, RECENT_SESSIONS, splitPiece, type LibraryPiece } from "../lib/demo";

/** Weekday + time-of-day for the amber eyebrow, e.g. "SATURDAY EVENING". */
function greeting(): string {
  const now = new Date();
  const weekday = now.toLocaleDateString(undefined, { weekday: "long" });
  const h = now.getHours();
  const period = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  return `${weekday} ${period}`.toUpperCase();
}

export function HomeRoute() {
  const eyebrow = useMemo(() => greeting(), []);
  const resume = RECENT_SESSIONS[0];
  const library = LIBRARY.slice(0, 4);
  const reduce = useReducedMotion();

  return (
    <motion.div
      className="flex flex-col gap-6"
      variants={reduce ? undefined : listContainer}
      initial="hidden"
      animate="visible"
    >
      {/* Greeting */}
      <motion.header variants={reduce ? undefined : listItem} className="flex flex-col gap-1">
        <span className="text-[12px] font-medium uppercase tracking-[0.12em] text-amber-deep">
          {eyebrow}
        </span>
        <h1 className="font-serif text-[34px] leading-[1.05] text-ink">
          Ready to practice?
        </h1>
      </motion.header>

      {/* Primary CTA: photograph sheet music */}
      <motion.div variants={reduce ? undefined : listItem}>
      <Link
        to="/scores/new"
        className="press-lg group flex flex-col gap-2 rounded-xl bg-amber px-5 py-[18px] shadow-card"
      >
        <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-white/80">
          <Camera size={14} weight="bold" />
          New piece
        </div>
        <h2 className="font-serif text-[25px] leading-none text-white">
          Photograph sheet music
        </h2>
      </Link>
      </motion.div>

      {/* Resume: pick up where you left off */}
      <motion.div variants={reduce ? undefined : listItem}>
      <Link
        to="/scores"
        className="press group flex items-center gap-3.5 rounded-md border border-line-2 bg-paper-warm p-3.5 pr-4 shadow-hair transition-colors duration-200 ease-ios hover:bg-paper-deep"
      >
        <SheetStrip className="h-16 w-[52px] shrink-0 rounded-lg border border-line-2" />
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-amber-deep">
            Pick up where you left off
          </span>
          <p className="truncate font-serif text-[18px] leading-snug text-ink">
            {resume.piece.replace(" — ", " · ")}
          </p>
          <p className="truncate text-[13px] text-ink-soft">
            {resume.movement} · last take {resume.when.toLowerCase()}
          </p>
        </div>
      </Link>
      </motion.div>

      {/* Library */}
      <motion.section variants={reduce ? undefined : listItem} className="flex flex-col gap-3.5">
        <div className="flex items-baseline justify-between">
          <h3 className="font-serif text-[20px] text-ink">Your library</h3>
          <Link
            to="/scores"
            className="text-[13px] font-medium text-amber-deep transition-colors duration-200 ease-ios hover:text-amber"
          >
            See all
          </Link>
        </div>

        <ul className="grid grid-cols-2 gap-3.5">
          {library.map((p) => (
            <LibraryCard key={p.id} piece={p} />
          ))}
        </ul>
      </motion.section>
    </motion.div>
  );
}

function LibraryCard({ piece }: { piece: LibraryPiece }) {
  const { composer, title } = splitPiece(piece.piece);
  return (
    <li>
      <Link
        to="/scores"
        className="press group flex h-full flex-col overflow-hidden rounded-lg border border-line-2 bg-paper-raised shadow-hair"
      >
        <SheetStrip className="h-24 w-full" />
        <div className="flex flex-col gap-0.5 px-3.5 pb-3.5 pt-3">
          {composer && (
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-amber-deep">
              {composer}
            </span>
          )}
          <p className="font-serif text-[15px] leading-snug text-ink">
            {title}
          </p>
        </div>
      </Link>
    </li>
  );
}

/**
 * A warm engraved-paper strip — five hairline staff lines centered on
 * warm paper. Scales to any box (portrait resume thumb or wide card art),
 * so we don't ship an empty grey rectangle before real page crops exist.
 */
function SheetStrip({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("bg-paper-warm", className)}
      style={{
        backgroundImage:
          "repeating-linear-gradient(to bottom, transparent 0 7px, rgba(35,32,26,0.26) 7px 8px)",
        backgroundSize: "72% 40px",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}
