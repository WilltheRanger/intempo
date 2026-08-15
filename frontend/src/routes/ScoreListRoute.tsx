import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MusicNotes, Plus } from "@phosphor-icons/react";

import { cn } from "../lib/cn";
import { PieceGrid } from "../components/library/PieceGrid";
import { LIBRARY, type LibraryPiece, type PieceKind } from "../lib/demo";

type Filter = "all" | PieceKind | "favorites";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "concerto", label: "Concerti" },
  { id: "suite", label: "Suites" },
  { id: "etude", label: "Etudes" },
  { id: "repertoire", label: "Repertoire" },
  { id: "favorites", label: "Favourites" },
];

export function ScoreListRoute() {
  const [filter, setFilter] = useState<Filter>("all");
  const [favorites, setFavorites] = useState<Set<string>>(
    () => new Set(LIBRARY.filter((p) => p.favorite).map((p) => p.id)),
  );

  // Local-only: there's no favourites endpoint yet, so this resets on reload.
  // Wire alongside GET /v1/library.
  const toggleFavorite = (id: string) =>
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visible = useMemo<LibraryPiece[]>(() => {
    if (filter === "all") return LIBRARY;
    if (filter === "favorites") return LIBRARY.filter((p) => favorites.has(p.id));
    return LIBRARY.filter((p) => p.kind === filter);
  }, [filter, favorites]);

  // Only offer a filter that would return something.
  const available = FILTERS.filter(
    (f) =>
      f.id === "all" ||
      (f.id === "favorites"
        ? favorites.size > 0
        : LIBRARY.some((p) => p.kind === f.id)),
  );

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-serif text-[30px] leading-tight text-ink lg:text-[36px]">
          Your library
        </h1>
        <Link
          to="/scores/new"
          className="press inline-flex items-center gap-1.5 rounded-sm border border-line-2 px-3.5 py-2 text-[13px] text-ink transition-colors duration-150 hover:bg-paper-warm lg:hidden"
        >
          <Plus size={13} weight="bold" />
          Add piece
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line pb-3">
        {available.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={active}
              className={cn(
                "relative pb-2 text-[13.5px] transition-colors duration-150",
                active ? "text-ink" : "text-ink-mute hover:text-ink",
              )}
            >
              {f.label}
              {active && (
                <span className="absolute -bottom-[13px] left-0 right-0 h-[1.5px] bg-ink" />
              )}
            </button>
          );
        })}
        <span className="ml-auto text-[12.5px] tabular-nums text-ink-faint">
          {visible.length} {visible.length === 1 ? "piece" : "pieces"}
        </span>
      </div>

      {visible.length === 0 ? (
        <Empty filtered={filter !== "all"} />
      ) : (
        <PieceGrid
          pieces={visible}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
        />
      )}
    </div>
  );
}

function Empty({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-start gap-3 border-y border-line py-14">
      <MusicNotes size={22} className="text-ink-faint" />
      <div>
        <p className="font-serif text-[19px] text-ink">
          {filtered ? "Nothing here yet" : "No pieces yet"}
        </p>
        <p className="mt-1 max-w-[42ch] text-[13.5px] text-ink-soft">
          {filtered
            ? "No pieces match this filter."
            : "Photograph a page of sheet music and it will appear here, ready to practise."}
        </p>
      </div>
      {!filtered && (
        <Link
          to="/scores/new"
          className="press mt-1 inline-flex items-center gap-1.5 rounded-sm bg-ink px-4 py-2.5 text-[13.5px] font-medium text-paper transition-colors duration-150 hover:bg-black"
        >
          <Plus size={13} weight="bold" />
          Add your first piece
        </Link>
      )}
    </div>
  );
}
