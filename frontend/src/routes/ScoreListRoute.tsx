import { useState } from "react";
import { Link } from "react-router-dom";
import { Star, Plus, MusicNotes } from "@phosphor-icons/react";

import { cn } from "../lib/cn";
import { ScoreThumb } from "../components/ui/ScoreThumb";
import { LIBRARY, splitPiece, type LibraryPiece } from "../lib/demo";

export function ScoreListRoute() {
  // Seed data is already ordered most-recently-practiced first; `lastPracticed`
  // is a display string, so there's no date to sort on until the real
  // `GET /v1/library` lands.
  const pieces = LIBRARY;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-baseline justify-between">
        <h1 className="font-serif text-[26px] leading-tight text-ink">
          Your library
        </h1>
        {pieces.length > 0 && (
          <span className="text-[13px] text-ink-mute">
            {pieces.length} {pieces.length === 1 ? "piece" : "pieces"}
          </span>
        )}
      </header>

      {pieces.length === 0 ? <EmptyLibrary /> : <PieceList pieces={pieces} />}
    </div>
  );
}

function PieceList({ pieces }: { pieces: LibraryPiece[] }) {
  const [favorites, setFavorites] = useState<Set<string>>(
    () => new Set(pieces.filter((p) => p.favorite).map((p) => p.id)),
  );

  // Local-only for now — there's no favourites endpoint yet, so this resets
  // on reload. Wire to the API alongside GET /v1/library.
  const toggle = (id: string) =>
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ul className="flex flex-col">
      {pieces.map((p, i) => {
        const { composer, title } = splitPiece(p.piece);
        const fav = favorites.has(p.id);
        return (
          <li
            key={p.id}
            className={cn(
              "flex items-center gap-3.5 py-3.5",
              i > 0 && "border-t border-line",
            )}
          >
            <Link
              to={`/scores/${p.id}/record`}
              className="flex min-w-0 flex-1 items-center gap-3.5"
            >
              <ScoreThumb seed={p.id} className="size-12 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1">
                {composer && (
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-amber-deep">
                    {composer}
                  </p>
                )}
                <p className="truncate font-serif text-[17px] leading-snug text-ink">
                  {title}
                </p>
                <p className="truncate text-[12px] text-ink-mute">
                  {p.movement} · {p.lastPracticed.replace("Last practiced ", "")}
                </p>
              </div>
            </Link>
            <button
              type="button"
              onClick={() => toggle(p.id)}
              aria-pressed={fav}
              aria-label={
                fav
                  ? `Remove ${title} from favourites`
                  : `Add ${title} to favourites`
              }
              className="grid size-9 shrink-0 place-items-center rounded-full transition-colors duration-200 ease-ios hover:bg-paper-warm active:scale-90"
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
  );
}

/** First thing a new user sees on this tab — worth more than "no results". */
function EmptyLibrary() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line-2 bg-paper-raised px-6 py-12 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-amber-soft text-amber-deep">
        <MusicNotes size={24} />
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-serif text-[19px] text-ink">No pieces yet</p>
        <p className="max-w-[260px] text-[13px] text-ink-soft">
          Photograph a page of sheet music and it&rsquo;ll appear here, ready to
          play along with.
        </p>
      </div>
      <Link to="/scores/new">
        <button className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-amber px-5 py-2.5 text-[14px] font-medium text-white shadow-[0_8px_18px_-8px_rgba(199,138,58,0.8)] transition-transform duration-200 ease-ios active:scale-[0.98]">
          <Plus size={15} weight="bold" />
          Add your first piece
        </button>
      </Link>
    </div>
  );
}
